/**
 * PrivShield – Background Service Worker
 * PrivMITLab v2.0.0
 *
 * Fixed:
 *  - Double initialization removed
 *  - Live block count via getMatchedRules
 *  - Search redirect via tabs.onUpdated
 *  - Tracking URL cleaner
 *  - Per-site whitelist via DNR
 */

import { FilterEngine } from './utils/parser.js';
import {
    detectSearchQuery,
    buildRedirectURL,
    cleanTrackingParams,
    isPrivacyEngine,
} from './utils/searchEngine.js';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const PRIVSHIELD_VERSION = '2.0.0';
const MAX_LOG_ENTRIES = 500;
const DEFAULT_FILTERS_PATH = '/filters/default_filters.txt';
const MAX_DNR_RULES = 4900;
const BATCH_SIZE = 200;

const STRICT_RULE_ID = 4999;
const SCRIPT_RULE_ID = 4998;
const WHITELIST_ID_START = 4000;
const FILTER_ID_END = 3999;

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

const state = {
    engine: null,
    enabled: true,
    strictMode: false,
    scriptBlock: false,
    blockFingerprint: true,
    spoofUserAgent: false,
    stripReferrer: true,
    searchRedirect: true,
    searchEngine: 'duckduckgo',
    customSearchURL: '',
    cleanTrackingURLs: true,
    blockNonPrivate: false,
    siteSettings: {},
    blockedLog: [],
    blockCount: 0,
    sessionCount: 0,
    redirectCount: 0,
};

const tabBlockCounts = new Map();
const tabRedirectCounts = new Map();
const tabLastCheck = new Map();

// ─────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────

async function initialize() {
    console.log(`[PrivShield] v${PRIVSHIELD_VERSION} initializing...`);
    try {
        await loadSettings();
        await clearAllDNRRules();
        await loadAndCompileFilters();
        console.log('[PrivShield] ✅ Ready!');
    } catch (err) {
        console.error('[PrivShield] Init error:', err);
    }
}

// ─────────────────────────────────────────────
// CLEAR ALL DNR RULES
// ─────────────────────────────────────────────

async function clearAllDNRRules() {
    try {
        const existing = await chrome.declarativeNetRequest.getDynamicRules();
        if (existing.length === 0) {
            console.log('[PrivShield] No existing rules to clear.');
            return;
        }
        const ids = existing.map(r => r.id);
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ids });
        console.log(`[PrivShield] Cleared ${ids.length} existing rules.`);
    } catch {
        try {
            const bruteIds = Array.from({ length: 5000 }, (_, i) => i + 1);
            await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: bruteIds });
            console.log('[PrivShield] Brute force clear done.');
        } catch (err2) {
            console.error('[PrivShield] Clear failed:', err2.message);
        }
    }
}

// ─────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────

async function loadSettings() {
    const stored = await chrome.storage.local.get([
        'enabled', 'strictMode', 'scriptBlock', 'spoofUserAgent',
        'stripReferrer', 'blockFingerprint', 'siteSettings',
        'blockCount', 'sessionCount', 'blockedLog', 'customRules',
        'filterLists', 'searchRedirect', 'searchEngine',
        'customSearchURL', 'cleanTrackingURLs', 'blockNonPrivate',
        'redirectCount',
    ]);

    const bools = [
        'enabled', 'strictMode', 'scriptBlock', 'spoofUserAgent',
        'stripReferrer', 'blockFingerprint', 'searchRedirect',
        'cleanTrackingURLs', 'blockNonPrivate',
    ];

    for (const key of bools) {
        if (typeof stored[key] === 'boolean') state[key] = stored[key];
    }

    if (typeof stored.searchEngine === 'string') state.searchEngine = stored.searchEngine;
    if (typeof stored.customSearchURL === 'string') state.customSearchURL = stored.customSearchURL;

    if (stored.siteSettings && typeof stored.siteSettings === 'object') {
        state.siteSettings = stored.siteSettings;
    }

    if (typeof stored.blockCount === 'number') state.blockCount = stored.blockCount;
    if (typeof stored.sessionCount === 'number') state.sessionCount = stored.sessionCount;
    if (typeof stored.redirectCount === 'number') state.redirectCount = stored.redirectCount;

    if (Array.isArray(stored.blockedLog)) {
        state.blockedLog = stored.blockedLog.slice(-MAX_LOG_ENTRIES);
    }

    console.log('[PrivShield] Settings loaded.');
}

