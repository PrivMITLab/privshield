/**
 * PrivShield – Dashboard Controller v2.0.0
 * PrivMITLab
 */
'use strict';

// ─────────────────────────────────────────────
// NAV
// ─────────────────────────────────────────────

function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const panel = document.getElementById(`tab-${btn.dataset.tab}`);
            if (panel) panel.classList.add('active');
            loadTabData(btn.dataset.tab);
        });
    });
}

function loadTabData(tab) {
    switch (tab) {
        case 'overview': loadOverview(); break;
        case 'search': loadSearchTab(); break;
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
        chrome.runtime.sendMessage({ action, payload }, res => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(res || {});
        });
    });
}

// ─────────────────────────────────────────────
// OVERVIEW
// ─────────────────────────────────────────────

async function loadOverview() {
    try {
        const s = await sendMessage('GET_STATE');

        setText('ovTotalBlocked', formatCount(s.blockCount || 0));
        setText('ovRedirectCount', formatCount(s.redirectCount || 0));
        setText('ovTotalRules', formatCount(s.engineStats?.totalRules || 0));
        setText('ovCompileTime', (s.engineStats?.compileTime || 0) + 'ms');

        setChecked('ovToggleEnabled', s.enabled !== false);
        setChecked('ovToggleStrict', s.strictMode === true);
        setChecked('ovToggleScripts', s.scriptBlock === true);
        setChecked('ovToggleFingerprint', s.blockFingerprint !== false);
        setChecked('ovToggleReferrer', s.stripReferrer !== false);
        setChecked('ovToggleUA', s.spoofUserAgent === true);

        const stats = s.engineStats || {};
        setText('engTotal', formatCount(stats.totalRules || 0));
        setText('engBlock', formatCount(stats.blockRules || 0));
        setText('engAllow', formatCount(stats.allowRules || 0));
        setText('engCosmetic', formatCount(stats.cosmeticRules || 0));
        setText('engErrors', String(stats.parseErrors || 0));
        setText('engTime', (stats.compileTime || 0) + 'ms');

        const dot = document.getElementById('statusDot');
        const text = document.getElementById('statusText');
        if (dot && text) {
            dot.className = 'status-dot ' + (s.enabled !== false ? 'active' : 'inactive');
            text.textContent = s.enabled !== false ? 'Active' : 'Paused';
        }
    } catch (err) {
        console.error('[Dashboard] Overview error:', err);
    }
}

function bindOverviewToggles() {
    const map = [
        ['ovToggleEnabled', 'SET_ENABLED', 'enabled'],
        ['ovToggleStrict', 'SET_STRICT_MODE', 'strictMode'],
        ['ovToggleScripts', 'SET_SCRIPT_BLOCK', 'scriptBlock'],
        ['ovToggleFingerprint', 'SET_FINGERPRINT_BLOCK', 'blockFingerprint'],
        ['ovToggleReferrer', 'SET_STRIP_REFERRER', 'stripReferrer'],
        ['ovToggleUA', 'SET_SPOOF_UA', 'spoofUserAgent'],
    ];

    for (const [id, action, key] of map) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.addEventListener('change', async () => {
            await sendMessage(action, { [key]: el.checked });
            showToast('✅ Saved');
            if (id === 'ovToggleEnabled') {
                const dot = document.getElementById('statusDot');
                const text = document.getElementById('statusText');
                if (dot) dot.className = 'status-dot ' + (el.checked ? 'active' : 'inactive');
                if (text) text.textContent = el.checked ? 'Active' : 'Paused';
            }
        });
    }

    const btnReload = document.getElementById('btnReloadFilters');
    if (btnReload) {
        btnReload.addEventListener('click', async () => {
            btnReload.disabled = true;
            btnReload.textContent = '⏳ Recompiling...';
            try {
                const r = await sendMessage('RELOAD_FILTERS');
                showToast(`✅ ${formatCount(r.stats?.totalRules || 0)} rules compiled`);
                loadOverview();
            } catch (err) {
                showToast('❌ ' + err.message);
            }
            btnReload.disabled = false;
            btnReload.textContent = '🔄 Recompile Filters';
        });
    }
}

