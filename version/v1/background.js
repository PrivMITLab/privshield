// /**
//  * PrivShield – Background Service Worker
//  * PrivMITLab
//  * MV3 Compatible – Uses declarativeNetRequest only
//  */

// import { FilterEngine } from './utils/parser.js';

// // ─────────────────────────────────────────────
// // CONSTANTS
// // ─────────────────────────────────────────────

// const PRIVSHIELD_VERSION   = '1.0.0';
// const MAX_LOG_ENTRIES      = 500;
// const DEFAULT_FILTERS_PATH = '/filters/default_filters.txt';
// const MAX_DNR_RULES        = 5000; // Chrome limit per extension

// // ─────────────────────────────────────────────
// // STATE
// // ─────────────────────────────────────────────

// const state = {
//   engine:           null,
//   enabled:          true,
//   strictMode:       false,
//   scriptBlock:      false,
//   spoofUserAgent:   false,
//   stripReferrer:    true,
//   blockFingerprint: true,
//   siteSettings:     {},
//   blockedLog:       [],
//   blockCount:       0,
//   sessionCount:     0,
// };

// const tabBlockCounts = new Map();

// // ─────────────────────────────────────────────
// // INITIALIZATION
// // ─────────────────────────────────────────────

// async function initialize() {
//   console.log(`[PrivShield] v${PRIVSHIELD_VERSION} initializing...`);
//   try {
//     await loadSettings();
//     await loadAndCompileFilters();
//     console.log('[PrivShield] Ready!');
//   } catch (err) {
//     console.error('[PrivShield] Init error:', err);
//   }
// }

// // ─────────────────────────────────────────────
// // SETTINGS
// // ─────────────────────────────────────────────

// async function loadSettings() {
//   const stored = await chrome.storage.local.get([
//     'enabled', 'strictMode', 'scriptBlock',
//     'spoofUserAgent', 'stripReferrer', 'blockFingerprint',
//     'siteSettings', 'blockCount', 'blockedLog',
//     'customRules', 'filterLists',
//   ]);

//   if (typeof stored.enabled          === 'boolean') state.enabled          = stored.enabled;
//   if (typeof stored.strictMode       === 'boolean') state.strictMode       = stored.strictMode;
//   if (typeof stored.scriptBlock      === 'boolean') state.scriptBlock      = stored.scriptBlock;
//   if (typeof stored.spoofUserAgent   === 'boolean') state.spoofUserAgent   = stored.spoofUserAgent;
//   if (typeof stored.stripReferrer    === 'boolean') state.stripReferrer    = stored.stripReferrer;
//   if (typeof stored.blockFingerprint === 'boolean') state.blockFingerprint = stored.blockFingerprint;

//   if (stored.siteSettings && typeof stored.siteSettings === 'object') {
//     state.siteSettings = stored.siteSettings;
//   }
//   if (typeof stored.blockCount === 'number') {
//     state.blockCount = stored.blockCount;
//   }
//   if (Array.isArray(stored.blockedLog)) {
//     state.blockedLog = stored.blockedLog.slice(-MAX_LOG_ENTRIES);
//   }

//   console.log('[PrivShield] Settings loaded. Enabled:', state.enabled);
// }

// async function saveSettings() {
//   await chrome.storage.local.set({
//     enabled:          state.enabled,
//     strictMode:       state.strictMode,
//     scriptBlock:      state.scriptBlock,
//     spoofUserAgent:   state.spoofUserAgent,
//     stripReferrer:    state.stripReferrer,
//     blockFingerprint: state.blockFingerprint,
//     siteSettings:     state.siteSettings,
//     blockCount:       state.blockCount,
//     blockedLog:       state.blockedLog.slice(-MAX_LOG_ENTRIES),
//   });
// }

// // ─────────────────────────────────────────────
// // FILTER LOADING
// // ─────────────────────────────────────────────

// async function loadAndCompileFilters() {
//   let rawRules = '';

//   // 1. Default bundled filters
//   try {
//     const response = await fetch(chrome.runtime.getURL(DEFAULT_FILTERS_PATH));
//     rawRules = await response.text();
//     console.log('[PrivShield] Default filters loaded.');
//   } catch (err) {
//     console.warn('[PrivShield] Default filters failed:', err.message);
//   }

//   // 2. Cached external lists
//   const stored = await chrome.storage.local.get(['filterLists', 'customRules']);
//   if (stored.filterLists && typeof stored.filterLists === 'object') {
//     for (const [name, content] of Object.entries(stored.filterLists)) {
//       if (typeof content === 'string' && content.length > 0) {
//         rawRules += '\n' + content;
//         console.log(`[PrivShield] Loaded list: ${name}`);
//       }
//     }
//   }

//   // 3. Custom user rules
//   if (typeof stored.customRules === 'string' && stored.customRules.trim()) {
//     rawRules += '\n' + stored.customRules;
//   }

//   // 4. Compile engine (for cosmetic rules + in-memory matching)
//   state.engine = new FilterEngine();
//   state.engine.compile(rawRules);

//   // 5. Apply declarativeNetRequest rules
//   await applyDeclarativeRules(rawRules);

//   console.log('[PrivShield] Engine compiled:', state.engine.getStats());
// }

// // ─────────────────────────────────────────────
// // DECLARATIVE NET REQUEST (MV3 WAY)
// // ─────────────────────────────────────────────

// async function applyDeclarativeRules(rawRules) {
//   try {
//     // Remove all existing dynamic rules first
//     const existing = await chrome.declarativeNetRequest.getDynamicRules();
//     const existingIds = existing.map(r => r.id);

//     if (existingIds.length > 0) {
//       await chrome.declarativeNetRequest.updateDynamicRules({
//         removeRuleIds: existingIds,
//       });
//     }

//     // Convert filter rules to DNR format
//     const dnrRules = convertToDNR(rawRules);

//     if (dnrRules.length === 0) {
//       console.log('[PrivShield] No DNR rules to apply.');
//       return;
//     }

//     // Apply new rules (Chrome allows max 5000 dynamic rules)
//     const limited = dnrRules.slice(0, MAX_DNR_RULES);

//     await chrome.declarativeNetRequest.updateDynamicRules({
//       addRules: limited,
//     });

//     console.log(`[PrivShield] DNR rules applied: ${limited.length}`);

//   } catch (err) {
//     console.error('[PrivShield] DNR apply error:', err.message);
//   }
// }

