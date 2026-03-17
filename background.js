/**
 * PrivShield – Background Service Worker
 * PrivMITLab | https://github.com/privmitlab/privshield
 *
 * Responsibilities:
 *  - Load and parse filter lists from storage
 *  - Intercept network requests via webRequest API
 *  - Apply blocking decisions based on filter engine
 *  - Manage per-site settings
 *  - Log blocked requests locally
 *  - Handle messages from popup and dashboard
 *
 * PRIVACY: No external calls. No telemetry. All local.
 */

import { FilterEngine } from './utils/parser.js';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const PRIVSHIELD_VERSION   = '1.0.0';
const MAX_LOG_ENTRIES      = 500;   // Rolling log cap (performance)
const DEFAULT_FILTERS_PATH = '/filters/default_filters.txt';

// Request types we can intercept
const BLOCKABLE_TYPES = [
  'script',
  'image',
  'stylesheet',
  'object',
  'xmlhttprequest',
  'ping',
  'beacon',
  'media',
  'font',
  'other'
];

// ─────────────────────────────────────────────
// STATE (in-memory, ephemeral per service worker)
// ─────────────────────────────────────────────

const state = {
  engine:           null,   // FilterEngine instance
  enabled:          true,   // Global ON/OFF
  strictMode:       false,  // Block all third-party
  scriptBlock:      false,  // Block all scripts globally
  spoofUserAgent:   false,  // UA spoofing toggle
  stripReferrer:    true,   // Strip referrer headers
  blockFingerprint: true,   // Block fingerprinting scripts
  siteSettings:     {},     // { hostname: { enabled, allowScripts, ... } }
  blockedLog:       [],     // Rolling array of blocked request entries
  blockCount:       0,      // Total blocked since install
  sessionCount:     0,      // Blocked this session
};

// ─────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────

/**
 * Boot sequence:
 * 1. Load persisted settings from storage
 * 2. Load filter lists (cached or default)
 * 3. Compile filter engine
 * 4. Register request interceptors
 */
async function initialize() {
  console.log(`[PrivShield] v${PRIVSHIELD_VERSION} initializing...`);

  try {
    await loadSettings();
    await loadAndCompileFilters();
    registerRequestInterceptors();
    console.log('[PrivShield] Ready. Protection active.');
  } catch (err) {
    console.error('[PrivShield] Initialization error:', err);
  }
}

// ─────────────────────────────────────────────
// SETTINGS MANAGEMENT
// ─────────────────────────────────────────────

async function loadSettings() {
  const stored = await chrome.storage.local.get([
    'enabled',
    'strictMode',
    'scriptBlock',
    'spoofUserAgent',
    'stripReferrer',
    'blockFingerprint',
    'siteSettings',
    'blockCount',
    'blockedLog',
    'customRules',
    'filterLists',
  ]);

  // Merge stored settings into state (use defaults if not set)
  if (typeof stored.enabled       === 'boolean') state.enabled       = stored.enabled;
  if (typeof stored.strictMode    === 'boolean') state.strictMode    = stored.strictMode;
  if (typeof stored.scriptBlock   === 'boolean') state.scriptBlock   = stored.scriptBlock;
  if (typeof stored.spoofUserAgent=== 'boolean') state.spoofUserAgent= stored.spoofUserAgent;
  if (typeof stored.stripReferrer === 'boolean') state.stripReferrer = stored.stripReferrer;
  if (typeof stored.blockFingerprint === 'boolean') state.blockFingerprint = stored.blockFingerprint;

  if (stored.siteSettings && typeof stored.siteSettings === 'object') {
    state.siteSettings = stored.siteSettings;
  }

  if (typeof stored.blockCount === 'number') {
    state.blockCount = stored.blockCount;
  }

  if (Array.isArray(stored.blockedLog)) {
    state.blockedLog = stored.blockedLog.slice(-MAX_LOG_ENTRIES);
  }

  console.log('[PrivShield] Settings loaded:', {
    enabled:       state.enabled,
    strictMode:    state.strictMode,
    scriptBlock:   state.scriptBlock,
    stripReferrer: state.stripReferrer,
  });
}

async function saveSettings() {
  await chrome.storage.local.set({
    enabled:          state.enabled,
    strictMode:       state.strictMode,
    scriptBlock:      state.scriptBlock,
    spoofUserAgent:   state.spoofUserAgent,
    stripReferrer:    state.stripReferrer,
    blockFingerprint: state.blockFingerprint,
    siteSettings:     state.siteSettings,
    blockCount:       state.blockCount,
    blockedLog:       state.blockedLog.slice(-MAX_LOG_ENTRIES),
  });
}

