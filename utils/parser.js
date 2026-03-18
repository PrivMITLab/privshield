/**
 * PrivShield – Filter Engine & Rule Parser
 * PrivMITLab
 *
 * Supports:
 *  - Network filter rules (||example.com^, /regex/, @@allow)
 *  - Option filters ($script, $image, $third-party, etc.)
 *  - Element hiding rules (##.selector)
 *  - Comment lines (!, #)
 */

'use strict';

export class FilterEngine {

  constructor() {
    this.blockRules     = [];
    this.allowRules     = [];
    this.cosmeticRules  = new Map();
    this.globalCosmetic = [];
    this.trackerDomains = new Set();

    this.stats = {
      totalRules:    0,
      blockRules:    0,
      allowRules:    0,
      cosmeticRules: 0,
      parseErrors:   0,
      compileTime:   0,
    };

    this._regexCache = new Map();
  }

  // ──────────────────────────────────────────
  // PUBLIC API
  // ──────────────────────────────────────────

  compile(rawText) {
    const start = Date.now();

    this.blockRules     = [];
    this.allowRules     = [];
    this.cosmeticRules  = new Map();
    this.globalCosmetic = [];
    this.trackerDomains = new Set();

    const lines = rawText.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('#')) continue;
      if (trimmed.startsWith('[')) continue;