// ─────────────────────────────────────────────
// SEARCH TAB
// ─────────────────────────────────────────────

async function loadSearchTab() {
    try {
        const s = await sendMessage('GET_STATE');

        setChecked('srToggleRedirect', s.searchRedirect !== false);
        setChecked('srToggleClean', s.cleanTrackingURLs !== false);
        setChecked('srToggleBlock', s.blockNonPrivate === true);

        // Engine cards
        updateEngineCards(s.searchEngine || 'duckduckgo');

        // Custom URL
        const custInput = document.getElementById('customEngineURL');
        if (custInput) custInput.value = s.customSearchURL || '';

        // Show/hide custom section
        const customSec = document.getElementById('customEngineSection');
        if (customSec) {
            customSec.style.display = s.searchEngine === 'custom' ? 'block' : 'none';
        }

        // Update redirect rule targets
        const engineNames = {
            duckduckgo: '🦆 duckduckgo.com',
            brave: '🦁 search.brave.com',
            startpage: '🔒 startpage.com',
            searx: '🔍 searx.be',
            custom: '⚙ Custom Engine',
        };
        const label = engineNames[s.searchEngine] || '🦆 duckduckgo.com';
        ['rdTo1', 'rdTo2', 'rdTo3', 'rdTo4'].forEach(id => setText(id, label));

    } catch (err) {
        console.error('[Dashboard] Search tab error:', err);
    }
}

function updateEngineCards(activeEngine) {
    document.querySelectorAll('.engine-card').forEach(card => {
        card.classList.toggle('active', card.dataset.engine === activeEngine);
    });
}

function bindSearchActions() {
    // Toggle handlers
    const map = [
        ['srToggleRedirect', 'SET_SEARCH_REDIRECT', 'searchRedirect'],
        ['srToggleClean', 'SET_CLEAN_TRACKING', 'cleanTrackingURLs'],
        ['srToggleBlock', 'SET_BLOCK_NON_PRIVATE', 'blockNonPrivate'],
    ];
    for (const [id, action, key] of map) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.addEventListener('change', async () => {
            await sendMessage(action, { [key]: el.checked });
            showToast('✅ Search setting saved');
        });
    }

    // Engine cards
    document.querySelectorAll('.engine-card').forEach(card => {
        card.addEventListener('click', async () => {
            const engine = card.dataset.engine;
            await sendMessage('SET_SEARCH_ENGINE', { searchEngine: engine });
            updateEngineCards(engine);

            const customSec = document.getElementById('customEngineSection');
            if (customSec) customSec.style.display = engine === 'custom' ? 'block' : 'none';

            showToast(`✅ Engine: ${card.querySelector('.engine-name').textContent}`);
            loadSearchTab();
        });
    });

    // Custom engine save
    const btnCustom = document.getElementById('btnSaveCustomEngine');
    if (btnCustom) {
        btnCustom.addEventListener('click', async () => {
            const url = document.getElementById('customEngineURL')?.value.trim();
            if (!url || !url.includes('{query}')) {
                showToast('❌ URL must contain {query}');
                return;
            }
            await sendMessage('SET_CUSTOM_SEARCH_URL', { customSearchURL: url });
            showToast('✅ Custom engine saved');
        });
    }
}

// ─────────────────────────────────────────────
// FILTER LISTS
// ─────────────────────────────────────────────

async function loadFilterLists() {
    try {
        const { lists } = await sendMessage('GET_FILTER_LISTS');
        renderExternalLists(lists || []);
    } catch (err) {
        console.error('[Dashboard] Filter lists:', err);
    }
}

