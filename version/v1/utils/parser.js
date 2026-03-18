/**
 * PrivShield – Filter Engine & Rule Parser
 * PrivMITLab
 *
 * Supports:
 *  - Network filter rules (||example.com^, /regex/, @@allow)
 *  - Option filters ($script, $image, $third-party, etc.)
 *  - Element hiding rules (##.selector)
 *  - Comment lines (!, #)
 *
 * Design: fast matching via compiled sets and regex cache
 */

export class FilterEngine {

  constructor() {
    // Network rules
    this.blockRules   = [];  // Array of compiled rule objects
    this.allowRules   = [];  // Whitelist/exception rules (@@)

    // Cosmetic rules (element hiding)
    this.cosmeticRules = new Map(); // { hostname -> [selectors] }
    this.globalCosmetic = [];       // Applies to all sites

    // Tracking / fingerprinting domain sets
    this.trackerDomains     = new Set();
    this.fingerprintDomains = new Set();

    // Stats
    this.stats = {
      totalRules:     0,
      blockRules:     0,
      allowRules:     0,
      cosmeticRules:  0,
      parseErrors:    0,
      compileTime:    0,
    };

    // Regex cache to avoid recompilation
    this._regexCache = new Map();
  }

  // ──────────────────────────────────────────
  // PUBLIC API
  // ──────────────────────────────────────────