// /**
//  * Convert Adblock-style rules to Chrome DNR format
//  */
// function convertToDNR(rawText) {
//   const rules   = [];
//   const lines   = rawText.split('\n');
//   let   ruleId  = 1;

//   // Resource type mapping
//   const TYPE_MAP = {
//     'script':         'script',
//     'image':          'image',
//     'stylesheet':     'stylesheet',
//     'object':         'object',
//     'xmlhttprequest': 'xmlhttprequest',
//     'subdocument':    'sub_frame',
//     'ping':           'ping',
//     'media':          'media',
//     'font':           'font',
//     'other':          'other',
//   };

//   for (const line of lines) {
//     const trimmed = line.trim();

//     // Skip comments and empty
//     if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('#')) continue;

//     // Skip cosmetic rules (handled by content.js)
//     if (trimmed.includes('##') || trimmed.includes('#?#')) continue;

//     // Skip too complex rules for DNR
//     if (trimmed.includes('$domain=') && trimmed.split('domain=')[1]?.includes('~')) continue;

//     try {
//       // Exception / allow rule
//       if (trimmed.startsWith('@@')) {
//         const rule = parseAllowRule(trimmed.slice(2), ruleId);
//         if (rule) {
//           rules.push(rule);
//           ruleId++;
//         }
//         continue;
//       }

//       // Block rule
//       const rule = parseBlockRule(trimmed, ruleId, TYPE_MAP);
//       if (rule) {
//         rules.push(rule);
//         ruleId++;
//       }

//     } catch (err) {
//       // Skip invalid rules silently
//     }

//     // Stop if we hit the limit
//     if (ruleId > MAX_DNR_RULES) break;
//   }

//   return rules;
// }

// function parseBlockRule(line, id, TYPE_MAP) {
//   let pattern = line;
//   let resourceTypes = null;
//   let domainType    = null; // 'thirdParty' | 'firstParty' | null

//   // Extract options
//   const dollarIdx = line.lastIndexOf('$');
//   if (dollarIdx > 0 && !line.startsWith('/')) {
//     const optStr = line.slice(dollarIdx + 1);
//     pattern      = line.slice(0, dollarIdx);

//     const opts = optStr.split(',');
//     const types = [];

//     for (const opt of opts) {
//       const o = opt.trim().toLowerCase();
//       if (TYPE_MAP[o]) {
//         types.push(TYPE_MAP[o]);
//       } else if (o === 'third-party' || o === '3p') {
//         domainType = 'thirdParty';
//       } else if (o === 'first-party' || o === '1p') {
//         domainType = 'firstParty';
//       }
//     }

//     if (types.length > 0) resourceTypes = types;
//   }

//   // Build URL filter
//   const urlFilter = buildUrlFilter(pattern);
//   if (!urlFilter) return null;

//   // Build DNR rule
//   const dnrRule = {
//     id,
//     priority: 1,
//     action:   { type: 'block' },
//     condition: {
//       urlFilter,
//       isUrlFilterCaseSensitive: false,
//     },
//   };

//   if (resourceTypes && resourceTypes.length > 0) {
//     dnrRule.condition.resourceTypes = resourceTypes;
//   } else {
//     // Default: block all resource types
//     dnrRule.condition.resourceTypes = [
//       'script', 'image', 'stylesheet', 'object',
//       'xmlhttprequest', 'ping', 'media', 'font',
//       'sub_frame', 'other',
//     ];
//   }

//   if (domainType === 'thirdParty') {
//     dnrRule.condition.domainType = 'thirdParty';
//   } else if (domainType === 'firstParty') {
//     dnrRule.condition.domainType = 'firstParty';
//   }

//   return dnrRule;
// }

// function parseAllowRule(line, id) {
//   let pattern = line;

//   // Remove options for simplicity
//   const dollarIdx = line.lastIndexOf('$');
//   if (dollarIdx > 0) {
//     pattern = line.slice(0, dollarIdx);
//   }

//   const urlFilter = buildUrlFilter(pattern);
//   if (!urlFilter) return null;

//   return {
//     id,
//     priority: 10, // Higher priority than block rules
//     action:   { type: 'allow' },
//     condition: {
//       urlFilter,
//       isUrlFilterCaseSensitive: false,
//       resourceTypes: [
//         'script', 'image', 'stylesheet', 'object',
//         'xmlhttprequest', 'ping', 'media', 'font',
//         'sub_frame', 'other', 'main_frame',
//       ],
//     },
//   };
// }

// /**
//  * Convert adblock pattern to DNR urlFilter format
//  */
// function buildUrlFilter(pattern) {
//   if (!pattern || pattern.length < 3) return null;

//   // Regex patterns - skip (DNR supports regexFilter but complex)
//   if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
//     return null; // Skip regex for now
//   }

//   // Domain anchor: ||example.com^
//   if (pattern.startsWith('||')) {
//     let domain = pattern.slice(2);
//     // Remove trailing ^ or *
//     domain = domain.replace(/[\^*]+$/, '');
//     if (!domain || domain.length < 3) return null;
//     // DNR uses || prefix too
//     return '||' + domain;
//   }

//   // Start anchor: |https://
//   if (pattern.startsWith('|') && !pattern.startsWith('||')) {
//     return pattern.slice(1);
//   }

//   // Plain string - must be long enough to be useful
//   if (pattern.length < 8) return null;

//   // Replace adblock wildcards with DNR wildcards
//   // DNR uses * for wildcards
//   const cleaned = pattern.replace(/\^/g, '*');
//   return cleaned;
// }

// // ─────────────────────────────────────────────
// // TAB TRACKING (for badge + logs)
// // ─────────────────────────────────────────────

// // Track blocked requests using declarativeNetRequest feedback
// async function updateBlockedCount(tabId) {
//   if (!tabId || tabId < 0) return;

//   const current = tabBlockCounts.get(tabId) || 0;
//   const updated = current + 1;
//   tabBlockCounts.set(tabId, updated);

//   try {
//     await chrome.action.setBadgeText({
//       text:  updated > 999 ? '999+' : String(updated),
//       tabId: tabId,
//     });
//     await chrome.action.setBadgeBackgroundColor({
//       color: '#e74c3c',
//       tabId: tabId,
//     });
//   } catch {}
// }

// // Listen for tab navigation to reset badge
// chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
//   if (changeInfo.status === 'loading') {
//     tabBlockCounts.set(tabId, 0);
//     chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});

//     // Log page visit for counting (privacy-safe, no URL stored)
//     logPageLoad(tabId);
//   }
// });