async function saveSettings() {
    await chrome.storage.local.set({
        enabled: state.enabled,
        strictMode: state.strictMode,
        scriptBlock: state.scriptBlock,
        spoofUserAgent: state.spoofUserAgent,
        stripReferrer: state.stripReferrer,
        blockFingerprint: state.blockFingerprint,
        searchRedirect: state.searchRedirect,
        searchEngine: state.searchEngine,
        customSearchURL: state.customSearchURL,
        cleanTrackingURLs: state.cleanTrackingURLs,
        blockNonPrivate: state.blockNonPrivate,
        siteSettings: state.siteSettings,
        blockCount: state.blockCount,
        sessionCount: state.sessionCount,
        redirectCount: state.redirectCount,
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

    try {
        const response = await fetch(chrome.runtime.getURL(DEFAULT_FILTERS_PATH));
        rawRules = await response.text();
        console.log('[PrivShield] Default filters loaded.');
    } catch (err) {
        console.warn('[PrivShield] Default filters failed:', err.message);
    }

    const stored = await chrome.storage.local.get(['filterLists', 'customRules']);

    if (stored.filterLists && typeof stored.filterLists === 'object') {
        for (const [name, content] of Object.entries(stored.filterLists)) {
            if (typeof content === 'string' && content.length > 0) {
                rawRules += '\n' + content;
                console.log(`[PrivShield] Loaded: ${name}`);
            }
        }
    }

    if (typeof stored.customRules === 'string' && stored.customRules.trim()) {
        rawRules += '\n' + stored.customRules;
    }

    state.engine = new FilterEngine();
    state.engine.compile(rawRules);
    console.log('[PrivShield] Engine stats:', state.engine.getStats());

    await applyDeclarativeRules(rawRules);

    if (state.strictMode) await applyStrictModeRules();
    if (state.scriptBlock) await applyScriptBlockRules();
    await reapplyWhitelists();
}

// ─────────────────────────────────────────────
// DECLARATIVE NET REQUEST
// ─────────────────────────────────────────────

async function applyDeclarativeRules(rawRules) {
    try {
        const dnrRules = convertToDNR(rawRules);
        if (dnrRules.length === 0) {
            console.log('[PrivShield] No DNR rules to apply.');
            return;
        }

        const limited = dnrRules.slice(0, FILTER_ID_END);
        let added = 0;

        for (let i = 0; i < limited.length; i += BATCH_SIZE) {
            const batch = limited.slice(i, i + BATCH_SIZE);
            try {
                await chrome.declarativeNetRequest.updateDynamicRules({ addRules: batch });
                added += batch.length;
            } catch {
                for (const rule of batch) {
                    try {
                        await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [rule] });
                        added++;
                    } catch { /* skip bad rule */ }
                }
            }
        }

        console.log(`[PrivShield] ✅ DNR rules applied: ${added}`);
    } catch (err) {
        console.error('[PrivShield] DNR apply error:', err.message);
        await nuclearClearAndRetry(rawRules);
    }
}

