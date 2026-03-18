/**
 * PrivShield – Popup Controller
 * PrivMITLab
 *
 * Handles all popup UI interactions.
 * Communicates with background.js via chrome.runtime.sendMessage.
 */

'use strict';

// ─────────────────────────────────────────────
// DOM Elements
// ─────────────────────────────────────────────

const el = {
  // Header / status
  currentHostname:  document.getElementById('currentHostname'),
  siteStatus:       document.getElementById('siteStatus'),
  siteStatusIcon:   document.getElementById('siteStatusIcon'),
  tabBlockCount:    document.getElementById('tabBlockCount'),

  // Stats
  statTotal:        document.getElementById('statTotal'),
  statSession:      document.getElementById('statSession'),
  statRules:        document.getElementById('statRules'),

  // Global toggles
  toggleGlobal:     document.getElementById('toggleGlobal'),
  toggleFingerprint:document.getElementById('toggleFingerprint'),
  toggleReferrer:   document.getElementById('toggleReferrer'),
  toggleUA:         document.getElementById('toggleUA'),
  toggleStrict:     document.getElementById('toggleStrict'),
  toggleScripts:    document.getElementById('toggleScripts'),

  // Site toggles
  toggleSite:        document.getElementById('toggleSite'),
  toggleSiteScripts: document.getElementById('toggleSiteScripts'),
  toggleSiteStrict:  document.getElementById('toggleSiteStrict'),

  // Buttons
  btnWhitelist:   document.getElementById('btnWhitelist'),
  whitelistText:  document.getElementById('whitelistBtnText'),
  btnDashboard:   document.getElementById('btnDashboard'),
  btnReload:      document.getElementById('btnReload'),

  // Toast
  toast: document.getElementById('psToast'),
};

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────

let currentTab      = null;
let currentHostname = '';
let globalState     = {};
let siteSettings    = {};
let isWhitelisted   = false;

// ─────────────────────────────────────────────
// Initialize
// ─────────────────────────────────────────────

async function init() {
  try {
    // Get current tab info
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab  = tab;

    if (tab && tab.url) {
      try {
        currentHostname = new URL(tab.url).hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        currentHostname = '';
      }
    }

    el.currentHostname.textContent = currentHostname || 'No page';

    // Load state from background
    await refreshState();

    // Register listeners
    bindEvents();

  } catch (err) {
    console.error('[PrivShield Popup] Init error:', err);
    showToast('Extension loading...', 2000);
  }
}

async function refreshState() {
  try {
    // Get global state
    globalState = await sendMessage({ action: 'GET_STATE' });

    // Get site-specific settings
    if (currentHostname) {
      const siteResp = await sendMessage({
        action:  'GET_SITE_SETTINGS',
        payload: { host: currentHostname },
      });
      siteSettings  = siteResp.settings || {};
      isWhitelisted = siteResp.isWhitelisted || false;
    }

    // Get tab block count
    let tabCount = 0;
    if (currentTab) {
      const countResp = await sendMessage({
        action:  'GET_TAB_COUNT',
        payload: { tabId: currentTab.id },
      });
      tabCount = countResp.count || 0;
    }

    // Update UI
    renderUI(globalState, siteSettings, tabCount);

  } catch (err) {
    console.error('[PrivShield Popup] State load error:', err);
  }
}

// ─────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────

function renderUI(gState, sState, tabCount) {
  // ── Global toggle
  el.toggleGlobal.checked     = gState.enabled !== false;
  el.toggleFingerprint.checked = gState.blockFingerprint !== false;
  el.toggleReferrer.checked   = gState.stripReferrer !== false;
  el.toggleUA.checked         = gState.spoofUserAgent === true;
  el.toggleStrict.checked     = gState.strictMode === true;
  el.toggleScripts.checked    = gState.scriptBlock === true;

  // ── Site toggles
  el.toggleSite.checked        = sState.enabled !== false;
  el.toggleSiteScripts.checked = sState.blockScripts === true;
  el.toggleSiteStrict.checked  = sState.strictMode === true;

  // ── Whitelist button
  if (isWhitelisted) {
    el.btnWhitelist.classList.add('is-whitelisted');
    el.whitelistText.textContent = '✕ Remove from Allowlist';
  } else {
    el.btnWhitelist.classList.remove('is-whitelisted');
    el.whitelistText.textContent = '☑ Add to Allowlist';
  }

  // ── Stats
  el.statTotal.textContent   = formatCount(gState.blockCount || 0);
  el.statSession.textContent = formatCount(gState.sessionCount || 0);
  el.statRules.textContent   = formatCount(gState.engineStats?.totalRules || 0);

  // ── Tab block count
  el.tabBlockCount.textContent = formatCount(tabCount);

  // ── Site status display
  updateSiteStatusDisplay(gState, sState);

  // ── Disabled state
  if (!gState.enabled) {
    document.body.classList.add('ps-disabled');
  } else {
    document.body.classList.remove('ps-disabled');
  }
}