function renderExternalLists(lists) {
    const c = document.getElementById('externalListsContainer');
    if (!c) return;

    if (!lists.length) {
        c.innerHTML = '<div class="empty-state">No external lists added yet.</div>';
        return;
    }

    c.innerHTML = '';
    for (const list of lists) {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML = `
      <div class="list-item-info">
        <span class="list-name">📋 ${escHtml(list.name)}</span>
        <span class="list-meta">${formatCount(list.lines)} rules</span>
      </div>
      <div class="list-actions">
        <span class="badge badge-blue">Cached</span>
        <button class="btn btn-sm btn-primary" data-update="${escHtml(list.name)}">↻</button>
        <button class="btn btn-sm btn-danger"  data-remove="${escHtml(list.name)}">✕</button>
      </div>`;
        c.appendChild(item);
    }

    c.querySelectorAll('[data-update]').forEach(btn => {
        btn.addEventListener('click', () => updateFilterList(btn.dataset.update));
    });
    c.querySelectorAll('[data-remove]').forEach(btn => {
        btn.addEventListener('click', () => removeFilterList(btn.dataset.remove));
    });
}

async function updateFilterList(name) {
    const stored = await chrome.storage.local.get('filterListUrls');
    const url = (stored.filterListUrls || {})[name];
    if (!url) { showToast('❌ No URL found. Re-add the list.'); return; }

    showToast(`⏳ Updating ${name}...`);
    try {
        const r = await sendMessage('UPDATE_FILTER_LIST', { name, url });
        showToast(r.ok ? `✅ ${name}: ${formatCount(r.lines)} rules` : `❌ ${r.error}`);
        if (r.ok) loadFilterLists();
    } catch (err) {
        showToast('❌ ' + err.message);
    }
}

async function removeFilterList(name) {
    if (!confirm(`Remove "${name}"?`)) return;
    try {
        await sendMessage('REMOVE_FILTER_LIST', { name });
        showToast(`✅ ${name} removed`);
        loadFilterLists();
    } catch (err) {
        showToast('❌ ' + err.message);
    }
}

function bindFilterActions() {
    document.querySelectorAll('.predefined-add').forEach(btn => {
        btn.addEventListener('click', async () => {
            const item = btn.closest('.predefined-item');
            const name = item.dataset.name;
            const url = item.dataset.url;

            btn.disabled = true; btn.textContent = '⏳';
            try {
                const stored = await chrome.storage.local.get('filterListUrls');
                const urls = stored.filterListUrls || {};
                urls[name] = url;
                await chrome.storage.local.set({ filterListUrls: urls });

                const r = await sendMessage('UPDATE_FILTER_LIST', { name, url });
                if (r.ok) { showToast(`✅ ${name}: ${formatCount(r.lines)} rules`); btn.textContent = '✅'; loadFilterLists(); }
                else { showToast(`❌ ${r.error}`); btn.textContent = '+ Add'; }
            } catch (err) {
                showToast('❌ ' + err.message); btn.textContent = '+ Add';
            }
            setTimeout(() => { btn.disabled = false; btn.textContent = '+ Add'; }, 3000);
        });
    });

    const btnAdd = document.getElementById('btnAddCustomList');
    if (btnAdd) {
        btnAdd.addEventListener('click', async () => {
            const name = document.getElementById('customListName')?.value.trim();
            const url = document.getElementById('customListUrl')?.value.trim();
            if (!name) { showToast('❌ Enter a name'); return; }
            if (!url || !url.startsWith('https://')) { showToast('❌ HTTPS URL required'); return; }

            btnAdd.disabled = true; btnAdd.textContent = '⏳';
            try {
                const stored = await chrome.storage.local.get('filterListUrls');
                const urls = stored.filterListUrls || {};
                urls[name] = url;
                await chrome.storage.local.set({ filterListUrls: urls });

                const r = await sendMessage('UPDATE_FILTER_LIST', { name, url });
                if (r.ok) {
                    showToast(`✅ Added: ${formatCount(r.lines)} rules`);
                    document.getElementById('customListName').value = '';
                    document.getElementById('customListUrl').value = '';
                    loadFilterLists();
                } else {
                    showToast('❌ ' + r.error);
                }
            } catch (err) {
                showToast('❌ ' + err.message);
            }
            btnAdd.disabled = false; btnAdd.textContent = '+ Add';
        });
    }
}

