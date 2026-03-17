/**
 * PrivShield – Dashboard Controller
 * PrivMITLab
 *
 * Full dashboard UI logic:
 *  - Tab navigation
 *  - State management
 *  - Filter list management
 *  - Custom rules editor
 *  - Site manager
 *  - Request logs viewer
 */

'use strict';

// ─────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────

function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const tabPanels = document.querySelectorAll('.tab-panel');

    navItems.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.dataset.tab;

            // Deactivate all
            navItems.forEach(n => n.classList.remove('active'));
            tabPanels.forEach(p => p.classList.remove('active'));

            // Activate target
            btn.classList.add('active');
            const panel = document.getElementById(`tab-${targetTab}`);
            if (panel) panel.classList.add('active');

            // Load tab data
            loadTabData(targetTab);
        });
    });
}

function loadTabData(tab) {
    switch (tab) {
        case 'overview': loadOverview(); break;
        case 'filters': loadFilterLists(); break;
        case 'rules': loadCustomRules(); break;
        case 'sites': loadSiteManager(); break;
        case 'logs': loadLogs(); break;
    }
}

// ─────────────────────────────────────────────
// MESSAGING
// ─────────────────────────────────────────────

function sendMessage(action, payload = {}) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action, payload }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(response || {});
            }
        });
    });
}

// ─────────────────────────────────────────────
// OVERVIEW TAB
// ─────────────────────────────────────────────

async function loadOverview() {
    try {
        const state = await sendMessage('GET_STATE');

        // Stats
        setText('ovTotalBlocked', formatCount(state.blockCount || 0));
        setText('ovSessionBlocked', formatCount(state.sessionCount || 0));
        setText('ovTotalRules', formatCount(state.engineStats?.totalRules || 0));
        setText('ovCompileTime', (state.engineStats?.compileTime || 0) + 'ms');

        // Toggles
        setChecked('ovToggleEnabled', state.enabled !== false);
        setChecked('ovToggleStrict', state.strictMode === true);
        setChecked('ovToggleScripts', state.scriptBlock === true);
        setChecked('ovToggleFingerprint', state.blockFingerprint !== false);
        setChecked('ovToggleReferrer', state.stripReferrer !== false);
        setChecked('ovToggleUA', state.spoofUserAgent === true);

        // Engine info
        const stats = state.engineStats || {};
        setText('engTotal', formatCount(stats.totalRules || 0));
        setText('engBlock', formatCount(stats.blockRules || 0));
        setText('engAllow', formatCount(stats.allowRules || 0));
        setText('engCosmetic', formatCount(stats.cosmeticRules || 0));
        setText('engErrors', String(stats.parseErrors || 0));
        setText('engTime', (stats.compileTime || 0) + 'ms');

        // Sidebar status
        updateSidebarStatus(state.enabled !== false);

    } catch (err) {
        console.error('[PrivShield Dashboard] Overview load error:', err);
    }
}

function updateSidebarStatus(enabled) {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    if (!dot || !text) return;

    dot.className = 'status-dot ' + (enabled ? 'active' : 'inactive');
    text.textContent = enabled ? 'Active' : 'Paused';
}

function bindOverviewToggles() {
    bindToggle('ovToggleEnabled', 'SET_ENABLED', 'enabled');
    bindToggle('ovToggleStrict', 'SET_STRICT_MODE', 'strictMode');
    bindToggle('ovToggleScripts', 'SET_SCRIPT_BLOCK', 'scriptBlock');
    bindToggle('ovToggleFingerprint', 'SET_FINGERPRINT_BLOCK', 'blockFingerprint');
    bindToggle('ovToggleReferrer', 'SET_STRIP_REFERRER', 'stripReferrer');
    bindToggle('ovToggleUA', 'SET_SPOOF_UA', 'spoofUserAgent');

    const btnReload = document.getElementById('btnReloadFilters');
    if (btnReload) {
        btnReload.addEventListener('click', async () => {
            btnReload.disabled = true;
            btnReload.textContent = '⏳ Recompiling...';

            try {
                const result = await sendMessage('RELOAD_FILTERS');
                showToast(`✅ Filters recompiled — ${formatCount(result.stats?.totalRules || 0)} rules`);
                await loadOverview();
            } catch (err) {
                showToast('❌ Reload failed: ' + err.message);
            }

            btnReload.disabled = false;
            btnReload.textContent = '🔄 Recompile Filters';
        });
    }
}

function bindToggle(elementId, action, payloadKey) {
    const el = document.getElementById(elementId);
    if (!el) return;

    el.addEventListener('change', async () => {
        const payload = { [payloadKey]: el.checked };
        try {
            await sendMessage(action, payload);
            if (elementId === 'ovToggleEnabled') {
                updateSidebarStatus(el.checked);
            }
            showToast('✅ Setting saved');
        } catch (err) {
            showToast('❌ Error: ' + err.message);
            el.checked = !el.checked; // Revert
        }
    });
}

