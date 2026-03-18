/**
 * PrivShield – Search Engine Privacy Module
 * PrivMITLab
 *
 * Features:
 *  - Detect search queries from Google/Bing/Yahoo etc.
 *  - Extract clean query string
 *  - Build redirect URL to privacy-first engine
 *  - Clean tracking parameters from any URL
 *  - No data ever sent externally
 */

'use strict';

// ─────────────────────────────────────────────
// SUPPORTED SEARCH ENGINES (Source – to redirect FROM)
// ─────────────────────────────────────────────

export const SOURCE_ENGINES = {
    google: {
        name: 'Google',
        domains: ['google.com', 'google.co.in', 'google.co.uk',
            'google.com.au', 'google.ca', 'google.de',
            'google.fr', 'google.co.jp', 'google.com.br'],
        searchPath: '/search',
        queryParam: 'q',
    },
    bing: {
        name: 'Bing',
        domains: ['bing.com'],
        searchPath: '/search',
        queryParam: 'q',
    },
    yahoo: {
        name: 'Yahoo',
        domains: ['search.yahoo.com', 'yahoo.com'],
        searchPath: '/search',
        queryParam: 'p',
    },
    yandex: {
        name: 'Yandex',
        domains: ['yandex.com', 'yandex.ru'],
        searchPath: '/search',
        queryParam: 'text',
    },
    baidu: {
        name: 'Baidu',
        domains: ['baidu.com'],
        searchPath: '/s',
        queryParam: 'wd',
    },
    ask: {
        name: 'Ask',
        domains: ['ask.com'],
        searchPath: '/web',
        queryParam: 'q',
    },
};

// ─────────────────────────────────────────────
// PRIVACY-FIRST TARGET ENGINES (Redirect TO)
// ─────────────────────────────────────────────

export const PRIVACY_ENGINES = {
    duckduckgo: {
        name: 'DuckDuckGo',
        icon: '🦆',
        template: 'https://duckduckgo.com/?q={query}',
        homepage: 'https://duckduckgo.com',
    },
    brave: {
        name: 'Brave Search',
        icon: '🦁',
        template: 'https://search.brave.com/search?q={query}',
        homepage: 'https://search.brave.com',
    },
    startpage: {
        name: 'Startpage',
        icon: '🔒',
        template: 'https://www.startpage.com/search?q={query}',
        homepage: 'https://www.startpage.com',
    },
    searx: {
        name: 'SearXNG',
        icon: '🔍',
        template: 'https://searx.be/search?q={query}',
        homepage: 'https://searx.be',
    },
    custom: {
        name: 'Custom',
        icon: '⚙',
        template: '', // User-defined
        homepage: '',
    },
};

// ─────────────────────────────────────────────
// TRACKING PARAMETERS TO STRIP
// ─────────────────────────────────────────────

export const TRACKING_PARAMS = new Set([
    // Google / UTM
    'utm_source', 'utm_medium', 'utm_campaign',
    'utm_term', 'utm_content', 'utm_id',
    'utm_source_platform', 'utm_creative_format',
    'utm_marketing_tactic',

    // Google Ads
    'gclid', 'gclsrc', 'gad_source', 'gbraid', 'wbraid',
    'dclid', 'gad',

    // Facebook / Meta
    'fbclid', 'fb_action_ids', 'fb_action_types',
    'fb_source', 'fb_ref', 'mc_eid',

    // Microsoft / Bing
    'msclkid', 'mkt_tok',

    // Twitter / X
    'twclid',

    // HubSpot
    '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp',
    'hsCtaTracking',

    // Mailchimp
    'mc_cid', 'mc_eid',

    // Drip
    'mc_eid', 'mc_cid',

    // Adobe
    's_cid', 'adobe_mc',

    // Amazon
    'tag', 'linkCode', 'linkId', 'ref_',

    // General tracking
    'ref', 'referrer', 'source', 'affiliate',
    'campaign', 'medium', 'adid', 'ad_id',
    'click_id', 'session_id', 'tracking_id',
    'zanpid', 'origin', 'igshid',

    // Yandex
    'yclid',

    // Pinterest
    'epik',

    // TikTok
    'ttclid',

    // LinkedIn
    'li_fat_id',
]);

// ─────────────────────────────────────────────
// DETECT SEARCH QUERY
// ─────────────────────────────────────────────

/**
 * Check if a URL is a search request from a non-private engine.
 * @param {string} url
 * @returns {{ isSearch: boolean, engine: string|null, query: string|null }}
 */