// ─────────────────────────────────────────────
// CUSTOM RULES
// ─────────────────────────────────────────────

async function loadCustomRules() {
    const { customRules } = await sendMessage('GET_FILTER_LISTS');
    const editor = document.getElementById('customRulesEditor');
    if (editor) { editor.value = customRules || ''; updateRuleCount(editor.value); }
}

function bindCustomRules() {
    const editor = document.getElementById('customRulesEditor');
    const btnSave = document.getElementById('btnSaveRules');
    const btnClear = document.getElementById('btnClearRules');

    editor?.addEventListener('input', () => updateRuleCount(editor.value));

    btnSave?.addEventListener('click', async () => {
        btnSave.disabled = true; btnSave.textContent = '⏳';
        try {
            await sendMessage('SAVE_CUSTOM_RULES', { rules: editor?.value || '' });
            showToast('✅ Rules saved & applied');
        } catch (err) { showToast('❌ ' + err.message); }
        btnSave.disabled = false; btnSave.textContent = '💾 Save & Apply';
    });

    btnClear?.addEventListener('click', () => {
        if (!editor?.value || confirm('Clear all rules?')) {
            if (editor) { editor.value = ''; updateRuleCount(''); }
        }
    });
}

function updateRuleCount(text) {
    const n = text.split('\n').filter(l => {
        const t = l.trim();
        return t && !t.startsWith('!') && !t.startsWith('#');
    }).length;
    setText('ruleLineCount', `${n} rule${n !== 1 ? 's' : ''}`);
}

// ─────────────────────────────────────────────
// SITE MANAGER
// ─────────────────────────────────────────────

async function loadSiteManager(filter = '') {
    const stored = await chrome.storage.local.get('siteSettings');
    const sites = stored.siteSettings || {};
    const hosts = Object.keys(sites).filter(h => !filter || h.includes(filter.toLowerCase())).sort();

    const c = document.getElementById('sitesList');
    if (!c) return;

    if (!hosts.length) { c.innerHTML = '<div class="empty-state">No site settings configured.</div>'; return; }

    c.innerHTML = '';
    for (const host of hosts) {
        const cfg = sites[host];
        const tags = [];
        if (cfg.whitelisted) tags.push('<span class="badge badge-green">Allowlisted</span>');
        if (cfg.enabled === false) tags.push('<span class="badge" style="background:rgba(210,153,34,.15);color:#d29922;border:1px solid rgba(210,153,34,.3)">Paused</span>');
        if (cfg.blockScripts) tags.push('<span class="badge badge-blue">No Scripts</span>');
        if (cfg.strictMode) tags.push('<span class="badge badge-blue">Strict</span>');

        const item = document.createElement('div');
        item.className = 'site-item';
        item.innerHTML = `
      <div>
        <div class="site-item-host">${escHtml(host)}</div>
        <div class="site-item-tags">${tags.join('') || '<span style="color:var(--text-muted);font-size:11px">Default</span>'}</div>
      </div>
      <div class="site-item-actions">
        <button class="btn btn-sm btn-danger" data-remove-site="${escHtml(host)}">🗑</button>
      </div>`;
        c.appendChild(item);
    }

    c.querySelectorAll('[data-remove-site]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const host = btn.dataset.removeSite;
            if (!confirm(`Remove settings for ${host}?`)) return;
            const s = await chrome.storage.local.get('siteSettings');
            const ss = s.siteSettings || {};
            delete ss[host];
            await chrome.storage.local.set({ siteSettings: ss });
            await sendMessage('SET_SITE_WHITELIST', { host, whitelisted: false });
            showToast('✅ Removed');
            loadSiteManager();
        });
    });
}