function updateSiteStatusDisplay(gState, sState) {
  if (!gState.enabled) {
    el.siteStatusIcon.textContent  = '🔴';
    el.siteStatus.textContent      = 'PrivShield Disabled';
    el.siteStatus.className        = 'ps-site-status unprotected';
    return;
  }

  if (isWhitelisted) {
    el.siteStatusIcon.textContent  = '🟡';
    el.siteStatus.textContent      = 'Allowlisted';
    el.siteStatus.className        = 'ps-site-status whitelisted';
    return;
  }

  if (sState.enabled === false) {
    el.siteStatusIcon.textContent  = '🟠';
    el.siteStatus.textContent      = 'Site Paused';
    el.siteStatus.className        = 'ps-site-status whitelisted';
    return;
  }

  el.siteStatusIcon.textContent    = '🟢';
  el.siteStatus.textContent        = 'Protected';
  el.siteStatus.className          = 'ps-site-status';
}

// ─────────────────────────────────────────────
// Event Bindings
// ─────────────────────────────────────────────

function bindEvents() {

  // ── Global toggle
  el.toggleGlobal.addEventListener('change', async () => {
    const enabled = el.toggleGlobal.checked;
    await sendMessage({ action: 'SET_ENABLED', payload: { enabled } });
    showToast(enabled ? '✅ PrivShield ON' : '⛔ PrivShield OFF');
    await refreshState();
  });

  // ── Global options
  el.toggleFingerprint.addEventListener('change', async () => {
    await sendMessage({
      action:  'SET_FINGERPRINT_BLOCK',
      payload: { blockFingerprint: el.toggleFingerprint.checked },
    });
    showToast('Fingerprint protection updated');
  });

  el.toggleReferrer.addEventListener('change', async () => {
    await sendMessage({
      action:  'SET_STRIP_REFERRER',
      payload: { stripReferrer: el.toggleReferrer.checked },
    });
    showToast('Referrer stripping updated');
  });

  el.toggleUA.addEventListener('change', async () => {
    await sendMessage({
      action:  'SET_SPOOF_UA',
      payload: { spoofUserAgent: el.toggleUA.checked },
    });
    showToast('User-Agent spoofing updated');
  });

  el.toggleStrict.addEventListener('change', async () => {
    await sendMessage({
      action:  'SET_STRICT_MODE',
      payload: { strictMode: el.toggleStrict.checked },
    });
    showToast(el.toggleStrict.checked ? '🔒 Strict Mode ON' : 'Strict Mode OFF');
  });

  el.toggleScripts.addEventListener('change', async () => {
    await sendMessage({
      action:  'SET_SCRIPT_BLOCK',
      payload: { scriptBlock: el.toggleScripts.checked },
    });
    showToast(el.toggleScripts.checked ? '📜 Scripts blocked globally' : 'Scripts allowed');
  });

  // ── Per-site controls
  el.toggleSite.addEventListener('change', async () => {
    if (!currentHostname) return;
    await sendMessage({
      action:  'SET_SITE_ENABLED',
      payload: { host: currentHostname, enabled: el.toggleSite.checked },
    });
    await refreshState();
    showToast(`Site protection ${el.toggleSite.checked ? 'enabled' : 'disabled'}`);
  });

  el.toggleSiteScripts.addEventListener('change', async () => {
    if (!currentHostname) return;
    await sendMessage({
      action:  'SET_SITE_BLOCK_SCRIPTS',
      payload: { host: currentHostname, blockScripts: el.toggleSiteScripts.checked },
    });
    showToast(el.toggleSiteScripts.checked ? 'Scripts blocked on site' : 'Scripts allowed on site');
  });

  el.toggleSiteStrict.addEventListener('change', async () => {
    if (!currentHostname) return;
    await sendMessage({
      action:  'SET_SITE_STRICT',
      payload: { host: currentHostname, strictMode: el.toggleSiteStrict.checked },
    });
    showToast(`Site strict mode ${el.toggleSiteStrict.checked ? 'ON' : 'OFF'}`);
  });

  // ── Whitelist button
  el.btnWhitelist.addEventListener('click', async () => {
    if (!currentHostname) return;
    const newState = !isWhitelisted;
    await sendMessage({
      action:  'SET_SITE_WHITELIST',
      payload: { host: currentHostname, whitelisted: newState },
    });
    showToast(newState ? `✅ ${currentHostname} allowlisted` : `🔒 ${currentHostname} removed from allowlist`);
    await refreshState();
  });

  // ── Dashboard button
  el.btnDashboard.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  // ── Reload button
  el.btnReload.addEventListener('click', async () => {
    if (currentTab) {
      await chrome.tabs.reload(currentTab.id);
      window.close();
    }
  });
}

// ─────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response || {});
      }
    });
  });
}

function formatCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

let toastTimer = null;
function showToast(message, duration = 1800) {
  el.toast.textContent = message;
  el.toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.classList.remove('show');
  }, duration);
}

// ─────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);