async function nuclearClearAndRetry(rawRules) {
    try {
        const ids = Array.from({ length: 4000 }, (_, i) => i + 1);
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ids });
        const dnrRules = convertToDNR(rawRules);
        const limited = dnrRules.slice(0, 500);
        if (limited.length > 0) {
            await chrome.declarativeNetRequest.updateDynamicRules({ addRules: limited });
            console.log(`[PrivShield] Nuclear retry OK: ${limited.length} rules`);
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
    const seenFilters = new Set();
    let nextId = 1;

    function getNextId() {
        while (usedIds.has(nextId) || nextId >= WHITELIST_ID_START) nextId++;
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

    for (const line of rawText.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('!')) continue;
        if (trimmed.startsWith('#')) continue;
        if (trimmed.startsWith('[')) continue;
        if (trimmed.includes('##')) continue;
        if (trimmed.includes('#?#')) continue;
        if (trimmed.includes('#$#')) continue;
        if (trimmed.includes('#@#')) continue;
        if (trimmed.includes('$domain=') &&
            trimmed.split('domain=')[1]?.includes('~')) continue;

        if (rules.length >= FILTER_ID_END) break;

        try {
            const id = getNextId();
            let rule = null;

            if (trimmed.startsWith('@@')) {
                rule = parseAllowRule(trimmed.slice(2), id, TYPE_MAP);
            } else {
                rule = parseBlockRule(trimmed, id, TYPE_MAP);
            }

            if (!rule) { usedIds.delete(id); continue; }

            const dedupeKey = rule.action.type + '|' + (rule.condition.urlFilter || '');
            if (seenFilters.has(dedupeKey)) { usedIds.delete(rule.id); continue; }
            seenFilters.add(dedupeKey);

            rules.push(rule);
        } catch { /* skip */ }
    }

    console.log(`[PrivShield] Converted ${rules.length} rules.`);
    return rules;
}

function parseBlockRule(line, id, TYPE_MAP) {
    let pattern = line, resourceTypes = null, domainType = null;

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
            resourceTypes: resourceTypes?.length > 0 ? resourceTypes : [
                'script', 'image', 'stylesheet', 'object',
                'xmlhttprequest', 'ping', 'media', 'font', 'sub_frame', 'other',
            ],
        },
    };

    if (domainType) rule.condition.domainType = domainType;
    return rule;
}

function parseAllowRule(line, id, TYPE_MAP) {
    let pattern = line;
    const dolIdx = findOptionsDollar(line);
    if (dolIdx !== -1) pattern = line.slice(0, dolIdx);

    const urlFilter = buildUrlFilter(pattern);
    if (!urlFilter) return null;

    return {
        id,
        priority: 10,
        action: { type: 'allow' },
        condition: {
            urlFilter,
            isUrlFilterCaseSensitive: false,
            resourceTypes: [
                'main_frame', 'script', 'image', 'stylesheet', 'object',
                'xmlhttprequest', 'ping', 'media', 'font', 'sub_frame', 'other',
            ],
        },
    };
}

function findOptionsDollar(line) {
    if (line.startsWith('/')) {
        const closeSlash = line.lastIndexOf('/');
        if (closeSlash > 0) return line.indexOf('$', closeSlash);
    }
    return line.lastIndexOf('$');
}

function parseOptions(optStr, TYPE_MAP) {
    const types = [];
    let domainType = null;

    for (const part of optStr.split(',')) {
        const p = part.trim().toLowerCase();
        if (!p) continue;
        if (p === 'third-party' || p === '3p') { domainType = 'thirdParty'; continue; }
        if (p === '~third-party' || p === '~3p' ||
            p === 'first-party' || p === '1p') { domainType = 'firstParty'; continue; }
        if (TYPE_MAP[p]) types.push(TYPE_MAP[p]);
    }

    return { types: types.length > 0 ? types : null, domainType };
}

function buildUrlFilter(pattern) {
    if (!pattern || pattern.length < 3) return null;
    if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) return null;

    if (pattern.startsWith('||')) {
        const domain = pattern.slice(2).replace(/[\^*|]+$/, '').trim();
        if (!domain || domain.length < 3) return null;
        return '||' + domain;
    }

    if (pattern.startsWith('|') && !pattern.startsWith('||')) {
        const rest = pattern.slice(1);
        if (rest.length < 4) return null;
        return rest;
    }

    if (pattern.length < 6) return null;
    return pattern.replace(/\^/g, '*');
}