function bindSiteManager() {
    const search = document.getElementById('siteSearchInput');
    const refresh = document.getElementById('btnRefreshSites');
    let timer = null;

    search?.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => loadSiteManager(search.value), 200);
    });
    refresh?.addEventListener('click', () => loadSiteManager());
}

// ─────────────────────────────────────────────
// LOGS
// ─────────────────────────────────────────────

async function loadLogs() {
    const typeFilter = document.getElementById('logTypeFilter')?.value || '';
    const searchFilter = document.getElementById('logSearchInput')?.value.toLowerCase() || '';

    try {
        const { logs, blockCount, redirectCount } = await sendMessage('GET_LOGS');
        let filtered = logs || [];

        if (typeFilter) filtered = filtered.filter(l => l.type === typeFilter);
        if (searchFilter) filtered = filtered.filter(l =>
            (l.url || '').toLowerCase().includes(searchFilter) ||
            (l.from || '').toLowerCase().includes(searchFilter)
        );

        setText('logTotalCount', formatCount(blockCount || 0));
        setText('logRedirectCount', formatCount(redirectCount || 0));
        setText('logShownCount', String(filtered.length));

        renderLogs(filtered);
    } catch (err) {
        console.error('[Dashboard] Logs error:', err);
    }
}

function renderLogs(logs) {
    const c = document.getElementById('logsContainer');
    if (!c) return;

    if (!logs.length) { c.innerHTML = '<div class="empty-state">No blocked requests logged.</div>'; return; }

    c.innerHTML = '';
    for (const entry of logs) {
        const isRedirect = entry.type === 'search-redirect';
        const type = (entry.type || 'other').toLowerCase();
        const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
        const displayUrl = isRedirect
            ? (entry.from || entry.url || '')
            : (entry.url || '');
        const shortUrl = truncateUrl(displayUrl, 70);

        const div = document.createElement('div');
        div.className = 'log-entry';
        div.innerHTML = `
      <span class="log-type-badge ${type}">${escHtml(isRedirect ? 'search' : type)}</span>
      <div class="log-details">
        <span class="log-url" title="${escHtml(displayUrl)}">${escHtml(shortUrl)}</span>
        <div class="log-meta">
          <span class="log-reason ${isRedirect ? 'redirect' : ''}">${escHtml(
            isRedirect
                ? `→ ${entry.engine || ''} → ${truncateUrl(entry.to || '', 40)}`
                : (entry.reason || 'blocked')
        )}</span>
          <span class="log-time">${escHtml(time)}</span>
        </div>
      </div>`;
        c.appendChild(div);
    }
}

function bindLogs() {
    document.getElementById('logTypeFilter')?.addEventListener('change', loadLogs);
    let timer = null;
    document.getElementById('logSearchInput')?.addEventListener('input', () => {
        clearTimeout(timer); timer = setTimeout(loadLogs, 300);
    });
    document.getElementById('btnRefreshLogs')?.addEventListener('click', loadLogs);
    document.getElementById('btnClearLogs')?.addEventListener('click', async () => {
        if (!confirm('Clear all logs?')) return;
        await sendMessage('CLEAR_LOGS');
        showToast('✅ Logs cleared');
        loadLogs();
    });
}

// ─────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────

let toastTimer = null;
function showToast(msg, dur = 2500) {
    const t = document.getElementById('dashToast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), dur);
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function setText(id, text) { const e = document.getElementById(id); if (e) e.textContent = text; }
function setChecked(id, v) { const e = document.getElementById(id); if (e) e.checked = v; }
function formatCount(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
}
function escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function truncateUrl(url, max) {
    if (!url) return '';
    return url.length <= max ? url : url.slice(0, max) + '…';
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────

async function init() {
    initNavigation();
    bindOverviewToggles();
    bindSearchActions();
    bindFilterActions();
    bindCustomRules();
    bindSiteManager();
    bindLogs();
    await loadOverview();
}

document.addEventListener('DOMContentLoaded', init);