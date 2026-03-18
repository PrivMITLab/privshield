/**
 * PrivShield – Popup Controller v2.0.0
 * PrivMITLab
 *
 * Fixed:
 *  - Auto-refresh for live block count
 *  - Redirect count display
 *  - Engine switcher highlight
 *  - Smooth UI updates
 */
'use strict';

// ─────────────────────────────────────────────
// DOM ELEMENTS
// ─────────────────────────────────────────────

const el = {
    currentHostname: document.getElementById('currentHostname'),
    siteStatus: document.getElementById('siteStatus'),
    siteStatusIcon: document.getElementById('siteStatusIcon'),
    tabBlockCount: document.getElementById('tabBlockCount'),
    statTotal: document.getElementById('statTotal'),
    statRedirect: document.getElementById('statRedirect'),
    statRules: document.getElementById('statRules'),
    toggleGlobal: document.getElementById('toggleGlobal'),
    toggleFingerprint: document.getElementById('toggleFingerprint'),
    toggleReferrer: document.getElementById('toggleReferrer'),
    toggleUA: document.getElementById('toggleUA'),
    toggleStrict: document.getElementById('toggleStrict'),
    toggleScripts: document.getElementById('toggleScripts'),
    toggleSite: document.getElementById('toggleSite'),
    toggleSiteScripts: document.getElementById('toggleSiteScripts'),
    toggleSiteStrict: document.getElementById('toggleSiteStrict'),
    toggleSearchRedirect: document.getElementById('toggleSearchRedirect'),
    toggleCleanURLs: document.getElementById('toggleCleanURLs'),
    btnWhitelist: document.getElementById('btnWhitelist'),
    whitelistText: document.getElementById('whitelistBtnText'),
    btnDashboard: document.getElementById('btnDashboard'),
    btnReload: document.getElementById('btnReload'),
    toast: document.getElementById('psToast'),
    engineBtns: document.querySelectorAll('.ps-engine-btn'),
};

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

let currentTab = null;
let currentHostname = '';
let globalState = {};
let siteSettings = {};
let isWhitelisted = false;
let refreshInterval = null;

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────

async function init() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        currentTab = tab;

        if (tab?.url) {
            try {
                currentHostname = new URL(tab.url).hostname.toLowerCase().replace(/^www\./, '');
            } catch {
                currentHostname = '';
            }
        }

        el.currentHostname.textContent = currentHostname || 'No page';

        await refreshState();
        bindEvents();
        startAutoRefresh();

    } catch (err) {
        console.error('[PrivShield Popup] Init error:', err);
    }
}

// ─────────────────────────────────────────────
// REFRESH STATE (Full)
// ─────────────────────────────────────────────

async function refreshState() {
    try {
        globalState = await sendMessage('GET_STATE');

        if (currentHostname) {
            const r = await sendMessage('GET_SITE_SETTINGS', { host: currentHostname });
            siteSettings = r.settings || {};
            isWhitelisted = r.isWhitelisted || false;
        }

        let tabCount = 0, tabRedirects = 0;
        if (currentTab) {
            const r = await sendMessage('GET_TAB_COUNT', { tabId: currentTab.id });
            tabCount = r.count || 0;
            tabRedirects = r.redirects || 0;
        }

        renderUI(globalState, siteSettings, tabCount, tabRedirects);

    } catch (err) {
        console.error('[PrivShield Popup] Refresh error:', err);
    }
}

// ─────────────────────────────────────────────
// AUTO REFRESH – Live Count (every 3 sec)
// ─────────────────────────────────────────────

function startAutoRefresh() {
    if (refreshInterval) return;

    refreshInterval = setInterval(async () => {
        try {
            let tabCount = 0, tabRedirects = 0;

            if (currentTab) {
                const r = await sendMessage('GET_TAB_COUNT', { tabId: currentTab.id });
                tabCount = r.count || 0;
                tabRedirects = r.redirects || 0;
            }

            const gState = await sendMessage('GET_STATE');

            // Update numbers only (no full re-render = smooth)
            const total = tabCount + tabRedirects;
            el.tabBlockCount.textContent = formatCount(total);
            el.statTotal.textContent = formatCount(gState.blockCount || 0);
            el.statRedirect.textContent = formatCount(gState.redirectCount || 0);
            el.statRules.textContent = formatCount(gState.engineStats?.totalRules || 0);

            // Animate badge number if changed
            if (total > 0) {
                el.tabBlockCount.style.color = tabRedirects > 0 ? '#3fb950' : '#f85149';
            }

        } catch {
            // Popup may be closing – silent fail
        }
    }, 3000);
}