  /**
   * Parse and compile raw filter list text.
   * @param {string} rawText - Raw filter list content
   */
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

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('#')) {
        continue;
      }

      try {
        this._parseLine(trimmed);
        this.stats.totalRules++;
      } catch (err) {
        this.stats.parseErrors++;
      }
    }

    this.stats.blockRules    = this.blockRules.length;
    this.stats.allowRules    = this.allowRules.length;
    this.stats.cosmeticRules = this.globalCosmetic.length +
      [...this.cosmeticRules.values()].reduce((s, a) => s + a.length, 0);
    this.stats.compileTime   = Date.now() - start;
  }

  /**
   * Main decision function: should this request be blocked?
   * @param {Object} request - { url, type, requestHost, initiatorHost, isThirdParty }
   * @returns {{ block: boolean, reason: string, rule: string }}
   */
  shouldBlock(request) {
    const { url, type, requestHost, initiatorHost, isThirdParty } = request;

    // 1. Check allow (whitelist) rules first — they override blocks
    for (const rule of this.allowRules) {
      if (this._matchesRule(rule, url, type, requestHost, initiatorHost, isThirdParty)) {
        return { block: false, reason: 'whitelisted', rule: rule.raw };
      }
    }

    // 2. Check tracker domain set (fast path)
    if (requestHost && this.trackerDomains.has(requestHost)) {
      return { block: true, reason: 'tracker-domain', rule: `||${requestHost}^` };
    }

    // 3. Check block rules
    for (const rule of this.blockRules) {
      if (this._matchesRule(rule, url, type, requestHost, initiatorHost, isThirdParty)) {
        return { block: true, reason: 'filter-rule', rule: rule.raw };
      }
    }

    return { block: false, reason: 'allowed' };
  }

  /**
   * Get cosmetic selectors for a given hostname.
   * @param {string} hostname
   * @returns {string[]} Array of CSS selectors to hide
   */
  getCosmeticSelectors(hostname) {
    const selectors = [...this.globalCosmetic];

    if (hostname) {
      // Exact match
      if (this.cosmeticRules.has(hostname)) {
        selectors.push(...this.cosmeticRules.get(hostname));
      }

      // Parent domain match (sub.example.com → example.com)
      const parts = hostname.split('.');
      for (let i = 1; i < parts.length - 1; i++) {
        const parent = parts.slice(i).join('.');
        if (this.cosmeticRules.has(parent)) {
          selectors.push(...this.cosmeticRules.get(parent));
        }
      }
    }

    return [...new Set(selectors)]; // Deduplicate
  }

  /**
   * Return engine statistics.
   */
  getStats() {
    return { ...this.stats };
  }

  // ──────────────────────────────────────────
  // PARSING
  // ──────────────────────────────────────────

  _parseLine(line) {
    // Element hiding rules: ##.selector or example.com##.selector
    if (line.includes('##')) {
      this._parseCosmeticRule(line);
      return;
    }

    // Extended CSS hiding: #?#selector (skip for now, advanced)
    if (line.includes('#?#')) {
      return;
    }

    // Exception / allow rule: @@...
    if (line.startsWith('@@')) {
      const rule = this._parseNetworkRule(line.slice(2), true);
      if (rule) this.allowRules.push(rule);
      return;
    }

    // Regular network rule
    const rule = this._parseNetworkRule(line, false);
    if (rule) this.blockRules.push(rule);
  }

  /**
   * Parse element hiding rule.
   * Formats:
   *   ##.ads                  → global
   *   example.com##.ads       → site-specific
   *   ~example.com##.ads      → exclude site (skip complex)
   */
  _parseCosmeticRule(line) {
    const sepIndex = line.indexOf('##');
    if (sepIndex === -1) return;

    const domainPart   = line.slice(0, sepIndex).trim();
    const selectorPart = line.slice(sepIndex + 2).trim();

    if (!selectorPart) return;

    if (!domainPart) {
      // Global cosmetic rule
      this.globalCosmetic.push(selectorPart);
      return;
    }

    // Site-specific rules (may be comma-separated)
    const domains = domainPart.split(',').map(d => d.trim().toLowerCase());

    for (const domain of domains) {
      if (domain.startsWith('~')) continue; // Skip exclusion rules

      if (!this.cosmeticRules.has(domain)) {
        this.cosmeticRules.set(domain, []);
      }
      this.cosmeticRules.get(domain).push(selectorPart);
    }
  }

  /**
   * Parse a network filter rule into a compiled rule object.
   * Supports:
   *   ||example.com^           → domain anchor
   *   |https://example.com     → URL start anchor
   *   /regex/                  → regex rule
   *   plain string             → substring match
   *   $option1,option2         → options (type, third-party, domain=)
   */
  _parseNetworkRule(line, isException) {
    let pattern = line;
    let options = {};

    // Extract options after $
    const dollarIdx = this._findOptionsDollar(line);
    if (dollarIdx !== -1) {
      const optStr = line.slice(dollarIdx + 1);
      pattern      = line.slice(0, dollarIdx);
      options      = this._parseOptions(optStr);
    }

    // Skip if empty pattern
    if (!pattern) return null;

    // Compile pattern to matcher function
    const matcher = this._compilePattern(pattern);
    if (!matcher) return null;

    // Fast-path: extract domain for domain-based tracker set
    if (!isException && !Object.keys(options).length) {
      const domain = this._extractDomainFromPattern(pattern);
      if (domain) {
        this.trackerDomains.add(domain);
        // Still add as full rule for accuracy
      }
    }

    return {
      raw:       line,
      pattern,
      matcher,
      options,
      isException,
    };
  }

  /**
   * Find the $ that separates pattern from options,
   * ignoring $ inside regex patterns (/.../).
   */
  _findOptionsDollar(line) {
    if (line.startsWith('/') && line.lastIndexOf('/') > 0) {
      // Regex rule: find $ after closing /
      const closeSlash = line.lastIndexOf('/');
      const idx = line.indexOf('$', closeSlash);
      return idx;
    }
    return line.lastIndexOf('$');
  }

  /**
   * Parse option string: "script,third-party,domain=example.com|~foo.com"
   */
  _parseOptions(optStr) {
    const options = {
      types:       null,  // Set of allowed types (null = all)
      thirdParty:  null,  // true = only third-party, false = only first-party
      domains:     null,  // { include: [], exclude: [] }
    };

    const TYPE_MAP = {
      'script':       'script',
      'image':        'image',
      'stylesheet':   'stylesheet',
      'object':       'object',
      'xmlhttprequest': 'xmlhttprequest',
      'subdocument':  'sub_frame',
      'ping':         'ping',
      'media':        'media',
      'font':         'font',
      'other':        'other',
      'websocket':    'websocket',
      'document':     'main_frame',
    };

    const parts = optStr.split(',');

    for (const part of parts) {
      const p = part.trim().toLowerCase();

      if (!p) continue;

      // Third-party filter
      if (p === 'third-party' || p === '3p') {
        options.thirdParty = true;
        continue;
      }
      if (p === '~third-party' || p === '~3p' || p === 'first-party' || p === '1p') {
        options.thirdParty = false;
        continue;
      }

      // Domain filter: domain=example.com|~excluded.com
      if (p.startsWith('domain=')) {
        const domainStr = p.slice(7);
        options.domains = { include: [], exclude: [] };
        for (const d of domainStr.split('|')) {
          if (d.startsWith('~')) {
            options.domains.exclude.push(d.slice(1));
          } else if (d) {
            options.domains.include.push(d);
          }
        }
        continue;
      }

      // Type filters
      const negated = p.startsWith('~');
      const typeName = negated ? p.slice(1) : p;

      if (TYPE_MAP[typeName]) {
        if (!options.types) options.types = new Set();
        if (negated) {
          // ~script means everything BUT script — skip for simplicity
        } else {
          options.types.add(TYPE_MAP[typeName]);
        }
      }

      // Important, collapse, etc. — ignore for now
    }

    return options;
  }

  /**
   * Compile a filter pattern into a matcher function.
   * Returns function(url: string) → boolean
   */
  _compilePattern(pattern) {
    try {
      // Regex pattern: /regexp/flags
      if (pattern.startsWith('/') && pattern.length > 2) {
        const lastSlash = pattern.lastIndexOf('/');
        if (lastSlash > 0) {
          const body  = pattern.slice(1, lastSlash);
          const flags = pattern.slice(lastSlash + 1);

          const cacheKey = `${body}::${flags}`;
          if (!this._regexCache.has(cacheKey)) {
            this._regexCache.set(cacheKey, new RegExp(body, flags));
          }
          const regex = this._regexCache.get(cacheKey);
          return (url) => regex.test(url);
        }
      }

      // Domain anchor: ||example.com^
      if (pattern.startsWith('||')) {
        const domain = pattern.slice(2).replace(/\^$/, '').replace(/\*$/, '');

        // Build regex from domain pattern
        const escaped = escapeForRegex(domain).replace(/\\\*/g, '.*');
        const regex   = new RegExp(`(^|[./])${escaped}([/?&#^]|$)`, 'i');
        return (url) => regex.test(url);
      }

      // Start anchor: |https://
      if (pattern.startsWith('|') && !pattern.startsWith('||')) {
        const rest    = pattern.slice(1);
        const escaped = escapeForRegex(rest).replace(/\\\*/g, '.*');
        const regex   = new RegExp(`^${escaped}`, 'i');
        return (url) => regex.test(url);
      }

      // End anchor: example|
      if (pattern.endsWith('|') && !pattern.endsWith('||')) {
        const rest    = pattern.slice(0, -1);
        const escaped = escapeForRegex(rest).replace(/\\\*/g, '.*');
        const regex   = new RegExp(`${escaped}$`, 'i');
        return (url) => regex.test(url);
      }

      // Wildcard / plain substring
      if (pattern.includes('*') || pattern.includes('^')) {
        const regexStr = escapeForRegex(pattern)
          .replace(/\\\*/g, '.*')
          .replace(/\\\^/g, '([/?&#]|$)');
        const regex = new RegExp(regexStr, 'i');
        return (url) => regex.test(url);
      }

      // Plain substring match (fastest)
      const lower = pattern.toLowerCase();
      return (url) => url.toLowerCase().includes(lower);

    } catch (err) {
      return null;
    }
  }

  /**
   * Try to extract a pure domain from a pattern like ||example.com^
   */
  _extractDomainFromPattern(pattern) {
    if (pattern.startsWith('||')) {
      const raw = pattern.slice(2);
      // Clean up: remove ^ * and path
      const clean = raw.replace(/[/^*?&#].*/, '').toLowerCase();

      // Must look like a domain (at least one dot, no special chars)
      if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(clean)) {
        return clean;
      }
    }
    return null;
  }

  // ──────────────────────────────────────────
  // MATCHING
  // ──────────────────────────────────────────

  /**
   * Check if a compiled rule matches a given request.
   */
  _matchesRule(rule, url, type, requestHost, initiatorHost, isThirdParty) {
    const { matcher, options } = rule;

    // 1. URL pattern match
    if (!matcher(url)) return false;

    // 2. Type filter
    if (options.types && options.types.size > 0) {
      if (!options.types.has(type)) return false;
    }

    // 3. Third-party filter
    if (options.thirdParty !== null) {
      if (options.thirdParty !== isThirdParty) return false;
    }

    // 4. Domain filter
    if (options.domains) {
      const { include, exclude } = options.domains;

      // Check excludes first
      if (exclude.length > 0 && initiatorHost) {
        for (const d of exclude) {
          if (initiatorHost === d || initiatorHost.endsWith('.' + d)) {
            return false;
          }
        }
      }

      // Check includes
      if (include.length > 0 && initiatorHost) {
        let included = false;
        for (const d of include) {
          if (initiatorHost === d || initiatorHost.endsWith('.' + d)) {
            included = true;
            break;
          }
        }
        if (!included) return false;
      }
    }

    return true;
  }
}

// ──────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────

/**
 * Escape special regex characters (except * and ^ which we handle separately).
 */
function escapeForRegex(str) {
  return str.replace(/[-[\]{}()+?.,\\$|#\s]/g, '\\$&');
}