// ─────────────────────────────────────────────
// FILTER LIST LOADING & COMPILATION
// ─────────────────────────────────────────────

async function loadAndCompileFilters() {
  let rawRules = '';

  // 1. Load default bundled filter list
  try {
    const response = await fetch(chrome.runtime.getURL(DEFAULT_FILTERS_PATH));
    rawRules = await response.text();
    console.log('[PrivShield] Default filters loaded:', rawRules.split('\n').length, 'lines');
  } catch (err) {
    console.warn('[PrivShield] Failed to load default filters:', err);
  }

  // 2. Load cached external filter lists from storage
  const stored = await chrome.storage.local.get(['filterLists', 'customRules']);

  if (stored.filterLists && typeof stored.filterLists === 'object') {
    for (const [name, content] of Object.entries(stored.filterLists)) {
      if (typeof content === 'string' && content.length > 0) {
        rawRules += '\n' + content;
        console.log(`[PrivShield] Loaded cached list: ${name}`);
      }
    }
  }

  // 3. Append custom user rules
  if (typeof stored.customRules === 'string' && stored.customRules.trim()) {
    rawRules += '\n' + stored.customRules;
    console.log('[PrivShield] Custom user rules appended');
  }

  // 4. Compile into engine
  state.engine = new FilterEngine();
  state.engine.compile(rawRules);

  console.log('[PrivShield] Filter engine compiled.');
  console.log('[PrivShield] Stats:', state.engine.getStats());
}

// ─────────────────────────────────────────────
// REQUEST INTERCEPTORS
// ─────────────────────────────────────────────

function registerRequestInterceptors() {
  // Block requests based on filter engine
  chrome.webRequest.onBeforeRequest.addListener(
    handleBeforeRequest,
    { urls: ['<all_urls>'] },
    ['blocking']
  );

  // Modify headers (referrer stripping, UA spoofing)
  chrome.webRequest.onBeforeSendHeaders.addListener(
    handleBeforeSendHeaders,
    { urls: ['<all_urls>'] },
    ['blocking', 'requestHeaders']
  );

  console.log('[PrivShield] Request interceptors registered.');
}

/**
 * Main request decision handler.
 * Returns { cancel: true } to block, or {} to allow.
 */
function handleBeforeRequest(details) {
  // Don't intercept extension's own requests
  if (details.url.startsWith(chrome.runtime.getURL(''))) {
    return {};
  }

  // Global kill switch
  if (!state.enabled) {
    return {};
  }

  const url       = details.url;
  const tabId     = details.tabId;
  const type      = details.type;
  const initiator = details.initiator || details.documentUrl || '';

  // Extract hostname of the request target
  const requestHost   = extractHostname(url);
  const initiatorHost = extractHostname(initiator);

  // Per-site override: if site is whitelisted, allow everything
  if (isSiteWhitelisted(initiatorHost)) {
    return {};
  }

  // Check per-site settings
  const siteConfig = state.siteSettings[initiatorHost] || {};

  // If protection disabled for this site
  if (siteConfig.enabled === false) {
    return {};
  }

  // Strict mode: block ALL third-party requests
  if ((state.strictMode || siteConfig.strictMode) &&
      requestHost &&
      initiatorHost &&
      requestHost !== initiatorHost &&
      !isSubdomain(requestHost, initiatorHost)) {

    const shouldBlock = true;
    if (shouldBlock) {
      logBlockedRequest({
        url,
        type,
        reason: 'strict-mode-third-party',
        requestHost,
        initiatorHost,
        tabId,
        timestamp: Date.now(),
      });
      return { cancel: true };
    }
  }

  // Script blocking (global or per-site)
  if (type === 'script') {
    const blockScripts = state.scriptBlock || siteConfig.blockScripts;
    if (blockScripts) {
      logBlockedRequest({
        url,
        type,
        reason: 'script-block',
        requestHost,
        initiatorHost,
        tabId,
        timestamp: Date.now(),
      });
      return { cancel: true };
    }
  }

  // Filter engine matching
  if (state.engine) {
    const decision = state.engine.shouldBlock({
      url,
      type,
      requestHost,
      initiatorHost,
      isThirdParty: requestHost !== initiatorHost,
    });

    if (decision.block) {
      logBlockedRequest({
        url,
        type,
        reason:       decision.reason || 'filter-match',
        rule:         decision.rule   || '',
        requestHost,
        initiatorHost,
        tabId,
        timestamp:    Date.now(),
      });

      // Update badge
      updateBadge(tabId);

      return { cancel: true };
    }
  }

  return {};
}

/**
 * Header modification handler.
 * Strips Referer header, optionally spoofs User-Agent.
 */