// chrome.tabs.onRemoved.addListener((tabId) => {
//   tabBlockCounts.delete(tabId);
// });

// function logPageLoad(tabId) {
//   // We use declarativeNetRequest matched rules to count blocks
//   // Check after a delay to let the page load
//   setTimeout(async () => {
//     try {
//       const rules = await chrome.declarativeNetRequest.getMatchedRules({
//         tabId,
//         minTimeStamp: Date.now() - 5000,
//       });

//       if (rules && rules.rulesMatchInfo) {
//         const count = rules.rulesMatchInfo.length;
//         if (count > 0) {
//           state.blockCount += count;
//           state.sessionCount += count;
//           tabBlockCounts.set(tabId, count);

//           // Update badge
//           chrome.action.setBadgeText({
//             text:  count > 999 ? '999+' : String(count),
//             tabId: tabId,
//           }).catch(() => {});

//           chrome.action.setBadgeBackgroundColor({
//             color: '#e74c3c',
//             tabId: tabId,
//           }).catch(() => {});

//           scheduleSettingsSave();
//         }
//       }
//     } catch (err) {
//       // getMatchedRules needs declarativeNetRequestFeedback permission
//       // Silent fail is OK
//     }
//   }, 3000);
// }

// // ─────────────────────────────────────────────
// // DEBOUNCED SAVE
// // ─────────────────────────────────────────────

// let saveTimer = null;
// function scheduleSettingsSave() {
//   if (saveTimer) clearTimeout(saveTimer);
//   saveTimer = setTimeout(() => {
//     saveSettings();
//     saveTimer = null;
//   }, 2000);
// }

// // ─────────────────────────────────────────────
// // MESSAGE HANDLER
// // ─────────────────────────────────────────────

// chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
//   handleMessage(message, sender)
//     .then(sendResponse)
//     .catch(err => sendResponse({ error: err.message }));
//   return true;
// });

// async function handleMessage(message, sender) {
//   const { action, payload } = message;

//   switch (action) {

//     case 'GET_STATE':
//       return {
//         enabled:          state.enabled,
//         strictMode:       state.strictMode,
//         scriptBlock:      state.scriptBlock,
//         spoofUserAgent:   state.spoofUserAgent,
//         stripReferrer:    state.stripReferrer,
//         blockFingerprint: state.blockFingerprint,
//         blockCount:       state.blockCount,
//         sessionCount:     state.sessionCount,
//         engineStats:      state.engine ? state.engine.getStats() : {},
//       };

//     case 'SET_ENABLED':
//       state.enabled = Boolean(payload.enabled);
//       await saveSettings();
//       // Enable/disable all DNR rules
//       await toggleDNRRules(state.enabled);
//       return { ok: true, enabled: state.enabled };

//     case 'SET_STRICT_MODE':
//       state.strictMode = Boolean(payload.strictMode);
//       await saveSettings();
//       await applyStrictModeRules();
//       return { ok: true };

//     case 'SET_SCRIPT_BLOCK':
//       state.scriptBlock = Boolean(payload.scriptBlock);
//       await saveSettings();
//       await applyScriptBlockRules();
//       return { ok: true };

//     case 'SET_SPOOF_UA':
//       state.spoofUserAgent = Boolean(payload.spoofUserAgent);
//       await saveSettings();
//       return { ok: true };

//     case 'SET_STRIP_REFERRER':
//       state.stripReferrer = Boolean(payload.stripReferrer);
//       await saveSettings();
//       return { ok: true };

//     case 'SET_FINGERPRINT_BLOCK':
//       state.blockFingerprint = Boolean(payload.blockFingerprint);
//       await saveSettings();
//       return { ok: true };

//     case 'GET_SITE_SETTINGS': {
//       const host = payload.host;
//       return {
//         host,
//         settings:     state.siteSettings[host] || {},
//         isWhitelisted: isSiteWhitelisted(host),
//       };
//     }

//     case 'SET_SITE_ENABLED': {
//       const { host, enabled } = payload;
//       if (!state.siteSettings[host]) state.siteSettings[host] = {};
//       state.siteSettings[host].enabled = Boolean(enabled);
//       await saveSettings();
//       return { ok: true };
//     }

//     case 'SET_SITE_WHITELIST': {
//       const { host, whitelisted } = payload;
//       if (!state.siteSettings[host]) state.siteSettings[host] = {};
//       state.siteSettings[host].whitelisted = Boolean(whitelisted);
//       await saveSettings();
//       // Update DNR rules for this domain
//       await applyWhitelistRule(host, Boolean(whitelisted));
//       return { ok: true };
//     }

//     case 'SET_SITE_BLOCK_SCRIPTS': {
//       const { host, blockScripts } = payload;
//       if (!state.siteSettings[host]) state.siteSettings[host] = {};
//       state.siteSettings[host].blockScripts = Boolean(blockScripts);
//       await saveSettings();
//       return { ok: true };
//     }

//     case 'SET_SITE_STRICT': {
//       const { host, strictMode } = payload;
//       if (!state.siteSettings[host]) state.siteSettings[host] = {};
//       state.siteSettings[host].strictMode = Boolean(strictMode);
//       await saveSettings();
//       return { ok: true };
//     }

//     case 'GET_LOGS':
//       return {
//         logs:         state.blockedLog.slice().reverse(),
//         blockCount:   state.blockCount,
//         sessionCount: state.sessionCount,
//       };

//     case 'CLEAR_LOGS':
//       state.blockedLog   = [];
//       state.sessionCount = 0;
//       await saveSettings();
//       return { ok: true };

//     case 'GET_TAB_COUNT': {
//       const tabId = payload.tabId;
//       return { count: tabBlockCounts.get(tabId) || 0 };
//     }

//     case 'UPDATE_FILTER_LIST': {
//       const { name, url: listUrl } = payload;
//       try {
//         const content = await fetchFilterList(listUrl);
//         const stored  = await chrome.storage.local.get('filterLists');
//         const lists   = stored.filterLists || {};
//         lists[name]   = content;
//         await chrome.storage.local.set({ filterLists: lists });
//         await loadAndCompileFilters();
//         return { ok: true, lines: content.split('\n').length };
//       } catch (err) {
//         return { ok: false, error: err.message };
//       }
//     }

//     case 'REMOVE_FILTER_LIST': {
//       const { name } = payload;
//       const stored   = await chrome.storage.local.get('filterLists');
//       const lists    = stored.filterLists || {};
//       delete lists[name];
//       await chrome.storage.local.set({ filterLists: lists });
//       await loadAndCompileFilters();
//       return { ok: true };
//     }