// Clear interval when popup closes
window.addEventListener('unload', () => {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
});

// ─────────────────────────────────────────────
// RENDER UI
// ─────────────────────────────────────────────

function renderUI(g, s, tabCount, tabRedirects) {

    // ── Global toggles
    el.toggleGlobal.checked = g.enabled !== false;
    el.toggleFingerprint.checked = g.blockFingerprint !== false;
    el.toggleReferrer.checked = g.stripReferrer !== false;
    el.toggleUA.checked = g.spoofUserAgent === true;
    el.toggleStrict.checked = g.strictMode === true;
    el.toggleScripts.checked = g.scriptBlock === true;
    el.toggleSearchRedirect.checked = g.searchRedirect !== false;
    el.toggleCleanURLs.checked = g.cleanTrackingURLs !== false;

    // ── Site toggles
    el.toggleSite.checked = s.enabled !== false;
    el.toggleSiteScripts.checked = s.blockScripts === true;
    el.toggleSiteStrict.checked = s.strictMode === true;

    // ── Whitelist button
    el.btnWhitelist.classList.toggle('is-whitelisted', isWhitelisted);
    el.whitelistText.textContent = isWhitelisted
        ? '✕ Remove from Allowlist'
        : '☑ Add to Allowlist';

    // ── Stats
    el.statTotal.textContent = formatCount(g.blockCount || 0);
    el.statRedirect.textContent = formatCount(g.redirectCount || 0);
    el.statRules.textContent = formatCount(g.engineStats?.totalRules || 0);

    // ── Tab badge count (blocked + redirected)
    const total = tabCount + tabRedirects;
    el.tabBlockCount.textContent = formatCount(total);
    el.tabBlockCount.style.color = tabRedirects > 0 ? '#3fb950' : '#f85149';

    // ── Engine buttons – highlight active
    const activeEngine = g.searchEngine || 'duckduckgo';
    el.engineBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.engine === activeEngine);
    });

    // ── Site status
    updateSiteStatus(g, s);

    // ── Disabled overlay
    document.body.classList.toggle('ps-disabled', g.enabled === false);
}

function updateSiteStatus(g, s) {
    if (g.enabled === false) {
        el.siteStatusIcon.textContent = '🔴';
        el.siteStatus.textContent = 'PrivShield Disabled';
        el.siteStatus.className = 'ps-site-status unprotected';
        return;
    }
    if (isWhitelisted) {
        el.siteStatusIcon.textContent = '🟡';
        el.siteStatus.textContent = 'Allowlisted';
        el.siteStatus.className = 'ps-site-status whitelisted';
        return;
    }
    if (s.enabled === false) {
        el.siteStatusIcon.textContent = '🟠';
        el.siteStatus.textContent = 'Site Paused';
        el.siteStatus.className = 'ps-site-status whitelisted';
        return;
    }
    el.siteStatusIcon.textContent = '🟢';
    el.siteStatus.textContent = 'Protected';
    el.siteStatus.className = 'ps-site-status';
}

// ─────────────────────────────────────────────
// BIND EVENTS
// ─────────────────────────────────────────────