function handleBeforeSendHeaders(details) {
  if (!state.enabled) return {};

  const initiator     = details.initiator || '';
  const initiatorHost = extractHostname(initiator);

  if (isSiteWhitelisted(initiatorHost)) return {};

  const headers = details.requestHeaders || [];
  const modified = [];
  let changed = false;

  for (const header of headers) {
    const name = header.name.toLowerCase();

    // Strip Referer header (prevents cross-site tracking via referrer)
    if (name === 'referer' && state.stripReferrer) {
      const refererHost = extractHostname(header.value);
      const targetHost  = extractHostname(details.url);

      // Only strip cross-origin referrers
      if (refererHost && targetHost && refererHost !== targetHost) {
        changed = true;
        // Don't push — effectively removes the header
        continue;
      }
    }

    // Spoof User-Agent if enabled
    if (name === 'user-agent' && state.spoofUserAgent) {
      modified.push({
        name:  'User-Agent',
        value: getGenericUserAgent(),
      });
      changed = true;
      continue;
    }

    modified.push(header);
  }

  if (changed) {
    return { requestHeaders: modified };
  }

  return {};
}

// ─────────────────────────────────────────────
// LOGGING
// ─────────────────────────────────────────────

function logBlockedRequest(entry) {
  // Increment counters
  state.blockCount++;
  state.sessionCount++;

  // Add to rolling log
  state.blockedLog.push(entry);

  // Cap log size
  if (state.blockedLog.length > MAX_LOG_ENTRIES) {
    state.blockedLog = state.blockedLog.slice(-MAX_LOG_ENTRIES);
  }

  // Persist counters (debounced via save queue)
  scheduleSettingsSave();
}

// Debounced save to avoid excessive storage writes
let saveTimer = null;
function scheduleSettingsSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveSettings();
    saveTimer = null;
  }, 2000);
}

// ─────────────────────────────────────────────
// BADGE
// ─────────────────────────────────────────────

const tabBlockCounts = new Map(); // { tabId: count }

function updateBadge(tabId) {
  if (!tabId || tabId < 0) return;

  const current = tabBlockCounts.get(tabId) || 0;
  const updated = current + 1;
  tabBlockCounts.set(tabId, updated);

  chrome.action.setBadgeText({
    text:  updated > 999 ? '999+' : String(updated),
    tabId: tabId,
  }).catch(() => {});

  chrome.action.setBadgeBackgroundColor({
    color: '#e74c3c',
    tabId: tabId,
  }).catch(() => {});
}

// Reset badge when tab navigates
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabBlockCounts.set(tabId, 0);
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
  }
});

// Clean up closed tabs
chrome.tabs.onRemoved.addListener((tabId) => {
  tabBlockCounts.delete(tabId);
});