//     case 'GET_FILTER_LISTS': {
//       const stored = await chrome.storage.local.get(['filterLists', 'customRules']);
//       const lists  = stored.filterLists || {};
//       return {
//         lists:       Object.keys(lists).map(n => ({
//           name:  n,
//           lines: lists[n].split('\n').length,
//         })),
//         customRules: stored.customRules || '',
//       };
//     }

//     case 'SAVE_CUSTOM_RULES': {
//       const { rules } = payload;
//       await chrome.storage.local.set({ customRules: rules });
//       await loadAndCompileFilters();
//       return { ok: true };
//     }

//     case 'RELOAD_FILTERS':
//       await loadAndCompileFilters();
//       return { ok: true, stats: state.engine ? state.engine.getStats() : {} };

//     case 'GET_COSMETIC_SELECTORS': {
//       const { host } = payload;
//       const selectors = state.engine
//         ? state.engine.getCosmeticSelectors(host)
//         : [];
//       return { selectors };
//     }

//     default:
//       return { error: `Unknown action: ${action}` };
//   }
// }

// // ─────────────────────────────────────────────
// // DNR HELPER FUNCTIONS
// // ─────────────────────────────────────────────

// // Enable or disable all dynamic rules
// async function toggleDNRRules(enabled) {
//   try {
//     const existing = await chrome.declarativeNetRequest.getDynamicRules();

//     if (!enabled) {
//       // Remove all rules temporarily
//       const ids = existing.map(r => r.id);
//       if (ids.length > 0) {
//         await chrome.storage.local.set({
//           _pausedRules: existing,
//         });
//         await chrome.declarativeNetRequest.updateDynamicRules({
//           removeRuleIds: ids,
//         });
//       }
//     } else {
//       // Restore rules
//       const stored = await chrome.storage.local.get('_pausedRules');
//       if (stored._pausedRules && stored._pausedRules.length > 0) {
//         await chrome.declarativeNetRequest.updateDynamicRules({
//           addRules: stored._pausedRules,
//         });
//         await chrome.storage.local.remove('_pausedRules');
//       } else {
//         // Recompile from scratch
//         await loadAndCompileFilters();
//       }
//     }
//   } catch (err) {
//     console.error('[PrivShield] Toggle DNR error:', err.message);
//   }
// }

// // Apply strict mode: block all third-party
// async function applyStrictModeRules() {
//   const STRICT_RULE_ID = 4999;

//   try {
//     // Remove existing strict mode rule
//     await chrome.declarativeNetRequest.updateDynamicRules({
//       removeRuleIds: [STRICT_RULE_ID],
//     });

//     if (state.strictMode) {
//       await chrome.declarativeNetRequest.updateDynamicRules({
//         addRules: [{
//           id:       STRICT_RULE_ID,
//           priority: 2,
//           action:   { type: 'block' },
//           condition: {
//             domainType:    'thirdParty',
//             resourceTypes: [
//               'script', 'image', 'stylesheet', 'object',
//               'xmlhttprequest', 'ping', 'media', 'font',
//               'sub_frame', 'other',
//             ],
//           },
//         }],
//       });
//       console.log('[PrivShield] Strict mode ON');
//     } else {
//       console.log('[PrivShield] Strict mode OFF');
//     }
//   } catch (err) {
//     console.error('[PrivShield] Strict mode error:', err.message);
//   }
// }

// // Block all scripts globally
// async function applyScriptBlockRules() {
//   const SCRIPT_RULE_ID = 4998;

//   try {
//     await chrome.declarativeNetRequest.updateDynamicRules({
//       removeRuleIds: [SCRIPT_RULE_ID],
//     });

//     if (state.scriptBlock) {
//       await chrome.declarativeNetRequest.updateDynamicRules({
//         addRules: [{
//           id:       SCRIPT_RULE_ID,
//           priority: 2,
//           action:   { type: 'block' },
//           condition: {
//             resourceTypes: ['script'],
//           },
//         }],
//       });
//       console.log('[PrivShield] Script block ON');
//     }
//   } catch (err) {
//     console.error('[PrivShield] Script block error:', err.message);
//   }
// }

// // Whitelist a specific domain
// async function applyWhitelistRule(host, whitelisted) {
//   // Use high ID range for whitelist rules
//   const existingRules = await chrome.declarativeNetRequest.getDynamicRules();

//   // Find existing whitelist rule for this host
//   const existingRule = existingRules.find(r =>
//     r.action?.type === 'allow' &&
//     r.condition?.requestDomains?.includes(host)
//   );

//   try {
//     if (existingRule) {
//       await chrome.declarativeNetRequest.updateDynamicRules({
//         removeRuleIds: [existingRule.id],
//       });
//     }

//     if (whitelisted) {
//       // Find a free ID (use high range 4000-4900 for site rules)
//       const usedIds = new Set(existingRules.map(r => r.id));
//       let newId = 4000;
//       while (usedIds.has(newId) && newId < 4900) newId++;

//       await chrome.declarativeNetRequest.updateDynamicRules({
//         addRules: [{
//           id:       newId,
//           priority: 100, // Very high priority – always allow
//           action:   { type: 'allow' },
//           condition: {
//             requestDomains: [host],
//             resourceTypes:  [
//               'main_frame', 'script', 'image', 'stylesheet',
//               'object', 'xmlhttprequest', 'ping', 'media',
//               'font', 'sub_frame', 'other',
//             ],
//           },
//         }],
//       });
//       console.log(`[PrivShield] Whitelisted: ${host}`);
//     }
//   } catch (err) {
//     console.error('[PrivShield] Whitelist error:', err.message);
//   }
// }

// // ─────────────────────────────────────────────
// // UTILITIES
// // ─────────────────────────────────────────────

// function extractHostname(url) {
//   if (!url) return '';
//   try {
//     return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
//   } catch {
//     return '';
//   }
// }

// function isSiteWhitelisted(host) {
//   if (!host) return false;
//   const cfg = state.siteSettings[host];
//   return cfg && cfg.whitelisted === true;
// }

// async function fetchFilterList(url) {
//   if (!url.startsWith('https://')) {
//     throw new Error('Only HTTPS URLs allowed');
//   }
//   const response = await fetch(url, {
//     method:  'GET',
//     headers: { 'Cache-Control': 'no-cache' },
//   });
//   if (!response.ok) {
//     throw new Error(`HTTP ${response.status}: ${response.statusText}`);
//   }
//   return response.text();
// }