function bindEvents() {

    // ── Global toggle
    el.toggleGlobal.addEventListener('change', async () => {
        await sendMessage('SET_ENABLED', { enabled: el.toggleGlobal.checked });
        showToast(el.toggleGlobal.checked ? '✅ PrivShield ON' : '⛔ PrivShield OFF');
        await refreshState();
    });

    // ── Global options
    el.toggleFingerprint.addEventListener('change', async () => {
        await sendMessage('SET_FINGERPRINT_BLOCK', { blockFingerprint: el.toggleFingerprint.checked });
        showToast('🧬 Fingerprint protection ' + (el.toggleFingerprint.checked ? 'ON' : 'OFF'));
    });

    el.toggleReferrer.addEventListener('change', async () => {
        await sendMessage('SET_STRIP_REFERRER', { stripReferrer: el.toggleReferrer.checked });
        showToast('🔗 Referrer stripping ' + (el.toggleReferrer.checked ? 'ON' : 'OFF'));
    });

    el.toggleUA.addEventListener('change', async () => {
        await sendMessage('SET_SPOOF_UA', { spoofUserAgent: el.toggleUA.checked });
        showToast('🕵 User-Agent spoofing ' + (el.toggleUA.checked ? 'ON' : 'OFF'));
    });

    el.toggleStrict.addEventListener('change', async () => {
        await sendMessage('SET_STRICT_MODE', { strictMode: el.toggleStrict.checked });
        showToast(el.toggleStrict.checked ? '🔒 Strict Mode ON' : 'Strict Mode OFF');
    });

    el.toggleScripts.addEventListener('change', async () => {
        await sendMessage('SET_SCRIPT_BLOCK', { scriptBlock: el.toggleScripts.checked });
        showToast(el.toggleScripts.checked ? '📜 All Scripts Blocked' : 'Scripts Allowed');
    });

    // ── Search toggles
    el.toggleSearchRedirect.addEventListener('change', async () => {
        await sendMessage('SET_SEARCH_REDIRECT', { searchRedirect: el.toggleSearchRedirect.checked });
        showToast(el.toggleSearchRedirect.checked ? '🔍 Search Redirect ON' : 'Search Redirect OFF');
    });

    el.toggleCleanURLs.addEventListener('change', async () => {
        await sendMessage('SET_CLEAN_TRACKING', { cleanTrackingURLs: el.toggleCleanURLs.checked });
        showToast(el.toggleCleanURLs.checked ? '🧹 URL Cleaning ON' : 'URL Cleaning OFF');
    });

    // ── Engine buttons
    el.engineBtns.forEach(btn => {
        btn.addEventListener('click', async () => {
            const engine = btn.dataset.engine;
            await sendMessage('SET_SEARCH_ENGINE', { searchEngine: engine });

            // Update active state immediately
            el.engineBtns.forEach(b => b.classList.toggle('active', b.dataset.engine === engine));

            const names = {
                duckduckgo: 'DuckDuckGo',
                brave: 'Brave Search',
                startpage: 'Startpage',
            };
            showToast(`✅ Engine: ${names[engine] || engine}`);
        });
    });

    // ── Per-site controls
    el.toggleSite.addEventListener('change', async () => {
        if (!currentHostname) return;
        await sendMessage('SET_SITE_ENABLED', {
            host: currentHostname,
            enabled: el.toggleSite.checked,
        });
        await refreshState();
        showToast(`Site protection ${el.toggleSite.checked ? 'enabled' : 'disabled'}`);
    });

    el.toggleSiteScripts.addEventListener('change', async () => {
        if (!currentHostname) return;
        await sendMessage('SET_SITE_BLOCK_SCRIPTS', {
            host: currentHostname,
            blockScripts: el.toggleSiteScripts.checked,
        });
        showToast(el.toggleSiteScripts.checked
            ? '📜 Scripts blocked on site'
            : 'Scripts allowed on site');
    });

    el.toggleSiteStrict.addEventListener('change', async () => {
        if (!currentHostname) return;
        await sendMessage('SET_SITE_STRICT', {
            host: currentHostname,
            strictMode: el.toggleSiteStrict.checked,
        });
        showToast(`Site strict mode ${el.toggleSiteStrict.checked ? 'ON' : 'OFF'}`);
    });

    // ── Whitelist button
    el.btnWhitelist.addEventListener('click', async () => {
        if (!currentHostname) return;
        const newState = !isWhitelisted;
        await sendMessage('SET_SITE_WHITELIST', {
            host: currentHostname,
            whitelisted: newState,
        });
        showToast(newState
            ? `✅ ${currentHostname} allowlisted`
            : `🔒 ${currentHostname} removed from allowlist`);
        await refreshState();
    });

    // ── Footer buttons
    el.btnDashboard.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
        window.close();
    });

    el.btnReload.addEventListener('click', async () => {
        if (currentTab) {
            await chrome.tabs.reload(currentTab.id);
            window.close();
        }
    });
}

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────

function sendMessage(action, payload = {}) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action, payload }, res => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(res || {});
            }
        });
    });
}

function formatCount(n) {
    n = Number(n) || 0;
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
}

let toastTimer = null;
function showToast(msg, duration = 1800) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), duration);
}

// ─────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);