// ─────────────────────────────────────────────
// MESSAGE HANDLER (Popup ↔ Dashboard ↔ Background)
// ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(err => sendResponse({ error: err.message }));

  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  const { action, payload } = message;

  switch (action) {

    // ── Global toggle
    case 'GET_STATE':
      return {
        enabled:          state.enabled,
        strictMode:       state.strictMode,
        scriptBlock:      state.scriptBlock,
        spoofUserAgent:   state.spoofUserAgent,
        stripReferrer:    state.stripReferrer,
        blockFingerprint: state.blockFingerprint,
        blockCount:       state.blockCount,
        sessionCount:     state.sessionCount,
        engineStats:      state.engine ? state.engine.getStats() : {},
      };

    case 'SET_ENABLED':
      state.enabled = Boolean(payload.enabled);
      await saveSettings();
      return { ok: true, enabled: state.enabled };

    case 'SET_STRICT_MODE':
      state.strictMode = Boolean(payload.strictMode);
      await saveSettings();
      return { ok: true };

    case 'SET_SCRIPT_BLOCK':
      state.scriptBlock = Boolean(payload.scriptBlock);
      await saveSettings();
      return { ok: true };

    case 'SET_SPOOF_UA':
      state.spoofUserAgent = Boolean(payload.spoofUserAgent);
      await saveSettings();
      return { ok: true };

    case 'SET_STRIP_REFERRER':
      state.stripReferrer = Boolean(payload.stripReferrer);
      await saveSettings();
      return { ok: true };

    case 'SET_FINGERPRINT_BLOCK':
      state.blockFingerprint = Boolean(payload.blockFingerprint);
      await saveSettings();
      return { ok: true };

    // ── Site-level settings
    case 'GET_SITE_SETTINGS': {
      const host = payload.host;
      return {
        host,
        settings: state.siteSettings[host] || {},
        isWhitelisted: isSiteWhitelisted(host),
      };
    }

    case 'SET_SITE_ENABLED': {
      const { host, enabled } = payload;
      if (!state.siteSettings[host]) state.siteSettings[host] = {};
      state.siteSettings[host].enabled = Boolean(enabled);
      await saveSettings();
      return { ok: true };
    }

    case 'SET_SITE_WHITELIST': {
      const { host, whitelisted } = payload;
      if (!state.siteSettings[host]) state.siteSettings[host] = {};
      state.siteSettings[host].whitelisted = Boolean(whitelisted);
      await saveSettings();
      return { ok: true };
    }

    case 'SET_SITE_BLOCK_SCRIPTS': {
      const { host, blockScripts } = payload;
      if (!state.siteSettings[host]) state.siteSettings[host] = {};
      state.siteSettings[host].blockScripts = Boolean(blockScripts);
      await saveSettings();
      return { ok: true };
    }

    case 'SET_SITE_STRICT': {
      const { host, strictMode } = payload;
      if (!state.siteSettings[host]) state.siteSettings[host] = {};
      state.siteSettings[host].strictMode = Boolean(strictMode);
      await saveSettings();
      return { ok: true };
    }

    // ── Logs
    case 'GET_LOGS':
      return {
        logs:         state.blockedLog.slice().reverse(), // Most recent first
        blockCount:   state.blockCount,
        sessionCount: state.sessionCount,
      };

    case 'CLEAR_LOGS':
      state.blockedLog   = [];
      state.sessionCount = 0;
      await saveSettings();
      return { ok: true };

    // ── Tab block count
    case 'GET_TAB_COUNT': {
      const tabId = payload.tabId;
      return { count: tabBlockCounts.get(tabId) || 0 };
    }

    // ── Filter list management
    case 'UPDATE_FILTER_LIST': {
      const { name, url: listUrl } = payload;
      try {
        const content = await fetchFilterList(listUrl);
        const stored  = await chrome.storage.local.get('filterLists');
        const lists   = stored.filterLists || {};
        lists[name]   = content;
        await chrome.storage.local.set({ filterLists: lists });
        await loadAndCompileFilters(); // Recompile
        return { ok: true, lines: content.split('\n').length };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'REMOVE_FILTER_LIST': {
      const { name } = payload;
      const stored   = await chrome.storage.local.get('filterLists');
      const lists    = stored.filterLists || {};
      delete lists[name];
      await chrome.storage.local.set({ filterLists: lists });
      await loadAndCompileFilters();
      return { ok: true };
    }

    case 'GET_FILTER_LISTS': {
      const stored = await chrome.storage.local.get(['filterLists', 'customRules']);
      const lists  = stored.filterLists || {};
      return {
        lists:       Object.keys(lists).map(n => ({ name: n, lines: lists[n].split('\n').length })),
        customRules: stored.customRules || '',
      };
    }

    case 'SAVE_CUSTOM_RULES': {
      const { rules } = payload;
      await chrome.storage.local.set({ customRules: rules });
      await loadAndCompileFilters();
      return { ok: true };
    }

    case 'RELOAD_FILTERS':
      await loadAndCompileFilters();
      return { ok: true, stats: state.engine ? state.engine.getStats() : {} };

    // ── Default
    default:
      return { error: `Unknown action: ${action}` };
  }
}

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────

function extractHostname(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isSubdomain(host, parentHost) {
  if (!host || !parentHost) return false;
  return host === parentHost || host.endsWith('.' + parentHost);
}

function isSiteWhitelisted(host) {
  if (!host) return false;
  const cfg = state.siteSettings[host];
  return cfg && cfg.whitelisted === true;
}

function getGenericUserAgent() {
  // Return a common, non-identifying UA string
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
}

async function fetchFilterList(url) {
  // Only allow fetching from known HTTPS sources
  if (!url.startsWith('https://')) {
    throw new Error('Only HTTPS filter list URLs are allowed');
  }

  const response = await fetch(url, {
    method:  'GET',
    headers: { 'Cache-Control': 'no-cache' },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.text();
}

// ─────────────────────────────────────────────
// STARTUP
// ─────────────────────────────────────────────

// Run on service worker install
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    console.log('[PrivShield] First install. Setting defaults.');
    await chrome.storage.local.set({
      enabled:          true,
      strictMode:       false,
      scriptBlock:      false,
      spoofUserAgent:   false,
      stripReferrer:    true,
      blockFingerprint: true,
      siteSettings:     {},
      blockCount:       0,
      blockedLog:       [],
      customRules:      '',
      filterLists:      {},
    });
  }

  await initialize();
});

// Run on service worker restart (browser restart, etc.)
initialize();