// ─────────────────────────────────────────────
// SPECIAL DNR RULES
// ─────────────────────────────────────────────

async function applyStrictModeRules() {
    try {
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [STRICT_RULE_ID],
        });
        if (!state.strictMode) return;

        await chrome.declarativeNetRequest.updateDynamicRules({
            addRules: [{
                id: STRICT_RULE_ID,
                priority: 2,
                action: { type: 'block' },
                condition: {
                    domainType: 'thirdParty',
                    resourceTypes: [
                        'script', 'image', 'stylesheet', 'object',
                        'xmlhttprequest', 'ping', 'media', 'font', 'sub_frame', 'other',
                    ],
                },
            }],
        });
        console.log('[PrivShield] Strict mode ON');
    } catch (err) {
        console.error('[PrivShield] Strict mode error:', err.message);
    }
}

async function applyScriptBlockRules() {
    try {
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [SCRIPT_RULE_ID],
        });
        if (!state.scriptBlock) return;

        await chrome.declarativeNetRequest.updateDynamicRules({
            addRules: [{
                id: SCRIPT_RULE_ID,
                priority: 2,
                action: { type: 'block' },
                condition: { resourceTypes: ['script'] },
            }],
        });
        console.log('[PrivShield] Script block ON');
    } catch (err) {
        console.error('[PrivShield] Script block error:', err.message);
    }
}

async function applyWhitelistRule(host, whitelisted) {
    try {
        const existing = await chrome.declarativeNetRequest.getDynamicRules();
        const existingIds = new Set(existing.map(r => r.id));

        const existingRule = existing.find(r =>
            r.priority >= 100 &&
            r.action?.type === 'allow' &&
            r.condition?.requestDomains?.includes(host)
        );

        if (existingRule) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: [existingRule.id],
            });
        }

        if (!whitelisted) return;

        let newId = WHITELIST_ID_START;
        while (existingIds.has(newId) && newId < 4900) newId++;
        if (newId >= 4900) return;

        await chrome.declarativeNetRequest.updateDynamicRules({
            addRules: [{
                id: newId,
                priority: 100,
                action: { type: 'allow' },
                condition: {
                    requestDomains: [host],
                    resourceTypes: [
                        'main_frame', 'script', 'image', 'stylesheet', 'object',
                        'xmlhttprequest', 'ping', 'media', 'font', 'sub_frame', 'other',
                    ],
                },
            }],
        });
        console.log(`[PrivShield] ✅ Whitelisted: ${host}`);
    } catch (err) {
        console.error('[PrivShield] Whitelist error:', err.message);
    }
}

async function reapplyWhitelists() {
    const hosts = Object.keys(state.siteSettings).filter(
        h => state.siteSettings[h]?.whitelisted === true
    );
    for (const host of hosts) await applyWhitelistRule(host, true);
    if (hosts.length > 0) {
        console.log(`[PrivShield] Reapplied ${hosts.length} whitelists.`);
    }
}

async function toggleDNRRules(enabled) {
    try {
        if (!enabled) {
            const existing = await chrome.declarativeNetRequest.getDynamicRules();
            const ids = existing.map(r => r.id);
            if (ids.length > 0) {
                await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ids });
                console.log(`[PrivShield] ⏸ Paused: ${ids.length} rules removed`);
            }
        } else {
            await clearAllDNRRules();
            await loadAndCompileFilters();
        }
    } catch (err) {
        console.error('[PrivShield] Toggle error:', err.message);
    }
}

// ─────────────────────────────────────────────
// TAB TRACKING – LIVE BLOCK COUNT
// ─────────────────────────────────────────────

function trackBlocksForTab(tabId) {
    scheduleBlockCheck(tabId, 2000);
    scheduleBlockCheck(tabId, 5000);
    scheduleBlockCheck(tabId, 10000);
}

function scheduleBlockCheck(tabId, delay) {
    setTimeout(() => checkBlockedForTab(tabId), delay);
}