// // ─────────────────────────────────────────────
// // STARTUP
// // ─────────────────────────────────────────────

// chrome.runtime.onInstalled.addListener(async (details) => {
//   if (details.reason === 'install') {
//     console.log('[PrivShield] First install.');
//     await chrome.storage.local.set({
//       enabled:          true,
//       strictMode:       false,
//       scriptBlock:      false,
//       spoofUserAgent:   false,
//       stripReferrer:    true,
//       blockFingerprint: true,
//       siteSettings:     {},
//       blockCount:       0,
//       blockedLog:       [],
//       customRules:      '',
//       filterLists:      {},
//     });
//   }
//   await initialize();
// });

// initialize();


/**
 * PrivShield – Background Service Worker
 * PrivMITLab
 * MV3 Compatible – declarativeNetRequest only
 * Fixed: Duplicate ID error, batch loading, nuclear clear
 */

import { FilterEngine } from './utils/parser.js';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const PRIVSHIELD_VERSION = '1.0.0';
const MAX_LOG_ENTRIES = 500;
const DEFAULT_FILTERS_PATH = '/filters/default_filters.txt';
const MAX_DNR_RULES = 4900; // Keep 100 reserved for special rules
const BATCH_SIZE = 200;  // Rules per batch

// Reserved IDs (do NOT use these for filter rules)
const STRICT_RULE_ID = 4999;
const SCRIPT_RULE_ID = 4998;
const WHITELIST_ID_START = 4000; // 4000–4900 for site whitelists
const FILTER_ID_END = 3999; // 1–3999 for filter rules

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

const state = {
    engine: null,
    enabled: true,
    strictMode: false,
    scriptBlock: false,
    spoofUserAgent: false,
    stripReferrer: true,
    blockFingerprint: true,
    siteSettings: {},
    blockedLog: [],
    blockCount: 0,
    sessionCount: 0,
};

const tabBlockCounts = new Map();

// ─────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────

async function initialize() {
    console.log(`[PrivShield] v${PRIVSHIELD_VERSION} initializing...`);
    try {
        await loadSettings();
        await clearAllDNRRules();       // Fresh start – remove all old rules
        await loadAndCompileFilters();  // Load + apply new rules
        console.log('[PrivShield] ✅ Ready!');
    } catch (err) {
        console.error('[PrivShield] Init error:', err);
    }
}

/**
 * Remove ALL existing dynamic DNR rules.
 * Called on every startup for a clean slate.
 */
async function clearAllDNRRules() {
    try {
        const existing = await chrome.declarativeNetRequest.getDynamicRules();

        if (existing.length === 0) {
            console.log('[PrivShield] No existing rules to clear.');
            return;
        }

        const ids = existing.map(r => r.id);
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: ids,
        });
        console.log(`[PrivShield] Cleared ${ids.length} existing rules.`);

    } catch (err) {
        // Brute force fallback: try clearing IDs 1–5000
        console.warn('[PrivShield] Normal clear failed, trying brute force...');
        try {
            const bruteIds = Array.from({ length: 5000 }, (_, i) => i + 1);
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: bruteIds,
            });
            console.log('[PrivShield] Brute force clear done.');
        } catch (err2) {
            console.error('[PrivShield] Brute force clear failed:', err2.message);
        }
    }
}

// ─────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────

async function loadSettings() {
    const stored = await chrome.storage.local.get([
        'enabled', 'strictMode', 'scriptBlock',
        'spoofUserAgent', 'stripReferrer', 'blockFingerprint',
        'siteSettings', 'blockCount', 'blockedLog',
        'customRules', 'filterLists',
    ]);

    if (typeof stored.enabled === 'boolean') state.enabled = stored.enabled;
    if (typeof stored.strictMode === 'boolean') state.strictMode = stored.strictMode;
    if (typeof stored.scriptBlock === 'boolean') state.scriptBlock = stored.scriptBlock;
    if (typeof stored.spoofUserAgent === 'boolean') state.spoofUserAgent = stored.spoofUserAgent;
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

    console.log('[PrivShield] Settings loaded. Enabled:', state.enabled);
}

async function saveSettings() {
    await chrome.storage.local.set({
        enabled: state.enabled,
        strictMode: state.strictMode,
        scriptBlock: state.scriptBlock,
        spoofUserAgent: state.spoofUserAgent,
        stripReferrer: state.stripReferrer,
        blockFingerprint: state.blockFingerprint,
        siteSettings: state.siteSettings,
        blockCount: state.blockCount,
        blockedLog: state.blockedLog.slice(-MAX_LOG_ENTRIES),
    });
}

let saveTimer = null;
function scheduleSettingsSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveSettings();
        saveTimer = null;
    }, 2000);
}

// ─────────────────────────────────────────────
// FILTER LOADING & COMPILATION
// ─────────────────────────────────────────────

async function loadAndCompileFilters() {
    let rawRules = '';

    // 1. Default bundled filter list
    try {
        const response = await fetch(chrome.runtime.getURL(DEFAULT_FILTERS_PATH));
        rawRules = await response.text();
        console.log('[PrivShield] Default filters loaded.');
    } catch (err) {
        console.warn('[PrivShield] Default filters failed:', err.message);
    }

    // 2. Cached external filter lists
    const stored = await chrome.storage.local.get(['filterLists', 'customRules']);

    if (stored.filterLists && typeof stored.filterLists === 'object') {
        for (const [name, content] of Object.entries(stored.filterLists)) {
            if (typeof content === 'string' && content.length > 0) {
                rawRules += '\n' + content;
                console.log(`[PrivShield] Loaded cached list: ${name}`);
            }
        }
    }

    // 3. Custom user rules
    if (typeof stored.customRules === 'string' && stored.customRules.trim()) {
        rawRules += '\n' + stored.customRules;
        console.log('[PrivShield] Custom rules appended.');
    }

    // 4. Compile in-memory engine (for cosmetic rules)
    state.engine = new FilterEngine();
    state.engine.compile(rawRules);
    console.log('[PrivShield] Engine stats:', state.engine.getStats());

    // 5. Apply to Chrome declarativeNetRequest
    await applyDeclarativeRules(rawRules);

    // 6. Re-apply special rules (strict mode, script block)
    if (state.strictMode) await applyStrictModeRules();
    if (state.scriptBlock) await applyScriptBlockRules();

    // 7. Re-apply whitelisted sites
    await reapplyWhitelists();
}