// ─────────────────────────────────────────────
// FILTER LISTS TAB
// ─────────────────────────────────────────────

async function loadFilterLists() {
    try {
        const { lists } = await sendMessage('GET_FILTER_LISTS');
        renderExternalLists(lists || []);
    } catch (err) {
        console.error('[PrivShield Dashboard] Filter lists error:', err);
    }
}

function renderExternalLists(lists) {
    const container = document.getElementById('externalListsContainer');
    if (!container) return;

    if (!lists || lists.length === 0) {
        container.innerHTML = '<div class="empty-state">No external lists added yet.</div>';
        return;
    }

    container.innerHTML = '';

    for (const list of lists) {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML = `
      <div class="list-item-info">
        <span class="list-name">📋 ${escapeHtml(list.name)}</span>
        <span class="list-meta">${formatCount(list.lines)} rules</span>
      </div>
      <div class="list-actions">
        <span class="badge badge-blue">Cached</span>
        <button class="btn btn-sm btn-primary" data-update="${escapeHtml(list.name)}">↻ Update</button>
        <button class="btn btn-sm btn-danger"  data-remove="${escapeHtml(list.name)}">✕</button>
      </div>
    `;
        container.appendChild(item);
    }

    // Update button handlers
    container.querySelectorAll('[data-update]').forEach(btn => {
        btn.addEventListener('click', () => updateFilterList(btn.dataset.update));
    });

    container.querySelectorAll('[data-remove]').forEach(btn => {
        btn.addEventListener('click', () => removeFilterList(btn.dataset.remove));
    });
}

async function updateFilterList(name) {
    // We need the URL — get from storage
    const stored = await chrome.storage.local.get('filterListUrls');
    const urls = stored.filterListUrls || {};
    const url = urls[name];

    if (!url) {
        showToast(`❌ No URL stored for ${name}. Re-add it.`);
        return;
    }

    showToast(`⏳ Updating ${name}...`);

    try {
        const result = await sendMessage('UPDATE_FILTER_LIST', { name, url });
        if (result.ok) {
            showToast(`✅ ${name} updated — ${formatCount(result.lines)} rules`);
            await loadFilterLists();
        } else {
            showToast(`❌ Update failed: ${result.error}`);
        }
    } catch (err) {
        showToast(`❌ ${err.message}`);
    }
}

async function removeFilterList(name) {
    if (!confirm(`Remove filter list "${name}"?`)) return;

    try {
        await sendMessage('REMOVE_FILTER_LIST', { name });
        showToast(`✅ ${name} removed`);
        await loadFilterLists();
    } catch (err) {
        showToast(`❌ ${err.message}`);
    }
}

function bindFilterListActions() {
    // Predefined list add buttons
    document.querySelectorAll('.predefined-add').forEach(btn => {
        btn.addEventListener('click', async () => {
            const item = btn.closest('.predefined-item');
            const name = item.dataset.name;
            const url = item.dataset.url;

            btn.disabled = true;
            btn.textContent = '⏳';

            try {
                // Store URL for future updates
                const stored = await chrome.storage.local.get('filterListUrls');
                const urls = stored.filterListUrls || {};
                urls[name] = url;
                await chrome.storage.local.set({ filterListUrls: urls });

                const result = await sendMessage('UPDATE_FILTER_LIST', { name, url });

                if (result.ok) {
                    showToast(`✅ ${name} added — ${formatCount(result.lines)} rules`);
                    btn.textContent = '✅';
                    await loadFilterLists();
                } else {
                    showToast(`❌ Failed: ${result.error}`);
                    btn.textContent = '+ Add';
                }
            } catch (err) {
                showToast(`❌ ${err.message}`);
                btn.textContent = '+ Add';
            }

            setTimeout(() => {
                btn.disabled = false;
                btn.textContent = '+ Add';
            }, 3000);
        });
    });

    // Custom URL add
    const btnAdd = document.getElementById('btnAddCustomList');
    const nameInput = document.getElementById('customListName');
    const urlInput = document.getElementById('customListUrl');

    if (btnAdd) {
        btnAdd.addEventListener('click', async () => {
            const name = nameInput?.value.trim();
            const url = urlInput?.value.trim();

            if (!name) { showToast('❌ Enter a list name'); return; }
            if (!url) { showToast('❌ Enter a URL'); return; }
            if (!url.startsWith('https://')) { showToast('❌ URL must start with https://'); return; }

            btnAdd.disabled = true;
            btnAdd.textContent = '⏳';

            try {
                // Store URL
                const stored = await chrome.storage.local.get('filterListUrls');
                const urls = stored.filterListUrls || {};
                urls[name] = url;
                await chrome.storage.local.set({ filterListUrls: urls });

                const result = await sendMessage('UPDATE_FILTER_LIST', { name, url });

                if (result.ok) {
                    showToast(`✅ ${name} added — ${formatCount(result.lines)} rules`);
                    nameInput.value = '';
                    urlInput.value = '';
                    await loadFilterLists();
                } else {
                    showToast(`❌ Failed: ${result.error}`);
                }
            } catch (err) {
                showToast(`❌ ${err.message}`);
            }

            btnAdd.disabled = false;
            btnAdd.textContent = '+ Add';
        });
    }
}