async function checkBlockedForTab(tabId) {
    if (!tabId || tabId < 0) return;

    try {
        const minTime = tabLastCheck.get(tabId) || (Date.now() - 30000);
        tabLastCheck.set(tabId, Date.now());

        const result = await chrome.declarativeNetRequest.getMatchedRules({
            tabId,
            minTimeStamp: minTime,
        });

        const count = result?.rulesMatchInfo?.length || 0;

        if (count > 0) {
            state.blockCount += count;
            state.sessionCount += count;

            const prev = tabBlockCounts.get(tabId) || 0;
            const updated = prev + count;
            tabBlockCounts.set(tabId, updated);

            await updateBadgeForTab(tabId);
            scheduleSettingsSave();

            console.log(`[PrivShield] Tab ${tabId}: +${count} blocked (total: ${updated})`);
        }
    } catch (err) {
        // declarativeNetRequestFeedback needed – silent fail OK
        console.debug('[PrivShield] getMatchedRules:', err.message);
    }
}

async function updateBadgeForTab(tabId) {
    if (!tabId || tabId < 0) return;

    const blocks = tabBlockCounts.get(tabId) || 0;
    const redirects = tabRedirectCounts.get(tabId) || 0;
    const total = blocks + redirects;

    const text = total === 0 ? '' : total > 999 ? '999+' : String(total);
    const color = redirects > 0 ? '#3fb950' : '#e74c3c';

    try {
        await chrome.action.setBadgeText({ text, tabId });
        await chrome.action.setBadgeBackgroundColor({ color, tabId });
    } catch { }
}

// ─────────────────────────────────────────────
// TABS EVENT – SEARCH REDIRECT + TRACKING CLEAN
// ─────────────────────────────────────────────

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {

    // Reset on new page load
    if (changeInfo.status === 'loading' && changeInfo.url) {
        tabBlockCounts.set(tabId, 0);
        tabRedirectCounts.set(tabId, 0);
        tabLastCheck.set(tabId, Date.now());
        chrome.action.setBadgeText({ text: '', tabId }).catch(() => { });
        trackBlocksForTab(tabId);
    }

    // Only act on URL changes
    if (!changeInfo.url) return;

    const url = changeInfo.url;
    if (!url.startsWith('http')) return;
    if (!state.enabled) return;

    // Search redirect disabled – only clean URLs
    if (!state.searchRedirect) {
        if (state.cleanTrackingURLs) await handleTrackingClean(tabId, url);
        return;
    }

    // Already a privacy engine – prevent redirect loop
    if (isPrivacyEngine(url)) {
        if (state.cleanTrackingURLs) await handleTrackingClean(tabId, url);
        return;
    }

    // Detect search query
    const detection = detectSearchQuery(url);

    if (detection.isSearch && detection.query) {
        // Check per-site settings
        const hostname = extractHostname(url);
        const siteCfg = state.siteSettings[hostname] || {};
        if (siteCfg.enabled === false || siteCfg.whitelisted) return;

        // Build redirect
        const redirectUrl = buildRedirectURL(
            state.searchEngine,
            detection.query,
            state.customSearchURL,
        );
        if (!redirectUrl) return;

        console.log(`[PrivShield] 🔍 ${detection.engine} → ${state.searchEngine}: "${detection.query}"`);

        // Log it
        state.blockedLog.push({
            type: 'search-redirect',
            reason: 'search-redirect',
            from: url,
            to: redirectUrl,
            engine: detection.engine,
            query: detection.query,
            tabId,
            timestamp: Date.now(),
        });
        if (state.blockedLog.length > MAX_LOG_ENTRIES) {
            state.blockedLog = state.blockedLog.slice(-MAX_LOG_ENTRIES);
        }

        // Update counters
        state.redirectCount++;
        tabRedirectCounts.set(tabId, (tabRedirectCounts.get(tabId) || 0) + 1);
        updateBadgeForTab(tabId);
        scheduleSettingsSave();

        // Perform redirect
        try {
            await chrome.tabs.update(tabId, { url: redirectUrl });
        } catch (err) {
            console.warn('[PrivShield] Redirect failed:', err.message);
        }
        return;
    }

    // Clean tracking params from non-search URLs
    if (state.cleanTrackingURLs) {
        await handleTrackingClean(tabId, url);
    }
});

