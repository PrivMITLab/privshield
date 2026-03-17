/**
 * PrivShield – Content Script
 * PrivMITLab
 *
 * Responsibilities:
 *  - Apply cosmetic filtering (hide ad elements via CSS)
 *  - Block inline scripts if configured
 *  - Basic fingerprinting protection
 *  - Observe DOM for dynamically injected ads
 *
 * IMPORTANT: Runs at document_start for maximum effectiveness.
 * No data sent anywhere. All local.
 */

(function PrivShieldContent() {
  'use strict';

  // ─────────────────────────────────────
  // State
  // ─────────────────────────────────────

  const hostname = location.hostname.toLowerCase().replace(/^www\./, '');
  let cosmeticObserver = null;
  let settings = {};

  // ─────────────────────────────────────
  // Initialize
  // ─────────────────────────────────────

  async function init() {
    try {
      // Get settings and cosmetic selectors from background
      const response = await sendMessage({
        action:  'GET_SITE_SETTINGS',
        payload: { host: hostname },
      });

      settings = response.settings || {};

      // If whitelisted or disabled, do nothing
      if (response.isWhitelisted || settings.enabled === false) {
        return;
      }

      // Apply cosmetic filtering
      const cosmeticResp = await sendMessage({
        action:  'GET_COSMETIC_SELECTORS',
        payload: { host: hostname },
      });

      if (cosmeticResp && cosmeticResp.selectors && cosmeticResp.selectors.length > 0) {
        applyCosmeticFilters(cosmeticResp.selectors);
        observeDOMForAds(cosmeticResp.selectors);
      }

      // Fingerprinting protection
      if (settings.blockFingerprint !== false) {
        applyFingerprintProtection();
      }

    } catch (err) {
      // Silent fail — extension may not be ready yet
    }
  }

  // ─────────────────────────────────────
  // COSMETIC FILTERING
  // ─────────────────────────────────────

  /**
   * Inject a <style> tag to hide ad elements.
   * Uses CSS visibility: hidden + height: 0 (safer than display:none for layout).
   */
  function applyCosmeticFilters(selectors) {
    if (!selectors || selectors.length === 0) return;

    // Build CSS rule — group all selectors for performance
    const validSelectors = selectors.filter(s => {
      try {
        document.querySelector(s);
        return true;
      } catch {
        return false; // Skip invalid selectors
      }
    });

    if (validSelectors.length === 0) return;

    const css = validSelectors.join(',\n') + ` {
      display:    none !important;
      visibility: hidden !important;
      height:     0 !important;
      overflow:   hidden !important;
      pointer-events: none !important;
    }`;

    const style = document.createElement('style');
    style.id        = 'privshield-cosmetic';
    style.textContent = css;

    // Insert at document start (before any other styles)
    const target = document.head || document.documentElement;
    if (target) {
      target.insertBefore(style, target.firstChild);
    }
  }

  /**
   * Watch for dynamically inserted ad elements and hide them.
   */
  function observeDOMForAds(selectors) {
    if (!selectors || selectors.length === 0) return;

    // Debounced check to avoid excessive processing
    let checkTimer = null;

    const checkNewElements = () => {
      for (const selector of selectors) {
        try {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            if (!el.dataset.privshieldHidden) {
              el.style.cssText += 'display:none!important;visibility:hidden!important;';
              el.dataset.privshieldHidden = '1';
            }
          }
        } catch {
          // Invalid selector — skip
        }
      }
    };

    cosmeticObserver = new MutationObserver(() => {
      if (checkTimer) clearTimeout(checkTimer);
      checkTimer = setTimeout(checkNewElements, 100);
    });

    cosmeticObserver.observe(document.documentElement, {
      childList: true,
      subtree:   true,
    });
  }

  // ─────────────────────────────────────
  // FINGERPRINTING PROTECTION
  // ─────────────────────────────────────

  /**
   * Override browser APIs commonly used for fingerprinting.
   * All overrides are local and non-tracking.
   */
  function applyFingerprintProtection() {

    // ── Canvas fingerprinting protection
    protectCanvas();

    // ── AudioContext fingerprinting protection
    protectAudioContext();

    // ── WebGL fingerprinting
    protectWebGL();

    // ── Navigator properties
    protectNavigator();

    // ── Screen resolution noise
    protectScreen();
  }

  function protectCanvas() {
    try {
      const originalToDataURL     = HTMLCanvasElement.prototype.toDataURL;
      const originalGetImageData  = CanvasRenderingContext2D.prototype.getImageData;
      const originalToBlob        = HTMLCanvasElement.prototype.toBlob;

      // Add subtle noise to canvas data to defeat fingerprinting
      HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
        addCanvasNoise(this);
        return originalToDataURL.call(this, type, quality);
      };

      HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
        addCanvasNoise(this);
        return originalToBlob.call(this, callback, type, quality);
      };

      CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh) {
        const imageData = originalGetImageData.call(this, sx, sy, sw, sh);
        // Add tiny noise to pixel data
        for (let i = 0; i < imageData.data.length; i += 4) {
          if (Math.random() < 0.01) { // Only modify ~1% of pixels
            imageData.data[i]   = Math.max(0, Math.min(255, imageData.data[i]   + (Math.random() > 0.5 ? 1 : -1)));
            imageData.data[i+1] = Math.max(0, Math.min(255, imageData.data[i+1] + (Math.random() > 0.5 ? 1 : -1)));
            imageData.data[i+2] = Math.max(0, Math.min(255, imageData.data[i+2] + (Math.random() > 0.5 ? 1 : -1)));
          }
        }
        return imageData;
      };
    } catch (err) {
      // Some pages restrict canvas access
    }
  }

  function addCanvasNoise(canvas) {
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Draw a nearly invisible random pixel
      const x = Math.floor(Math.random() * Math.max(canvas.width, 1));
      const y = Math.floor(Math.random() * Math.max(canvas.height, 1));

      const prevFill = ctx.fillStyle;
      ctx.fillStyle  = `rgba(${Math.floor(Math.random()*255)},${Math.floor(Math.random()*255)},${Math.floor(Math.random()*255)},0.004)`;
      ctx.fillRect(x, y, 1, 1);
      ctx.fillStyle  = prevFill;
    } catch {}
  }

  function protectAudioContext() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const origGetChannelData = AudioBuffer.prototype.getChannelData;
      AudioBuffer.prototype.getChannelData = function(channel) {
        const data = origGetChannelData.call(this, channel);
        // Add tiny noise to audio fingerprint
        for (let i = 0; i < data.length; i += 1000) {
          data[i] = data[i] + Math.random() * 0.0000001;
        }
        return data;
      };
    } catch {}
  }

  function protectWebGL() {
    try {
      const getParam = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        // Spoof RENDERER and VENDOR to generic values
        if (parameter === 37446) return 'WebKit WebGL'; // UNMASKED_RENDERER_WEBGL
        if (parameter === 37445) return 'WebKit';       // UNMASKED_VENDOR_WEBGL
        return getParam.call(this, parameter);
      };
    } catch {}
  }

  function protectNavigator() {
    try {
      // Override hardware concurrency (CPU core count — used for fingerprinting)
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => 4, // Generic value
        configurable: true,
      });

      // Override device memory
      if ('deviceMemory' in navigator) {
        Object.defineProperty(navigator, 'deviceMemory', {
          get: () => 8, // Generic 8GB
          configurable: true,
        });
      }

      // Override language to reduce entropy
      // (Don't override fully — would break sites)

    } catch {}
  }

  function protectScreen() {
    try {
      // Don't expose exact screen dimensions — round to nearest 100
      const origWidth  = screen.width;
      const origHeight = screen.height;

      Object.defineProperty(screen, 'width', {
        get: () => Math.round(origWidth / 100) * 100,
        configurable: true,
      });
      Object.defineProperty(screen, 'height', {
        get: () => Math.round(origHeight / 100) * 100,
        configurable: true,
      });
    } catch {}
  }

  // ─────────────────────────────────────
  // MESSAGING
  // ─────────────────────────────────────

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response || {});
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // ─────────────────────────────────────
  // Listen for messages from background/popup
  // ─────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'REAPPLY_COSMETIC') {
      if (cosmeticObserver) {
        cosmeticObserver.disconnect();
        cosmeticObserver = null;
      }
      const style = document.getElementById('privshield-cosmetic');
      if (style) style.remove();

      if (message.selectors) {
        applyCosmeticFilters(message.selectors);
        observeDOMForAds(message.selectors);
      }
      sendResponse({ ok: true });
    }

    if (message.action === 'GET_PAGE_INFO') {
      sendResponse({
        hostname,
        url:   location.href,
        title: document.title,
      });
    }

    return true;
  });

  // ─────────────────────────────────────
  // BOOT
  // ─────────────────────────────────────

  // Handle message for cosmetic selectors in background
  // (background.js needs to respond to GET_COSMETIC_SELECTORS)
  init();

})();