// ─────────────────────────────────────────────
// DECLARATIVE NET REQUEST – CORE
// ─────────────────────────────────────────────

async function applyDeclarativeRules(rawRules) {
    try {
        console.log('[PrivShield] Applying DNR rules...');

        // Convert filter text → DNR rule objects
        const dnrRules = convertToDNR(rawRules);

        if (dnrRules.length === 0) {
            console.log('[PrivShield] No valid DNR rules to apply.');
            return;
        }

        // Limit to safe range
        const limited = dnrRules.slice(0, FILTER_ID_END);
        console.log(`[PrivShield] Adding ${limited.length} rules in batches...`);

        // Add in batches to avoid Chrome limits
        let added = 0;
        for (let i = 0; i < limited.length; i += BATCH_SIZE) {
            const batch = limited.slice(i, i + BATCH_SIZE);
            try {
                await chrome.declarativeNetRequest.updateDynamicRules({
                    addRules: batch,
                });
                added += batch.length;
            } catch (batchErr) {
                console.warn(`[PrivShield] Batch ${i}–${i + BATCH_SIZE} failed:`, batchErr.message);
                // Try adding rules one by one to skip bad ones
                for (const rule of batch) {
                    try {
                        await chrome.declarativeNetRequest.updateDynamicRules({
                            addRules: [rule],
                        });
                        added++;
                    } catch {
                        // Skip this rule
                    }
                }
            }
        }

        console.log(`[PrivShield] ✅ DNR rules applied: ${added}/${limited.length}`);

    } catch (err) {
        console.error('[PrivShield] DNR apply error:', err.message);
        await nuclearClearAndRetry(rawRules);
    }
}

/**
 * Last resort: brute-force clear then retry with minimal rules
 */
async function nuclearClearAndRetry(rawRules) {
    console.log('[PrivShield] Nuclear clear initiated...');
    try {
        // Remove IDs 1–4000 by brute force
        const ids = Array.from({ length: 4000 }, (_, i) => i + 1);
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: ids,
        });

        // Retry with smaller batch
        const dnrRules = convertToDNR(rawRules);
        const limited = dnrRules.slice(0, 500); // Very small set for safety

        if (limited.length > 0) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                addRules: limited,
            });
            console.log(`[PrivShield] ✅ Nuclear retry OK: ${limited.length} rules`);
        }
    } catch (err) {
        console.error('[PrivShield] Nuclear retry failed:', err.message);
    }
}

// ─────────────────────────────────────────────
// RULE CONVERSION – Adblock → DNR
// ─────────────────────────────────────────────

function convertToDNR(rawText) {
    const rules = [];
    const usedIds = new Set();
    const seenFilters = new Set(); // Deduplicate by urlFilter
    let nextId = 1;

    function getNextId() {
        // Skip reserved ID ranges
        while (
            usedIds.has(nextId) ||
            nextId >= WHITELIST_ID_START
        ) {
            nextId++;
        }
        usedIds.add(nextId);
        return nextId++;
    }

    const TYPE_MAP = {
        'script': 'script',
        'image': 'image',
        'stylesheet': 'stylesheet',
        'object': 'object',
        'xmlhttprequest': 'xmlhttprequest',
        'subdocument': 'sub_frame',
        'ping': 'ping',
        'media': 'media',
        'font': 'font',
        'other': 'other',
    };

    const lines = rawText.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();

        // ── Skip useless lines
        if (!trimmed) continue;
        if (trimmed.startsWith('!')) continue; // Comment
        if (trimmed.startsWith('#')) continue; // Comment
        if (trimmed.startsWith('[')) continue; // [Adblock Plus 2.0] header

        // ── Skip cosmetic rules (content.js handles these)
        if (trimmed.includes('##')) continue;
        if (trimmed.includes('#?#')) continue;
        if (trimmed.includes('#$#')) continue;
        if (trimmed.includes('#@#')) continue;

        // ── Skip complex domain exclusion (DNR can't handle ~domain)
        if (
            trimmed.includes('$domain=') &&
            trimmed.split('domain=')[1]?.includes('~')
        ) continue;

        // ── Stop if limit reached
        if (rules.length >= FILTER_ID_END) break;

        try {
            let rule = null;
            const id = getNextId();

            if (trimmed.startsWith('@@')) {
                // Allow / exception rule
                rule = parseAllowRule(trimmed.slice(2), id, TYPE_MAP);
            } else {
                // Block rule
                rule = parseBlockRule(trimmed, id, TYPE_MAP);
            }

            // Rule invalid – release the ID
            if (!rule) {
                usedIds.delete(id);
                continue;
            }

            // Deduplicate by urlFilter + action
            const dedupeKey = rule.action.type + '|' + (rule.condition.urlFilter || 'NO_FILTER');
            if (seenFilters.has(dedupeKey)) {
                usedIds.delete(rule.id);
                continue;
            }
            seenFilters.add(dedupeKey);

            rules.push(rule);

        } catch {
            // Skip bad rule silently
        }
    }

    console.log(`[PrivShield] Converted ${rules.length} rules.`);
    return rules;
}

// ─────────────────────────────────────────────

function parseBlockRule(line, id, TYPE_MAP) {
    let pattern = line;
    let resourceTypes = null;
    let domainType = null;

    // Extract $options
    const dollarIdx = findOptionsDollar(line);
    if (dollarIdx !== -1) {
        const optStr = line.slice(dollarIdx + 1);
        pattern = line.slice(0, dollarIdx);

        const parsed = parseOptions(optStr, TYPE_MAP);
        resourceTypes = parsed.types;
        domainType = parsed.domainType;
    }

    const urlFilter = buildUrlFilter(pattern);
    if (!urlFilter) return null;

    const rule = {
        id,
        priority: 1,
        action: { type: 'block' },
        condition: {
            urlFilter,
            isUrlFilterCaseSensitive: false,
            resourceTypes: resourceTypes && resourceTypes.length > 0
                ? resourceTypes
                : [
                    'script', 'image', 'stylesheet', 'object',
                    'xmlhttprequest', 'ping', 'media', 'font',
                    'sub_frame', 'other',
                ],
        },
    };

    if (domainType) rule.condition.domainType = domainType;

    return rule;
}

// ─────────────────────────────────────────────

