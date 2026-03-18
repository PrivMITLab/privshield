# 🛡 PrivShield – Open-Source Privacy Guardian

**by PrivMITLab** | *Block Everything. Trust Nothing. Control Everything.*

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-1.0.0-blue.svg)]()
[![Privacy: Zero Data Collection](https://img.shields.io/badge/Privacy-Zero%20Data%20Collection-brightgreen.svg)]()

---

## What is PrivShield?

PrivShield is a **100% free, open-source** browser extension that provides:

- 🚫 **Ad Blocking** — Block ads from known ad networks
- 🔍 **Tracker Blocking** — Prevent analytics and tracking scripts
- 📜 **Script Control** — Toggle JavaScript per-site or globally
- 🧬 **Fingerprinting Protection** — Canvas, WebGL, audio noise injection
- 🔗 **Referrer Stripping** — Remove cross-site referrer headers
- 🕵 **User-Agent Spoofing** — Use a generic browser identifier
- 🌐 **Strict Mode** — Block all third-party requests
- 💄 **Cosmetic Filtering** — Hide ad elements via CSS injection
- 📋 **Request Logging** — View blocked requests (stored locally only)
- ⚙ **Custom Rules** — Write your own filter rules

---

## Privacy Guarantee

| Guarantee | Status |
|-----------|--------|
| No data collection | ✅ |
| No telemetry | ✅ |
| No analytics | ✅ |
| No external servers | ✅ |
| 100% local processing | ✅ |
| No auto-updates calling home | ✅ |
| Open source / auditable | ✅ |

**Every request is processed locally. Nothing ever leaves your browser.**

---

## Installation

### Load as Unpacked Extension (Developer Mode)

**Chrome / Brave / Edge:**
1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `/privshield` folder
5. PrivShield is now active 🛡

**Firefox:**
1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `manifest.json` inside `/privshield`

---

## How Filtering Works

```
Browser makes a request (URL, type, etc.)
         ↓
PrivShield Background Service Worker intercepts
         ↓
Filter Engine checks:
  1. Is this site whitelisted? → ALLOW
  2. Does an allow rule (@@) match? → ALLOW
  3. Is it in the tracker domain set? → BLOCK
  4. Does a block rule match? → BLOCK
  5. Does strict mode block it? → BLOCK
  6. Otherwise → ALLOW
         ↓
Decision executed (cancel request or pass through)
         ↓
Log entry created (stored locally)
Badge count updated
```

The filter engine supports:
- **Domain anchors**: `||example.com^`
- **Allow rules**: `@@||example.com^`
- **Regex rules**: `/adserver\..*\/ad/`
- **Type options**: `$script`, `$image`, `$xmlhttprequest`
- **Third-party options**: `$third-party`, `$first-party`
- **Domain options**: `$domain=example.com`
- **Element hiding**: `##.ad-banner`, `example.com##.sidebar`

---

## Filter Rule Format

```
! Comment line (ignored)
# Also a comment

! Block a domain:
||example.com^

! Block a specific path:
||example.com/ads/banner^

! Allow (whitelist) a domain:
@@||safe-cdn.com^

! Block only scripts from domain:
||tracker.com^$script

! Block only third-party requests:
||analytics.com^$third-party

! Block scripts from a specific domain only:
||tracker.com^$script,domain=shoppingsite.com

! Regex rule:
/\/ads?\/[0-9]+\//

! Element hiding (hides .ad-banner everywhere):
##.ad-banner

! Element hiding (hides .ads only on example.com):
example.com##.ads

! Element hiding (multiple domains):
example.com,another.com##.ads
```

---

## Adding Custom Filter Lists

1. Open the **Dashboard** (⚙ button in popup)
2. Navigate to **Filter Lists**
3. Click **Add** on a predefined list (EasyList, EasyPrivacy, etc.) or enter a custom HTTPS URL
4. PrivShield downloads and caches the list locally
5. Click **Update** on any list to refresh it (manual — no auto-updates)

### Supported Lists

| List | URL |
|------|-----|
| EasyList | `https://easylist.to/easylist/easylist.txt` |
| EasyPrivacy | `https://easylist.to/easylist/easyprivacy.txt` |
| uBlock Filters | `https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt` |
| uBlock Privacy | `https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt` |
| Peter Lowe's List | `https://pgl.yoyo.org/adservers/...` |

---

## Writing Custom Rules

1. Open Dashboard → **Custom Rules**
2. Write rules in the editor (one per line)
3. Click **Save & Apply**

Rules are immediately compiled into the filter engine.

---

## Per-Site Controls

Via the **Popup**:
- Toggle protection on/off for the current site
- Block/allow scripts for the current site
- Enable strict mode for the current site
- Add to allowlist (bypass all blocking)

Via the **Dashboard → Site Manager**:
- View all configured sites
- Remove site-specific settings
- Search sites

---

## Permissions Explained

| Permission | Why It's Needed |
|------------|-----------------|
| `webRequest` | Intercept HTTP/HTTPS requests to block ads/trackers |
| `declarativeNetRequest` | Efficient rule-based blocking |
| `storage` | Save settings, logs, and filter lists **locally** |
| `tabs` | Know which tab made a request (for badge counts) |
| `activeTab` | Access current tab URL in the popup |
| `scripting` | Inject cosmetic CSS to hide ad elements |

**No** `identity`, **no** `cookies`, **no** `history`, **no** `bookmarks`.

---

## Architecture

```
/privshield
├── manifest.json          ← Extension manifest (MV3)
├── background.js          ← Service worker: request interception, filter engine
├── content.js             ← Content script: cosmetic filtering, fingerprint protection
├── popup/
│   ├── popup.html         ← Popup interface
│   ├── popup.css          ← Popup styles (dark theme)
│   └── popup.js           ← Popup logic
├── dashboard/
│   ├── dashboard.html     ← Full dashboard interface
│   ├── dashboard.css      ← Dashboard styles
│   └── dashboard.js       ← Dashboard logic
├── filters/
│   └── default_filters.txt ← Bundled filter rules
├── utils/
│   └── parser.js          ← Filter engine & rule parser
└── README.md
```

---

## Performance

- Rules compiled once on startup into optimized data structures
- Domain-based fast-path for tracker blocking (O(1) Set lookup)
- Regex patterns cached after first compilation
- Log capped at 500 entries (rolling)
- Badge updates debounced per-tab
- Settings saves debounced (2 second delay)

---

## Security

- **No eval()** — All rule matching via precompiled functions
- **No innerHTML with user data** — All user-facing strings escaped
- **HTTPS-only** for external filter list downloads
- **Content Security Policy** enforced in manifest
- **No remote code execution** — All code is bundled locally

---

## License

MIT License — Free to use, modify, and distribute.

PrivMITLab | https://github.com/privmitlab/privshield

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Submit a pull request

Please maintain the zero-telemetry, zero-tracking principles.

---

## Changelog

### v1.0.0
- Initial release
- Ad blocking engine
- Tracker blocking
- Script control (per-site and global)
- Fingerprinting protection (canvas, WebGL, audio, navigator)
- Referrer stripping
- User-Agent spoofing
- Cosmetic filtering (element hiding)
- Per-site allowlist/blocklist
- Strict mode (block all third-party)
- Request logging (local only)
- Full popup UI
- Full dashboard UI
- Custom rule editor
- External filter list manager
- Dark theme UI

---

*PrivMITLab – Block Everything. Trust Nothing. Control Everything.*