export function detectSearchQuery(url) {
    if (!url) return { isSearch: false, engine: null, query: null };

    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return { isSearch: false, engine: null, query: null };
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = parsed.pathname;

    for (const [engineKey, config] of Object.entries(SOURCE_ENGINES)) {
        // Check if hostname matches this engine
        const domainMatch = config.domains.some(d => {
            const clean = d.replace(/^www\./, '');
            return hostname === clean || hostname.endsWith('.' + clean);
        });

        if (!domainMatch) continue;

        // Check if path is a search path
        if (!pathname.startsWith(config.searchPath)) continue;

        // Extract query
        const query = parsed.searchParams.get(config.queryParam);
        if (!query || query.trim() === '') continue;

        return {
            isSearch: true,
            engine: engineKey,
            query: query.trim(),
        };
    }

    return { isSearch: false, engine: null, query: null };
}

// ─────────────────────────────────────────────
// EXTRACT QUERY
// ─────────────────────────────────────────────

/**
 * Extract just the search query from a search URL.
 * @param {string} url
 * @returns {string|null}
 */
export function extractQuery(url) {
    const result = detectSearchQuery(url);
    return result.query;
}

// ─────────────────────────────────────────────
// BUILD REDIRECT URL
// ─────────────────────────────────────────────

/**
 * Build a redirect URL to a privacy-first search engine.
 * @param {string} engineKey - Key from PRIVACY_ENGINES
 * @param {string} query     - The search query
 * @param {string} customTemplate - Custom URL template (if engine = 'custom')
 * @returns {string|null}
 */
export function buildRedirectURL(engineKey, query, customTemplate = '') {
    if (!query || !engineKey) return null;

    const engine = PRIVACY_ENGINES[engineKey];
    if (!engine) return null;

    let template = engine.template;

    // Custom engine
    if (engineKey === 'custom') {
        template = customTemplate;
    }

    if (!template || !template.includes('{query}')) return null;

    // Encode the query safely
    const encodedQuery = encodeURIComponent(query);
    return template.replace('{query}', encodedQuery);
}

// ─────────────────────────────────────────────
// CLEAN TRACKING PARAMETERS
// ─────────────────────────────────────────────

/**
 * Remove all known tracking parameters from a URL.
 * Returns the cleaned URL string, or original if no change.
 * @param {string} url
 * @returns {{ cleaned: string, removed: string[], changed: boolean }}
 */
export function cleanTrackingParams(url) {
    if (!url) return { cleaned: url, removed: [], changed: false };

    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return { cleaned: url, removed: [], changed: false };
    }

    const removed = [];
    const toDelete = [];

    for (const [key] of parsed.searchParams) {
        const lowerKey = key.toLowerCase();

        // Direct match
        if (TRACKING_PARAMS.has(lowerKey)) {
            toDelete.push(key);
            removed.push(key);
            continue;
        }

        // Prefix match (utm_*, ref_*, etc.)
        if (
            lowerKey.startsWith('utm_') ||
            lowerKey.startsWith('ref_') ||
            lowerKey.startsWith('fb_') ||
            lowerKey.startsWith('_hs') ||
            lowerKey.startsWith('mc_') ||
            lowerKey.startsWith('adobe_') ||
            lowerKey.startsWith('gad_')
        ) {
            toDelete.push(key);
            removed.push(key);
        }
    }

    if (toDelete.length === 0) {
        return { cleaned: url, removed: [], changed: false };
    }

    for (const key of toDelete) {
        parsed.searchParams.delete(key);
    }

    // Clean up empty ? at end
    let cleaned = parsed.toString();

    return { cleaned, removed, changed: true };
}

// ─────────────────────────────────────────────
// CHECK IF URL IS PRIVACY ENGINE (avoid redirect loops)
// ─────────────────────────────────────────────

/**
 * Check if a URL is already a privacy-first search engine.
 * Used to prevent infinite redirect loops.
 * @param {string} url
 * @returns {boolean}
 */
export function isPrivacyEngine(url) {
    if (!url) return false;

    const privacyDomains = [
        'duckduckgo.com',
        'search.brave.com',
        'startpage.com',
        'searx.be',
        'searxng.org',
        'whoogle.io',
        'metager.org',
        'mojeek.com',
        'swisscows.com',
        'ecosia.org',
    ];

    try {
        const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
        return privacyDomains.some(d => hostname === d || hostname.endsWith('.' + d));
    } catch {
        return false;
    }
}

// ─────────────────────────────────────────────
// GET ENGINE INFO
// ─────────────────────────────────────────────

export function getPrivacyEngineInfo(engineKey) {
    return PRIVACY_ENGINES[engineKey] || PRIVACY_ENGINES.duckduckgo;
}

export function getAllPrivacyEngines() {
    return Object.entries(PRIVACY_ENGINES).map(([key, val]) => ({
        key,
        ...val,
    }));
}