function parseAllowRule(line, id, TYPE_MAP) {
    let pattern = line;

    const dollarIdx = findOptionsDollar(line);
    if (dollarIdx !== -1) {
        pattern = line.slice(0, dollarIdx);
    }

    const urlFilter = buildUrlFilter(pattern);
    if (!urlFilter) return null;

    return {
        id,
        priority: 10, // Higher than block rules
        action: { type: 'allow' },
        condition: {
            urlFilter,
            isUrlFilterCaseSensitive: false,
            resourceTypes: [
                'main_frame', 'script', 'image', 'stylesheet',
                'object', 'xmlhttprequest', 'ping', 'media',
                'font', 'sub_frame', 'other',
            ],
        },
    };
}

// ─────────────────────────────────────────────

function findOptionsDollar(line) {
    // Don't confuse $ inside regex rules
    if (line.startsWith('/')) {
        const closeSlash = line.lastIndexOf('/');
        if (closeSlash > 0) {
            return line.indexOf('$', closeSlash);
        }
    }
    return line.lastIndexOf('$');
}

// ─────────────────────────────────────────────

function parseOptions(optStr, TYPE_MAP) {
    const types = [];
    let domainType = null;

    for (const part of optStr.split(',')) {
        const p = part.trim().toLowerCase();
        if (!p) continue;

        if (p === 'third-party' || p === '3p') {
            domainType = 'thirdParty';
        } else if (p === '~third-party' || p === '~3p' ||
            p === 'first-party' || p === '1p') {
            domainType = 'firstParty';
        } else if (TYPE_MAP[p]) {
            types.push(TYPE_MAP[p]);
        }
        // domain=, important, collapse etc. – ignore
    }

    return {
        types: types.length > 0 ? types : null,
        domainType: domainType,
    };
}

// ─────────────────────────────────────────────

function buildUrlFilter(pattern) {
    if (!pattern || pattern.length < 3) return null;

    // Skip regex patterns (too complex for basic DNR)
    if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
        return null;
    }

    // Domain anchor: ||example.com^  →  ||example.com
    if (pattern.startsWith('||')) {
        let domain = pattern.slice(2).replace(/[\^*|]+$/, '').trim();
        if (!domain || domain.length < 3) return null;
        // Must look like a real domain or path
        return '||' + domain;
    }

    // Start anchor: |https://example.com
    if (pattern.startsWith('|') && !pattern.startsWith('||')) {
        const rest = pattern.slice(1);
        if (rest.length < 4) return null;
        return rest;
    }

    // Plain string / wildcard
    if (pattern.length < 6) return null;

    // Replace adblock ^ separator with *
    const cleaned = pattern.replace(/\^/g, '*');
    return cleaned;
}

// ─────────────────────────────────────────────
// SPECIAL DNR RULES (Strict Mode, Script Block, Whitelist)
// ─────────────────────────────────────────────

async function applyStrictModeRules() {
    try {
        // Always remove first to avoid duplicate
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [STRICT_RULE_ID],
        });

        if (!state.strictMode) {
            console.log('[PrivShield] Strict mode OFF');
            return;
        }

        await chrome.declarativeNetRequest.updateDynamicRules({
            addRules: [{
                id: STRICT_RULE_ID,
                priority: 2,
                action: { type: 'block' },
                condition: {
                    domainType: 'thirdParty',
                    resourceTypes: [
                        'script', 'image', 'stylesheet', 'object',
                        'xmlhttprequest', 'ping', 'media', 'font',
                        'sub_frame', 'other',
                    ],
                },
            }],
        });
        console.log('[PrivShield] Strict mode ON');
    } catch (err) {
        console.error('[PrivShield] Strict mode error:', err.message);
    }
}

// ─────────────────────────────────────────────

async function applyScriptBlockRules() {
    try {
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [SCRIPT_RULE_ID],
        });

        if (!state.scriptBlock) {
            console.log('[PrivShield] Script block OFF');
            return;
        }

        await chrome.declarativeNetRequest.updateDynamicRules({
            addRules: [{
                id: SCRIPT_RULE_ID,
                priority: 2,
                action: { type: 'block' },
                condition: {
                    resourceTypes: ['script'],
                },
            }],
        });
        console.log('[PrivShield] Script block ON');
    } catch (err) {
        console.error('[PrivShield] Script block error:', err.message);
    }
}

// ─────────────────────────────────────────────

async function applyWhitelistRule(host, whitelisted) {
    try {
        const existing = await chrome.declarativeNetRequest.getDynamicRules();
        const existingIds = new Set(existing.map(r => r.id));

        // Find if this host already has a whitelist rule
        const existingRule = existing.find(r =>
            r.priority >= 100 &&
            r.action?.type === 'allow' &&
            r.condition?.requestDomains?.includes(host)
        );

        // Remove old rule for this host if exists
        if (existingRule) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: [existingRule.id],
            });
        }

        if (!whitelisted) {
            console.log(`[PrivShield] Removed whitelist for: ${host}`);
            return;
        }

        // Find free ID in whitelist range (4000–4900)
        let newId = WHITELIST_ID_START;
        while (existingIds.has(newId) && newId < 4900) {
            newId++;
        }

        if (newId >= 4900) {
            console.warn('[PrivShield] Whitelist ID range full!');
            return;
        }

        await chrome.declarativeNetRequest.updateDynamicRules({
            addRules: [{
                id: newId,
                priority: 100,
                action: { type: 'allow' },
                condition: {
                    requestDomains: [host],
                    resourceTypes: [
                        'main_frame', 'script', 'image', 'stylesheet',
                        'object', 'xmlhttprequest', 'ping', 'media',
                        'font', 'sub_frame', 'other',
                    ],
                },
            }],
        });
        console.log(`[PrivShield] ✅ Whitelisted: ${host} (ID: ${newId})`);

    } catch (err) {
        console.error('[PrivShield] Whitelist error:', err.message);
    }
}

// ─────────────────────────────────────────────

async function reapplyWhitelists() {
    const hosts = Object.keys(state.siteSettings).filter(
        h => state.siteSettings[h]?.whitelisted === true
    );

    for (const host of hosts) {
        await applyWhitelistRule(host, true);
    }

    if (hosts.length > 0) {
        console.log(`[PrivShield] Reapplied ${hosts.length} site whitelists.`);
    }
}

// ─────────────────────────────────────────────
// TOGGLE ALL RULES (Global ON/OFF)
// ─────────────────────────────────────────────