// ─────────────────────────────────────────────
// CUSTOM RULES TAB
// ─────────────────────────────────────────────

async function loadCustomRules() {
    try {
        const { customRules } = await sendMessage('GET_FILTER_LISTS');
        const editor = document.getElementById('customRulesEditor');
        if (editor) {
            editor.value = customRules || '';
            updateRuleLineCount(editor.value);
        }
    } catch (err) {
        console.error('[PrivShield Dashboard] Custom rules error:', err);
    }
}

function bindCustomRulesActions() {
    const editor = document.getElementById('customRulesEditor');
    const btnSave = document.getElementById('btnSaveRules');
    const btnClear = document.getElementById('btnClearRules');

    if (editor) {
        editor.addEventListener('input', () => {
            updateRuleLineCount(editor.value);
        });
    }

    if (btnSave) {
        btnSave.addEventListener('click', async () => {
            const rules = editor?.value || '';

            btnSave.disabled = true;
            btnSave.textContent = '⏳ Saving...';

            try {
                await sendMessage('SAVE_CUSTOM_RULES', { rules });
                showToast('✅ Custom rules saved & applied');
            } catch (err) {
                showToast(`❌ ${err.message}`);
            }

            btnSave.disabled = false;
            btnSave.textContent = '💾 Save & Apply';
        });
    }

    if (btnClear) {
        btnClear.addEventListener('click', () => {
            if (!editor) return;
            if (editor.value && !confirm('Clear all custom rules?')) return;
            editor.value = '';
            updateRuleLineCount('');
        });
    }
}

function updateRuleLineCount(text) {
    const counter = document.getElementById('ruleLineCount');
    if (!counter) return;

    const lines = text.split('\n').filter(l => {
        const t = l.trim();
        return t && !t.startsWith('!') && !t.startsWith('#');
    });

    counter.textContent = `${lines.length} rule${lines.length !== 1 ? 's' : ''}`;
}

// ─────────────────────────────────────────────
// SITE MANAGER TAB
// ─────────────────────────────────────────────

async function loadSiteManager() {
    try {
        const stored = await chrome.storage.local.get('siteSettings');
        const sites = stored.siteSettings || {};
        renderSitesList(sites);
    } catch (err) {
        console.error('[PrivShield Dashboard] Site manager error:', err);
    }
}

function renderSitesList(sites, filter = '') {
    const container = document.getElementById('sitesList');
    if (!container) return;

    const hosts = Object.keys(sites).filter(h => {
        if (!filter) return true;
        return h.toLowerCase().includes(filter.toLowerCase());
    });

    if (hosts.length === 0) {
        container.innerHTML = '<div class="empty-state">No site settings configured.</div>';
        return;
    }

    container.innerHTML = '';

    for (const host of hosts.sort()) {
        const cfg = sites[host];
        const item = document.createElement('div');
        item.className = 'site-item';

        const tags = [];
        if (cfg.whitelisted) tags.push('<span class="badge badge-green">Allowlisted</span>');
        if (cfg.enabled === false) tags.push('<span class="badge badge-orange">Paused</span>');
        if (cfg.blockScripts) tags.push('<span class="badge badge-blue">No Scripts</span>');
        if (cfg.strictMode) tags.push('<span class="badge badge-blue">Strict</span>');

        item.innerHTML = `
      <div>
        <div class="site-item-host">${escapeHtml(host)}</div>
        <div class="site-item-tags">${tags.join('') || '<span style="color:var(--text-muted);font-size:11px">Default settings</span>'}</div>
      </div>
      <div class="site-item-actions">
        <button class="btn btn-sm btn-danger" data-remove-site="${escapeHtml(host)}">🗑</button>
      </div>
    `;

        container.appendChild(item);
    }

    container.querySelectorAll('[data-remove-site]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const host = btn.dataset.removeSite;
            if (!confirm(`Remove settings for ${host}?`)) return;

            const stored = await chrome.storage.local.get('siteSettings');
            const s = stored.siteSettings || {};
            delete s[host];
            await chrome.storage.local.set({ siteSettings: s });

            // Also notify background
            await sendMessage('SET_SITE_WHITELIST', { host, whitelisted: false });

            showToast(`✅ Settings removed for ${host}`);
            loadSiteManager();
        });
    });
}