      try {
        this._parseLine(trimmed);
        this.stats.totalRules++;
      } catch {
        this.stats.parseErrors++;
      }
    }

    this.stats.blockRules    = this.blockRules.length;
    this.stats.allowRules    = this.allowRules.length;
    this.stats.cosmeticRules = this.globalCosmetic.length +
      [...this.cosmeticRules.values()].reduce((s, a) => s + a.length, 0);
    this.stats.compileTime   = Date.now() - start;
  }

  shouldBlock(request) {
    const { url, type, requestHost, initiatorHost, isThirdParty } = request;

    for (const rule of this.allowRules) {
      if (this._matchesRule(rule, url, type, requestHost, initiatorHost, isThirdParty)) {
        return { block: false, reason: 'whitelisted', rule: rule.raw };
      }
    }

    if (requestHost && this.trackerDomains.has(requestHost)) {
      return { block: true, reason: 'tracker-domain', rule: `||${requestHost}^` };
    }

    for (const rule of this.blockRules) {
      if (this._matchesRule(rule, url, type, requestHost, initiatorHost, isThirdParty)) {
        return { block: true, reason: 'filter-rule', rule: rule.raw };
      }
    }

    return { block: false, reason: 'allowed' };
  }

  getCosmeticSelectors(hostname) {
    const selectors = [...this.globalCosmetic];

    if (hostname) {
      if (this.cosmeticRules.has(hostname)) {
        selectors.push(...this.cosmeticRules.get(hostname));
      }
      const parts = hostname.split('.');
      for (let i = 1; i < parts.length - 1; i++) {
        const parent = parts.slice(i).join('.');
        if (this.cosmeticRules.has(parent)) {
          selectors.push(...this.cosmeticRules.get(parent));
        }
      }
    }

    return [...new Set(selectors)];
  }

  getStats() {
    return { ...this.stats };
  }

  // ──────────────────────────────────────────
  // PARSING
  // ──────────────────────────────────────────

  _parseLine(line) {
    if (line.includes('##')) {
      this._parseCosmeticRule(line);
      return;
    }
    if (line.includes('#?#')) return;

    if (line.startsWith('@@')) {
      const rule = this._parseNetworkRule(line.slice(2), true);
      if (rule) this.allowRules.push(rule);
      return;
    }

    const rule = this._parseNetworkRule(line, false);
    if (rule) this.blockRules.push(rule);
  }

  _parseCosmeticRule(line) {
    const sepIndex = line.indexOf('##');
    if (sepIndex === -1) return;

    const domainPart   = line.slice(0, sepIndex).trim();
    const selectorPart = line.slice(sepIndex + 2).trim();
    if (!selectorPart) return;

    if (!domainPart) {
      this.globalCosmetic.push(selectorPart);
      return;
    }

    const domains = domainPart.split(',').map(d => d.trim().toLowerCase());
    for (const domain of domains) {
      if (domain.startsWith('~')) continue;
      if (!this.cosmeticRules.has(domain)) {
        this.cosmeticRules.set(domain, []);
      }
      this.cosmeticRules.get(domain).push(selectorPart);
    }
  }

  _parseNetworkRule(line, isException) {
    let pattern = line;
    let options = {};

    const dollarIdx = this._findOptionsDollar(line);
    if (dollarIdx !== -1) {
      const optStr = line.slice(dollarIdx + 1);
      pattern      = line.slice(0, dollarIdx);
      options      = this._parseOptions(optStr);
    }

    if (!pattern) return null;

    const matcher = this._compilePattern(pattern);
    if (!matcher) return null;

    if (!isException && !Object.keys(options).length) {
      const domain = this._extractDomainFromPattern(pattern);
      if (domain) this.trackerDomains.add(domain);
    }

    return { raw: line, pattern, matcher, options, isException };
  }

  _findOptionsDollar(line) {
    if (line.startsWith('/') && line.lastIndexOf('/') > 0) {
      const closeSlash = line.lastIndexOf('/');
      return line.indexOf('$', closeSlash);
    }
    return line.lastIndexOf('$');
  }

  _parseOptions(optStr) {
    const options = { types: null, thirdParty: null, domains: null };

    const TYPE_MAP = {
      'script': 'script', 'image': 'image', 'stylesheet': 'stylesheet',
      'object': 'object', 'xmlhttprequest': 'xmlhttprequest',
      'subdocument': 'sub_frame', 'ping': 'ping', 'media': 'media',
      'font': 'font', 'other': 'other', 'websocket': 'websocket',
      'document': 'main_frame',
    };

    for (const part of optStr.split(',')) {
      const p = part.trim().toLowerCase();
      if (!p) continue;

      if (p === 'third-party' || p === '3p') { options.thirdParty = true; continue; }
      if (p === '~third-party' || p === '~3p' || p === 'first-party' || p === '1p') {
        options.thirdParty = false; continue;
      }

      if (p.startsWith('domain=')) {
        const domainStr = p.slice(7);
        options.domains = { include: [], exclude: [] };
        for (const d of domainStr.split('|')) {
          if (d.startsWith('~')) options.domains.exclude.push(d.slice(1));
          else if (d) options.domains.include.push(d);
        }
        continue;
      }

      const negated  = p.startsWith('~');
      const typeName = negated ? p.slice(1) : p;
      if (TYPE_MAP[typeName] && !negated) {
        if (!options.types) options.types = new Set();
        options.types.add(TYPE_MAP[typeName]);
      }
    }

    return options;
  }

  _compilePattern(pattern) {
    try {
      if (pattern.startsWith('/') && pattern.length > 2) {
        const lastSlash = pattern.lastIndexOf('/');
        if (lastSlash > 0) {
          const body     = pattern.slice(1, lastSlash);
          const flags    = pattern.slice(lastSlash + 1);
          const cacheKey = `${body}::${flags}`;
          if (!this._regexCache.has(cacheKey)) {
            this._regexCache.set(cacheKey, new RegExp(body, flags));
          }
          const regex = this._regexCache.get(cacheKey);
          return (url) => regex.test(url);
        }
      }

      if (pattern.startsWith('||')) {
        const domain  = pattern.slice(2).replace(/\^$/, '').replace(/\*$/, '');
        const escaped = escapeForRegex(domain).replace(/\\\*/g, '.*');
        const regex   = new RegExp(`(^|[./])${escaped}([/?&#^]|$)`, 'i');
        return (url) => regex.test(url);
      }

      if (pattern.startsWith('|') && !pattern.startsWith('||')) {
        const rest    = pattern.slice(1);
        const escaped = escapeForRegex(rest).replace(/\\\*/g, '.*');
        const regex   = new RegExp(`^${escaped}`, 'i');
        return (url) => regex.test(url);
      }

      if (pattern.endsWith('|') && !pattern.endsWith('||')) {
        const rest    = pattern.slice(0, -1);
        const escaped = escapeForRegex(rest).replace(/\\\*/g, '.*');
        const regex   = new RegExp(`${escaped}$`, 'i');
        return (url) => regex.test(url);
      }

      if (pattern.includes('*') || pattern.includes('^')) {
        const regexStr = escapeForRegex(pattern)
          .replace(/\\\*/g, '.*')
          .replace(/\\\^/g, '([/?&#]|$)');
        const regex = new RegExp(regexStr, 'i');
        return (url) => regex.test(url);
      }

      const lower = pattern.toLowerCase();
      return (url) => url.toLowerCase().includes(lower);

    } catch {
      return null;
    }
  }

  _extractDomainFromPattern(pattern) {
    if (pattern.startsWith('||')) {
      const raw   = pattern.slice(2);
      const clean = raw.replace(/[/^*?&#].*/, '').toLowerCase();
      if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(clean)) {
        return clean;
      }
    }
    return null;
  }

  _matchesRule(rule, url, type, requestHost, initiatorHost, isThirdParty) {
    const { matcher, options } = rule;
    if (!matcher(url)) return false;

    if (options.types && options.types.size > 0) {
      if (!options.types.has(type)) return false;
    }

    if (options.thirdParty !== null && options.thirdParty !== undefined) {
      if (options.thirdParty !== isThirdParty) return false;
    }

    if (options.domains) {
      const { include, exclude } = options.domains;
      if (exclude.length > 0 && initiatorHost) {
        for (const d of exclude) {
          if (initiatorHost === d || initiatorHost.endsWith('.' + d)) return false;
        }
      }
      if (include.length > 0 && initiatorHost) {
        let included = false;
        for (const d of include) {
          if (initiatorHost === d || initiatorHost.endsWith('.' + d)) {
            included = true; break;
          }
        }
        if (!included) return false;
      }
    }

    return true;
  }
}

function escapeForRegex(str) {
  return str.replace(/[-[\]{}()+?.,\\$|#\s]/g, '\\$&');
}