async function toggleDNRRules(enabled) {
    try {
        if (!enabled) {
            // Pause: clear all rules
            const existing = await chrome.declarativeNetRequest.getDynamicRules();
            const ids = existing.map(r => r.id);
            if (ids.length > 0) {
                await chrome.declarativeNetRequest.updateDynamicRules({
                    removeRuleIds: ids,
                });
                console.log(`[PrivShield] ⏸ Paused: removed ${ids.length} rules`);
            }
        } else {
            // Resume: rebuild everything from scratch
            console.log('[PrivShield] ▶ Resuming: rebuilding rules...');
            await clearAllDNRRules();
            await loadAndCompileFilters();
        }
    } catch (err) {
        console.error('[PrivShield] Toggle error:', err.message);
    }
}

// ─────────────────────────────────────────────
// TAB TRACKING
// ─────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
        tabBlockCounts.set(tabId, 0);
        chrome.action.setBadgeText({ text: '', tabId }).catch(() => { });
        trackBlocksForTab(tabId);
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    tabBlockCounts.delete(tabId);
});

function trackBlocksForTab(tabId) {
    setTimeout(async () => {
        try {
            const result = await chrome.declarativeNetRequest.getMatchedRules({
                tabId,
                minTimeStamp: Date.now() - 5000,
            });

            const count = result?.rulesMatchInfo?.length || 0;

            if (count > 0) {
                state.blockCount += count;
                state.sessionCount += count;
                tabBlockCounts.set(tabId, count);

                await chrome.action.setBadgeText({
                    text: count > 999 ? '999+' : String(count),
                    tabId,
                }).catch(() => { });

                await chrome.action.setBadgeBackgroundColor({
                    color: '#e74c3c',
                    tabId,
                }).catch(() => { });

                scheduleSettingsSave();
            }
        } catch {
            // declarativeNetRequestFeedback needed – silent fail OK
        }
    }, 3000);
}

// ─────────────────────────────────────────────
// MESSAGE HANDLER
// ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
        .then(sendResponse)
        .catch(err => sendResponse({ error: err.message }));
    return true; // Keep async channel open
});

async function handleMessage(message, sender) {
    const { action, payload } = message;

    switch (action) {

        // ── Global state
        case 'GET_STATE':
            return {
                enabled: state.enabled,
                strictMode: state.strictMode,
                scriptBlock: state.scriptBlock,
                spoofUserAgent: state.spoofUserAgent,
                stripReferrer: state.stripReferrer,
                blockFingerprint: state.blockFingerprint,
                blockCount: state.blockCount,
                sessionCount: state.sessionCount,
                engineStats: state.engine ? state.engine.getStats() : {},
            };

        case 'SET_ENABLED':
            state.enabled = Boolean(payload.enabled);
            await saveSettings();
            await toggleDNRRules(state.enabled);
            return { ok: true, enabled: state.enabled };

        case 'SET_STRICT_MODE':
            state.strictMode = Boolean(payload.strictMode);
            await saveSettings();
            await applyStrictModeRules();
            return { ok: true };

        case 'SET_SCRIPT_BLOCK':
            state.scriptBlock = Boolean(payload.scriptBlock);
            await saveSettings();
            await applyScriptBlockRules();
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

        // ── Site settings
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
            await applyWhitelistRule(host, Boolean(whitelisted));
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
                logs: state.blockedLog.slice().reverse(),
                blockCount: state.blockCount,
                sessionCount: state.sessionCount,
            };

        case 'CLEAR_LOGS':
            state.blockedLog = [];
            state.sessionCount = 0;
            await saveSettings();
            return { ok: true };

        // ── Tab count
        case 'GET_TAB_COUNT':
            return { count: tabBlockCounts.get(payload.tabId) || 0 };

        // ── Filter list management
        case 'UPDATE_FILTER_LIST': {
            const { name, url: listUrl } = payload;
            try {
                const content = await fetchFilterList(listUrl);
                const stored = await chrome.storage.local.get('filterLists');
                const lists = stored.filterLists || {};
                lists[name] = content;
                await chrome.storage.local.set({ filterLists: lists });
                await clearAllDNRRules();
                await loadAndCompileFilters();
                return { ok: true, lines: content.split('\n').length };
            } catch (err) {
                return { ok: false, error: err.message };
            }
        }

        case 'REMOVE_FILTER_LIST': {
            const { name } = payload;
            const stored = await chrome.storage.local.get('filterLists');
            const lists = stored.filterLists || {};
            delete lists[name];
            await chrome.storage.local.set({ filterLists: lists });
            await clearAllDNRRules();
            await loadAndCompileFilters();
            return { ok: true };
        }

        case 'GET_FILTER_LISTS': {
            const stored = await chrome.storage.local.get(['filterLists', 'customRules']);
            const lists = stored.filterLists || {};
            return {
                lists: Object.keys(lists).map(n => ({
                    name: n,
                    lines: lists[n].split('\n').length,
                })),
                customRules: stored.customRules || '',
            };
        }

        case 'SAVE_CUSTOM_RULES': {
            const { rules } = payload;
            await chrome.storage.local.set({ customRules: rules });
            await clearAllDNRRules();
            await loadAndCompileFilters();
            return { ok: true };
        }

        case 'RELOAD_FILTERS':
            await clearAllDNRRules();
            await loadAndCompileFilters();
            return { ok: true, stats: state.engine ? state.engine.getStats() : {} };

        // ── Cosmetic selectors (for content.js)
        case 'GET_COSMETIC_SELECTORS': {
            const { host } = payload;
            const selectors = state.engine
                ? state.engine.getCosmeticSelectors(host)
                : [];
            return { selectors };
        }

        default:
            return { error: `Unknown action: ${action}` };
    }
}

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────

function isSiteWhitelisted(host) {
    if (!host) return false;
    const cfg = state.siteSettings[host];
    return cfg && cfg.whitelisted === true;
}

async function fetchFilterList(url) {
    if (!url.startsWith('https://')) {
        throw new Error('Only HTTPS URLs allowed');
    }
    const res = await fetch(url, {
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.text();
}

// ─────────────────────────────────────────────
// STARTUP
// ─────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        console.log('[PrivShield] First install – setting defaults.');
        await chrome.storage.local.set({
            enabled: true,
            strictMode: false,
            scriptBlock: false,
            spoofUserAgent: false,
            stripReferrer: true,
            blockFingerprint: true,
            siteSettings: {},
            blockCount: 0,
            blockedLog: [],
            customRules: '',
            filterLists: {},
        });
    }
    await initialize();
});

// Service Worker restart pe bhi initialize
initialize();