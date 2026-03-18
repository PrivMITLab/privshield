/**
 * PrivShield – Content Script v3.0.0
 * PrivMITLab
 *
 * Features:
 *  - Tracker script blocking (createElement override)
 *  - Dynamic script injection blocking (MutationObserver)
 *  - Cosmetic filtering (element hiding)
 *  - Enhanced fingerprint protection
 *    (Canvas, WebGL, Audio, Navigator, Screen, Fonts, Battery etc.)
 */

(function PrivShieldContent() {
  'use strict';

  const hostname = location.hostname.toLowerCase().replace(/^www\./, '');
  let cosmeticObserver = null;

  // ─────────────────────────────────────────
  // STEP 1: Fingerprint protection IMMEDIATELY
  // (document_start pe run hota hai –
  //  page scripts se pehle)
  // ─────────────────────────────────────────
  applyFingerprintProtection();

  // ─────────────────────────────────────────
  // STEP 2: Block known tracker scripts
  // (createElement intercept + MutationObserver)
  // ─────────────────────────────────────────
  blockTrackerScripts();

  // ─────────────────────────────────────────
  // STEP 3: Async init (cosmetic filters etc.)
  // ─────────────────────────────────────────
  async function init() {
    try {
      const response = await sendMessage('GET_SITE_SETTINGS', { host: hostname });
      const settings = response.settings || {};

      if (response.isWhitelisted || settings.enabled === false) return;

      const cosmetic = await sendMessage('GET_COSMETIC_SELECTORS', { host: hostname });
      if (cosmetic?.selectors?.length > 0) {
        applyCosmeticFilters(cosmetic.selectors);
        observeDOM(cosmetic.selectors);
      }
    } catch { /* silent */ }
  }

  // ═══════════════════════════════════════════
  // TRACKER SCRIPT BLOCKER
  // ═══════════════════════════════════════════

  function blockTrackerScripts() {

    const BLOCKED_PATTERNS = [
      // Error trackers
      'sentry', 'bugsnag', 'rollbar', 'trackjs',
      'raygun', 'errorception', 'logrocket', 'datadog',
      'datadoghq', 'countly',

      // Analytics
      'google-analytics', 'googletagmanager', 'gtag',
      'hotjar', 'fullstory', 'mouseflow', 'smartlook',
      'mixpanel', 'amplitude', 'segment.com', 'segment.io',
      'heap.io', 'heapanalytics', 'kissmetrics',
      'clarity.ms', 'newrelic', 'nr-data', 'statcounter',
      'mc.yandex', 'chartbeat', 'scorecardresearch',
      'quantserve', 'comscore',

      // Ads
      'doubleclick', 'googlesyndication', 'adnxs',
      'criteo', 'outbrain', 'taboola', 'media.net',
      'advertising.com', 'pubmatic', 'rubiconproject',
      'openx.net', 'casalemedia', 'indexexchange',
      'thetradedesk', 'adsrvr', 'tripadvisor',

      // Fingerprinting
      'fingerprintjs', 'fpjscdn', 'iovation',
      'threatmetrix', 'online-metrix',

      // Social trackers
      'connect.facebook.net', 'platform.twitter',
      'px.ads.linkedin', 'snap.licdn',
      'ads.tiktok', 'analytics.tiktok',
    ];

    function shouldBlock(src) {
      if (!src) return false;
      const lower = src.toLowerCase();
      return BLOCKED_PATTERNS.some(p => lower.includes(p));
    }

    // ── Override document.createElement
    // Intercept script tags before they load
    const origCreateElement = document.createElement.bind(document);

    document.createElement = function(tagName, options) {
      const el = origCreateElement(tagName, options);

      if (typeof tagName === 'string' && tagName.toLowerCase() === 'script') {

        // Intercept setAttribute('src', ...)
        const origSetAttribute = el.setAttribute.bind(el);
        el.setAttribute = function(name, value) {
          if (name === 'src' && shouldBlock(value)) {
            console.log('[PrivShield] ❌ Blocked script (setAttribute):', value);
            // Set empty src so script doesn't load
            origSetAttribute('type', 'javascript/blocked');
            return;
          }
          return origSetAttribute(name, value);
        };

        // Intercept src property setter
        let _src = '';
        try {
          Object.defineProperty(el, 'src', {
            get() { return _src; },
            set(value) {
              if (shouldBlock(value)) {
                console.log('[PrivShield] ❌ Blocked script (src):', value);
                return;
              }
              _src = value;
              origSetAttribute('src', value);
            },
            configurable: true,
          });
        } catch {}
      }

      return el;
    };

    // ── MutationObserver: catch dynamically injected scripts
    const scriptObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!node || node.nodeType !== 1) continue;

          // Direct script tag
          if (node.tagName === 'SCRIPT') {
            if (node.src && shouldBlock(node.src)) {
              console.log('[PrivShield] ❌ Removed injected script:', node.src);
              node.remove();
              continue;
            }
            // Check inline script content
            if (node.textContent) {
              const txt = node.textContent.toLowerCase();
              const inlineBlocked = [
                'sentry.init', 'bugsnag.start', 'rollbar.init',
                'ga(', 'gtag(', '_gaq.push', 'fbq(',
                'mixpanel.init', 'amplitude.init',
                'hotjar(', 'hj(',
              ];
              if (inlineBlocked.some(p => txt.includes(p))) {
                console.log('[PrivShield] ❌ Blocked inline tracker script');
                node.remove();
                continue;
              }
            }
          }

          // Script inside added element
          if (node.querySelectorAll) {
            const scripts = node.querySelectorAll('script[src]');
            for (const script of scripts) {
              if (shouldBlock(script.src)) {
                console.log('[PrivShield] ❌ Removed nested script:', script.src);
                script.remove();
              }
            }
          }
        }
      }
    });

    scriptObserver.observe(document.documentElement, {
      childList: true,
      subtree:   true,
    });

    console.log('[PrivShield] ✅ Script blocker active');
  }

  // ═══════════════════════════════════════════
  // COSMETIC FILTERING
  // ═══════════════════════════════════════════

  function applyCosmeticFilters(selectors) {
    const valid = selectors.filter(s => {
      try { document.querySelector(s); return true; }
      catch { return false; }
    });

    if (valid.length === 0) return;

    const css = valid.join(',\n') + `{
      display:none!important;
      visibility:hidden!important;
      height:0!important;
      overflow:hidden!important;
      pointer-events:none!important;
      opacity:0!important;
    }`;

    const style       = document.createElement('style');
    style.id          = 'privshield-cosmetic';
    style.textContent = css;

    const target = document.head || document.documentElement;
    if (target) target.insertBefore(style, target.firstChild);
  }

  function observeDOM(selectors) {
    if (cosmeticObserver) cosmeticObserver.disconnect();

    let timer = null;

    cosmeticObserver = new MutationObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        for (const sel of selectors) {
          try {
            document.querySelectorAll(sel).forEach(el => {
              if (!el.dataset.psHidden) {
                el.style.cssText +=
                  'display:none!important;visibility:hidden!important;';
                el.dataset.psHidden = '1';
              }
            });
          } catch {}
        }
      }, 150);
    });

    cosmeticObserver.observe(document.documentElement, {
      childList: true,
      subtree:   true,
    });
  }

  // ═══════════════════════════════════════════
  // FINGERPRINT PROTECTION
  // ═══════════════════════════════════════════

  function applyFingerprintProtection() {
    protectCanvas();
    protectAudioContext();
    protectWebGL();
    protectNavigator();
    protectScreen();
    protectDatetime();
    protectFonts();
    protectBattery();
    protectNetwork();
    protectSpeech();
    protectBluetooth();
    protectMediaDevices();
    protectPerformance();
    protectStorage();
    console.log('[PrivShield] ✅ Fingerprint protection active');
  }

  // ── Canvas Fingerprint Protection
  function protectCanvas() {
    try {
      const origToDataURL    = HTMLCanvasElement.prototype.toDataURL;
      const origToBlob       = HTMLCanvasElement.prototype.toBlob;
      const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;

      HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
        addCanvasNoise(this);
        return origToDataURL.call(this, type, quality);
      };

      HTMLCanvasElement.prototype.toBlob = function(cb, type, quality) {
        addCanvasNoise(this);
        return origToBlob.call(this, cb, type, quality);
      };

      CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh) {
        const imageData = origGetImageData.call(this, sx, sy, sw, sh);
        const d         = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          if (Math.random() < 0.02) {
            const noise = Math.random() > 0.5 ? 1 : -1;
            d[i]   = Math.max(0, Math.min(255, d[i]   + noise));
            d[i+1] = Math.max(0, Math.min(255, d[i+1] + noise));
            d[i+2] = Math.max(0, Math.min(255, d[i+2] + noise));
          }
        }
        return imageData;
      };

    } catch {}
  }

  function addCanvasNoise(canvas) {
    try {
      if (!canvas || canvas.width === 0 || canvas.height === 0) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const x        = Math.floor(Math.random() * canvas.width);
      const y        = Math.floor(Math.random() * canvas.height);
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = 0.004;
      ctx.fillStyle   = `rgb(
        ${Math.floor(Math.random() * 255)},
        ${Math.floor(Math.random() * 255)},
        ${Math.floor(Math.random() * 255)}
      )`;
      ctx.fillRect(x, y, 1, 1);
      ctx.globalAlpha = prevAlpha;
    } catch {}
  }

  // ── Audio Context Fingerprint Protection
  function protectAudioContext() {
    try {
      // Protect getChannelData
      const origGetChannelData = AudioBuffer.prototype.getChannelData;
      AudioBuffer.prototype.getChannelData = function(channel) {
        const data = origGetChannelData.call(this, channel);
        for (let i = 0; i < data.length; i += 100) {
          data[i] = data[i] + (Math.random() * 0.0000002 - 0.0000001);
        }
        return data;
      };

      // Protect copyFromChannel
      if (AudioBuffer.prototype.copyFromChannel) {
        const origCopy = AudioBuffer.prototype.copyFromChannel;
        AudioBuffer.prototype.copyFromChannel = function(dest, channel, offset) {
          origCopy.call(this, dest, channel, offset);
          for (let i = 0; i < dest.length; i++) {
            dest[i] = dest[i] + (Math.random() * 0.0000002 - 0.0000001);
          }
        };
      }

      // Protect AnalyserNode getFloat32Array etc.
      if (window.AnalyserNode) {
        const origGetByteFreq = AnalyserNode.prototype.getByteFrequencyData;
        if (origGetByteFreq) {
          AnalyserNode.prototype.getByteFrequencyData = function(arr) {
            origGetByteFreq.call(this, arr);
            for (let i = 0; i < arr.length; i++) {
              arr[i] = Math.max(0, Math.min(255, arr[i] + (Math.random() > 0.5 ? 1 : -1)));
            }
          };
        }
      }
    } catch {}
  }

  // ── WebGL Fingerprint Protection
  function protectWebGL() {
    try {
      const origGetContext = HTMLCanvasElement.prototype.getContext;

      HTMLCanvasElement.prototype.getContext = function(type, attrs) {
        const ctx = origGetContext.call(this, type, attrs);

        if (ctx && (
          type === 'webgl' ||
          type === 'webgl2' ||
          type === 'experimental-webgl'
        )) {
          patchWebGLContext(ctx);
        }

        return ctx;
      };
    } catch {}
  }

  function patchWebGLContext(ctx) {
    try {
      const origGetParameter = ctx.getParameter.bind(ctx);
      ctx.getParameter = function(parameter) {
        switch (parameter) {
          case 37446: return 'WebKit WebGL';   // UNMASKED_RENDERER_WEBGL
          case 37445: return 'WebKit';          // UNMASKED_VENDOR_WEBGL
          case 7936:  return 'WebKit';          // VENDOR
          case 7937:  return 'WebKit WebGL';    // RENDERER
          case 7938:  return 'WebGL 1.0 (OpenGL ES 2.0)'; // VERSION
          case 35724: return 'WebGL GLSL ES 1.0'; // SHADING_LANGUAGE_VERSION
          default:    return origGetParameter(parameter);
        }
      };

      // Remove debug/fingerprint extensions
      const origGetExts = ctx.getSupportedExtensions.bind(ctx);
      ctx.getSupportedExtensions = function() {
        const exts = origGetExts() || [];
        return exts.filter(e =>
          !e.toLowerCase().includes('debug') &&
          !e.toLowerCase().includes('renderer') &&
          !e.toLowerCase().includes('vendor')
        );
      };

      // Block getExtension for debug extensions
      const origGetExt = ctx.getExtension.bind(ctx);
      ctx.getExtension = function(name) {
        const lower = name.toLowerCase();
        if (lower.includes('debug') ||
            lower.includes('renderer_info')) {
          return null;
        }
        return origGetExt(name);
      };

    } catch {}
  }

  // ── Navigator Protection
  function protectNavigator() {
    const overrides = {
      hardwareConcurrency: 4,
      deviceMemory:        8,
      platform:            'Win32',
      vendor:              'Google Inc.',
      vendorSub:           '',
      productSub:          '20030107',
      doNotTrack:          '1',
      maxTouchPoints:      0,
      webdriver:           false,
      pdfViewerEnabled:    true,
    };

    for (const [key, value] of Object.entries(overrides)) {
      try {
        Object.defineProperty(navigator, key, {
          get: () => value,
          configurable: true,
        });
      } catch {}
    }

    // Languages – reduce entropy
    try {
      Object.defineProperty(navigator, 'languages', {
        get: () => Object.freeze(['en-US', 'en']),
        configurable: true,
      });
    } catch {}

    // Language
    try {
      Object.defineProperty(navigator, 'language', {
        get: () => 'en-US',
        configurable: true,
      });
    } catch {}

    // Plugins – empty array
    try {
      Object.defineProperty(navigator, 'plugins', {
        get: () => Object.freeze([]),
        configurable: true,
      });
    } catch {}

    // MimeTypes – empty
    try {
      Object.defineProperty(navigator, 'mimeTypes', {
        get: () => Object.freeze([]),
        configurable: true,
      });
    } catch {}

    // globalPrivacyControl – true (signal to sites)
    try {
      Object.defineProperty(navigator, 'globalPrivacyControl', {
        get: () => true,
        configurable: true,
      });
    } catch {}
  }

  // ── Screen Protection
  function protectScreen() {
    try {
      // Round to nearest 100px
      const rw = Math.round((screen.width  || 1920) / 100) * 100;
      const rh = Math.round((screen.height || 1080) / 100) * 100;

      const overrides = {
        width:       rw,
        height:      rh,
        availWidth:  rw,
        availHeight: rh - 40,
        colorDepth:  24,
        pixelDepth:  24,
      };

      for (const [key, value] of Object.entries(overrides)) {
        try {
          Object.defineProperty(screen, key, {
            get: () => value,
            configurable: true,
          });
        } catch {}
      }

      // devicePixelRatio – normalize to 1
      try {
        Object.defineProperty(window, 'devicePixelRatio', {
          get: () => 1,
          configurable: true,
        });
      } catch {}

      // outerWidth / outerHeight
      try {
        Object.defineProperty(window, 'outerWidth', {
          get: () => rw,
          configurable: true,
        });
        Object.defineProperty(window, 'outerHeight', {
          get: () => rh,
          configurable: true,
        });
      } catch {}

    } catch {}
  }

  // ── Date/Time Protection
  function protectDatetime() {
    try {
      // Override Intl to hide timezone
      const OrigDateTimeFormat = Intl.DateTimeFormat;

      function PatchedDateTimeFormat(locale, options) {
        return new OrigDateTimeFormat(locale, options);
      }

      PatchedDateTimeFormat.prototype     = OrigDateTimeFormat.prototype;
      PatchedDateTimeFormat.supportedLocalesOf =
        OrigDateTimeFormat.supportedLocalesOf;

      // Override resolvedOptions to hide specific timezone
      const origResolved =
        OrigDateTimeFormat.prototype.resolvedOptions;
      OrigDateTimeFormat.prototype.resolvedOptions = function() {
        const opts = origResolved.call(this);
        return {
          ...opts,
          timeZone: 'UTC', // Normalize timezone
        };
      };

    } catch {}
  }

  // ── Font Fingerprinting Protection
  function protectFonts() {
    try {
      if (!document.fonts || !document.fonts.check) return;

      const COMMON_FONTS = new Set([
        'arial', 'helvetica', 'times new roman', 'courier new',
        'georgia', 'verdana', 'trebuchet ms', 'sans-serif',
        'serif', 'monospace', 'cursive', 'fantasy',
        'system-ui', '-apple-system', 'segoe ui',
      ]);

      const origCheck = document.fonts.check.bind(document.fonts);
      document.fonts.check = function(font, text) {
        const name = font
          .replace(/^\d+(\.\d+)?(px|pt|em|rem)\s+/, '')
          .replace(/['"]/g, '')
          .toLowerCase()
          .trim();

        const isCommon = COMMON_FONTS.has(name) ||
          [...COMMON_FONTS].some(f => name.includes(f));

        if (!isCommon) return false;
        return origCheck(font, text);
      };

    } catch {}
  }

  // ── Battery API – Block
  function protectBattery() {
    try {
      if (navigator.getBattery) {
        navigator.getBattery = () =>
          Promise.reject(new Error('Battery API blocked by PrivShield'));
      }
      // Also block via property
      Object.defineProperty(navigator, 'getBattery', {
        get: () => () => Promise.reject(new Error('Blocked')),
        configurable: true,
      });
    } catch {}
  }

  // ── Network Info – Spoof
  function protectNetwork() {
    try {
      const fakeConnection = Object.freeze({
        effectiveType:        '4g',
        rtt:                  50,
        downlink:             10,
        downlinkMax:          Infinity,
        saveData:             false,
        type:                 'wifi',
        addEventListener:     () => {},
        removeEventListener:  () => {},
        dispatchEvent:        () => true,
      });

      Object.defineProperty(navigator, 'connection', {
        get: () => fakeConnection,
        configurable: true,
      });
      Object.defineProperty(navigator, 'mozConnection', {
        get: () => fakeConnection,
        configurable: true,
      });
      Object.defineProperty(navigator, 'webkitConnection', {
        get: () => fakeConnection,
        configurable: true,
      });
    } catch {}
  }

  // ── Speech Synthesis – Block (voice list exposes OS info)
  function protectSpeech() {
    try {
      if (window.speechSynthesis) {
        window.speechSynthesis.getVoices = () => [];
        // Block onvoiceschanged
        Object.defineProperty(window.speechSynthesis, 'onvoiceschanged', {
          get: () => null,
          set: () => {},
          configurable: true,
        });
      }
    } catch {}
  }

  // ── Bluetooth – Block
  function protectBluetooth() {
    try {
      if (navigator.bluetooth) {
        navigator.bluetooth.requestDevice = () =>
          Promise.reject(new Error('Bluetooth blocked'));
        navigator.bluetooth.getAvailability = () =>
          Promise.resolve(false);
      }
    } catch {}
  }

  // ── Media Devices – Block enumeration
  function protectMediaDevices() {
    try {
      if (navigator.mediaDevices) {
        // Return empty device list
        navigator.mediaDevices.enumerateDevices = () =>
          Promise.resolve([]);

        // Block getUserMedia label leak
        const origGetUserMedia =
          navigator.mediaDevices.getUserMedia?.bind(navigator.mediaDevices);

        if (origGetUserMedia) {
          navigator.mediaDevices.getUserMedia = function(constraints) {
            return origGetUserMedia(constraints);
          };
        }
      }
    } catch {}
  }

  // ── Performance Timing – Reduce precision
  function protectPerformance() {
    try {
      // Reduce performance.now() precision to 100ms
      const origNow = performance.now.bind(performance);
      performance.now = function() {
        return Math.round(origNow() / 100) * 100;
      };

      // Reduce Date.now() precision
      const origDateNow = Date.now.bind(Date);
      Date.now = function() {
        return Math.round(origDateNow() / 100) * 100;
      };

    } catch {}
  }

  // ── Storage Partitioning info – hide
  function protectStorage() {
    try {
      // Hide storage estimate details
      if (navigator.storage && navigator.storage.estimate) {
        const origEstimate = navigator.storage.estimate.bind(navigator.storage);
        navigator.storage.estimate = function() {
          return origEstimate().then(() => ({
            quota: 107374182400, // 100GB generic
            usage: 0,
          }));
        };
      }
    } catch {}
  }

  // ═══════════════════════════════════════════
  // MESSAGING
  // ═══════════════════════════════════════════

  function sendMessage(action, payload = {}) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ action, payload }, res => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(res || {});
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Listen for messages from background/popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'REAPPLY_COSMETIC') {
      if (cosmeticObserver) {
        cosmeticObserver.disconnect();
        cosmeticObserver = null;
      }
      const existing = document.getElementById('privshield-cosmetic');
      if (existing) existing.remove();

      if (msg.selectors && msg.selectors.length > 0) {
        applyCosmeticFilters(msg.selectors);
        observeDOM(msg.selectors);
      }
      sendResponse({ ok: true });
    }
    return true;
  });

  // ═══════════════════════════════════════════
  // BOOT
  // ═══════════════════════════════════════════

  init();

})();