function bindSiteManagerActions() {
    const searchInput = document.getElementById('siteSearchInput');
    const btnRefresh = document.getElementById('btnRefreshSites');

    if (searchInput) {
        searchInput.addEventListener('input', async () => {
            const stored = await chrome.storage.local.get('siteSettings');
            const sites = stored.siteSettings || {};
            renderSitesList(sites, searchInput.value);
        });
    }

    if (btnRefresh) {
        btnRefresh.addEventListener('click', loadSiteManager);
    }
}

// ─────────────────────────────────────────────
// LOGS TAB
// ─────────────────────────────────────────────

async function loadLogs() {
    try {
        const typeFilter = document.getElementById('logTypeFilter')?.value || '';
        const searchFilter = document.getElementById('logSearchInput')?.value.toLowerCase() || '';

        const { logs, blockCount } = await sendMessage('GET_LOGS');

        let filtered = logs || [];

        if (typeFilter) {
            filtered = filtered.filter(l => l.type === typeFilter);
        }

        if (searchFilter) {
            filtered = filtered.filter(l =>
                (l.url || '').toLowerCase().includes(searchFilter) ||
                (l.requestHost || '').toLowerCase().includes(searchFilter)
            );
        }

        setText('logTotalCount', formatCount(blockCount || 0));
        setText('logShownCount', String(filtered.length));

        renderLogs(filtered);

    } catch (err) {
        console.error('[PrivShield Dashboard] Logs error:', err);
    }
}

function renderLogs(logs) {
    const container = document.getElementById('logsContainer');
    if (!container) return;

    if (!logs || logs.length === 0) {
        container.innerHTML = '<div class="empty-state">No blocked requests in log.</div>';
        return;
    }

    container.innerHTML = '';

    for (const entry of logs) {
        const el = document.createElement('div');
        el.className = 'log-entry';

        const type = (entry.type || 'other').toLowerCase();
        const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
        const shortUrl = truncateUrl(entry.url || '', 70);

        el.innerHTML = `
      <span class="log-type-badge ${type}">${escapeHtml(type)}</span>
      <div class="log-details">
        <span class="log-url" title="${escapeHtml(entry.url || '')}">${escapeHtml(shortUrl)}</span>
        <div class="log-meta">
          <span class="log-reason">${escapeHtml(entry.reason || 'blocked')}</span>
          <span class="log-initiator">from: ${escapeHtml(entry.initiatorHost || 'unknown')}</span>
          <span class="log-time">${escapeHtml(time)}</span>
        </div>
      </div>
    `;

        container.appendChild(el);
    }
}

function bindLogActions() {
    const typeFilter = document.getElementById('logTypeFilter');
    const searchInput = document.getElementById('logSearchInput');
    const btnRefresh = document.getElementById('btnRefreshLogs');
    const btnClear = document.getElementById('btnClearLogs');

    if (typeFilter) typeFilter.addEventListener('change', loadLogs);
    if (searchInput) {
        let searchTimer = null;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(loadLogs, 300);
        });
    }

    if (btnRefresh) btnRefresh.addEventListener('click', loadLogs);

    if (btnClear) {
        btnClear.addEventListener('click', async () => {
            if (!confirm('Clear all blocked request logs?')) return;
            try {
                await sendMessage('CLEAR_LOGS');
                showToast('✅ Logs cleared');
                loadLogs();
            } catch (err) {
                showToast(`❌ ${err.message}`);
            }
        });
    }
}

// ─────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────

let toastTimer = null;

function showToast(message, duration = 2500) {
    const toast = document.getElementById('dashToast');
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add('show');

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function setChecked(id, checked) {
    const el = document.getElementById(id);
    if (el) el.checked = checked;
}

function formatCount(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function truncateUrl(url, max) {
    if (!url) return '';
    if (url.length <= max) return url;
    return url.slice(0, max) + '…';
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────

async function init() {
    // Setup navigation
    initNavigation();

    // Bind all action handlers
    bindOverviewToggles();
    bindFilterListActions();
    bindCustomRulesActions();
    bindSiteManagerActions();
    bindLogActions();

    // Load default tab
    await loadOverview();
}

// Add GET_COSMETIC_SELECTORS handler in background (append to background.js message handler)
// Note: handled via message system below

document.addEventListener('DOMContentLoaded', init);