async function handleTrackingClean(tabId, url) {
    try {
        const result = cleanTrackingParams(url);
        if (result.changed) {
            console.log(`[PrivShield] 🧹 Cleaned: ${result.removed.join(', ')}`);
            await chrome.tabs.update(tabId, { url: result.cleaned });
        }
    } catch {
        // Tab may have closed
    }
}

chrome.tabs.onRemoved.addListener((tabId) => {
    tabBlockCounts.delete(tabId);
    tabRedirectCounts.delete(tabId);
    tabLastCheck.delete(tabId);
});

// ─────────────────────────────────────────────
// MESSAGE HANDLER
// ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
        .then(sendResponse)
        .catch(err => sendResponse({ error: err.message }));
    return true;
});

async function handleMessage(message, sender) {
    const { action, payload } = message;

    switch (action) {

        case 'GET_STATE':
            return {
                enabled: state.enabled,
                strictMode: state.strictMode,
                scriptBlock: state.scriptBlock,
                spoofUserAgent: state.spoofUserAgent,
                stripReferrer: state.stripReferrer,
                blockFingerprint: state.blockFingerprint,
                searchRedirect: state.searchRedirect,
                searchEngine: state.searchEngine,
                customSearchURL: state.customSearchURL,
                cleanTrackingURLs: state.cleanTrackingURLs,
                blockNonPrivate: state.blockNonPrivate,
                blockCount: state.blockCount,
                sessionCount: state.sessionCount,
                redirectCount: state.redirectCount,
                engineStats: state.engine ? state.engine.getStats() : {},
            };

        case 'SET_ENABLED':
            state.enabled = Boolean(payload.enabled);
            await saveSettings();
            await toggleDNRRules(state.enabled);
            return { ok: true };

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

        case 'SET_SEARCH_REDIRECT':
            state.searchRedirect = Boolean(payload.searchRedirect);
            await saveSettings();
            return { ok: true };

        case 'SET_SEARCH_ENGINE':
            state.searchEngine = payload.searchEngine || 'duckduckgo';
            await saveSettings();
            return { ok: true };

        case 'SET_CUSTOM_SEARCH_URL':
            state.customSearchURL = payload.customSearchURL || '';
            await saveSettings();
            return { ok: true };

        case 'SET_CLEAN_TRACKING':
            state.cleanTrackingURLs = Boolean(payload.cleanTrackingURLs);
            await saveSettings();
            return { ok: true };

        case 'SET_BLOCK_NON_PRIVATE':
            state.blockNonPrivate = Boolean(payload.blockNonPrivate);
            await saveSettings();
            return { ok: true };

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

        case 'GET_LOGS':
            return {
                logs: state.blockedLog.slice().reverse(),
                blockCount: state.blockCount,
                sessionCount: state.sessionCount,
                redirectCount: state.redirectCount,
            };

        case 'CLEAR_LOGS':
            state.blockedLog = [];
            state.sessionCount = 0;
            await saveSettings();
            return { ok: true };

        case 'GET_TAB_COUNT':
            return {
                count: tabBlockCounts.get(payload.tabId) || 0,
                redirects: tabRedirectCounts.get(payload.tabId) || 0,
            };

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
            await chrome.storage.local.set({ customRules: payload.rules });
            await clearAllDNRRules();
            await loadAndCompileFilters();
            return { ok: true };
        }

        case 'RELOAD_FILTERS':
            await clearAllDNRRules();
            await loadAndCompileFilters();
            return { ok: true, stats: state.engine ? state.engine.getStats() : {} };

        case 'GET_COSMETIC_SELECTORS': {
            const selectors = state.engine
                ? state.engine.getCosmeticSelectors(payload.host)
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

function extractHostname(url) {
    if (!url) return '';
    try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch { return ''; }
}

function isSiteWhitelisted(host) {
    if (!host) return false;
    const cfg = state.siteSettings[host];
    return cfg && cfg.whitelisted === true;
}

async function fetchFilterList(url) {
    if (!url.startsWith('https://')) throw new Error('Only HTTPS URLs allowed');
    const res = await fetch(url, { method: 'GET', headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
}

// ─────────────────────────────────────────────
// STARTUP – FIXED (No Double Init)
// ─────────────────────────────────────────────

// let _initDone = false;

// async function safeInitialize() {
//     if (_initDone) return;
//     _initDone = true;
//     await initialize();
// }

// // onInstalled – fresh install ya update
// chrome.runtime.onInstalled.addListener(async (details) => {
//     if (details.reason === 'install') {
//         console.log('[PrivShield] First install – setting defaults.');
//         await chrome.storage.local.set({
//             enabled: true,
//             strictMode: false,
//             scriptBlock: false,
//             spoofUserAgent: false,
//             stripReferrer: true,
//             blockFingerprint: true,
//             searchRedirect: true,
//             searchEngine: 'duckduckgo',
//             customSearchURL: '',
//             cleanTrackingURLs: true,
//             blockNonPrivate: false,
//             siteSettings: {},
//             blockCount: 0,
//             sessionCount: 0,
//             redirectCount: 0,
//             blockedLog: [],
//             customRules: '',
//             filterLists: {},
//         });
//     }
//     _initDone = false; // Allow init after install/update
//     await safeInitialize();
// });

// // onStartup – browser restart pe
// chrome.runtime.onStartup.addListener(async () => {
//     await safeInitialize();
// });

// // Service worker fresh start pe (first load)
// (async () => {
//     try {
//         const stored = await chrome.storage.local.get('enabled');
//         if (typeof stored.enabled === 'boolean') {
//             // Already installed – initialize
//             await safeInitialize();
//         }
//         // Agar nahi hai to onInstalled handle karega
//     } catch { }
// })();
// ─────────────────────────────────────────────
// STARTUP – Single Init Only
// ─────────────────────────────────────────────

let _initDone = false;

async function safeInitialize() {
  if (_initDone) {
    console.log('[PrivShield] Already initialized, skipping.');
    return;
  }
  _initDone = true;
  await initialize();
}

// onInstalled
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    console.log('[PrivShield] First install – setting defaults.');
    await chrome.storage.local.set({
      enabled:           true,
      strictMode:        false,  // OFF by default
      scriptBlock:       false,  // OFF by default
      spoofUserAgent:    false,
      stripReferrer:     true,
      blockFingerprint:  true,
      searchRedirect:    true,
      searchEngine:      'duckduckgo',
      customSearchURL:   '',
      cleanTrackingURLs: true,
      blockNonPrivate:   false,
      siteSettings:      {},
      blockCount:        0,
      sessionCount:      0,
      redirectCount:     0,
      blockedLog:        [],
      customRules:       '',
      filterLists:       {},
    });
  }

  if (details.reason === 'update') {
    // Update pe strict/script block off karo
    // (performance ke liye)
    const stored = await chrome.storage.local.get([
      'strictMode', 'scriptBlock'
    ]);
    console.log('[PrivShield] Extension updated.');
  }

  _initDone = false;
  await safeInitialize();
});

// Browser restart
chrome.runtime.onStartup.addListener(async () => {
  console.log('[PrivShield] Browser startup.');
  await safeInitialize();
});

// Service worker first load
(async () => {
  try {
    const stored = await chrome.storage.local.get('enabled');
    if (typeof stored.enabled === 'boolean') {
      await safeInitialize();
    }
  } catch (err) {
    console.error('[PrivShield] Startup error:', err);
  }
})();