(() => {
    'use strict';

    const PATCH_FLAG = '__rtlFixancerDomainPatchApplied';
    const MISCLASSIFICATION_TIMER_FLAG = '__rtlFixancerPersianUpgradeTimer';
    const MAX_ATTEMPTS = 80;
    const RETRY_DELAY_MS = 100;
    const PERSIAN_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
    const SKIP_SELECTOR = 'script, style, noscript, code, pre, kbd, samp, textarea, input';

    function getCurrentDomain() {
        try {
            return window.location.hostname.toLowerCase();
        } catch (_) {
            return '';
        }
    }

    function domainMatches(enabledSites, hostname) {
        if (!hostname || !Array.isArray(enabledSites)) return false;
        const normalizedHostname = hostname.toLowerCase();

        return enabledSites.some(site => {
            if (typeof site !== 'string') return false;
            const normalizedSite = site.toLowerCase();
            return normalizedHostname === normalizedSite || normalizedHostname.endsWith('.' + normalizedSite);
        });
    }

    function hasPersianText(element) {
        if (!element || element.matches?.(SKIP_SELECTOR) || element.closest?.(SKIP_SELECTOR)) return false;
        return PERSIAN_REGEX.test(element.textContent || '');
    }

    function clearProcessingState(manager, element) {
        try { element.removeAttribute('data-ai-rtl-english-text'); } catch (_) {}
        try { element.removeAttribute('data-ai-rtl-processed'); } catch (_) {}
        try { manager.processedElements?.delete?.(element); } catch (_) {}
        try { manager.stableElements?.delete?.(element); } catch (_) {}
        try {
            const text = typeof manager.getCleanText === 'function' ? manager.getCleanText(element) : element.textContent;
            if (typeof manager.generateElementSignature === 'function') {
                manager.processedTextCache?.delete?.(manager.generateElementSignature(element, text));
            }
            if (typeof manager.getElementSignature === 'function') {
                manager.elementSignatureCache?.delete?.(manager.getElementSignature(element));
            }
        } catch (_) {}
    }

    function applyPersianFallback(manager, element) {
        try { element.setAttribute('data-ai-rtl-persian-text', 'true'); } catch (_) {}
        try { element.setAttribute('dir', 'rtl'); } catch (_) {}
        try { element.style.direction = 'rtl'; } catch (_) {}
        try { element.style.textAlign = 'right'; } catch (_) {}
        try {
            const font = manager.config?.selectedFont || 'vazir';
            if (font === 'vazir') element.style.fontFamily = 'Vazir, Tahoma, Arial, sans-serif';
            else if (font === 'shabnam') element.style.fontFamily = 'Shabnam, Tahoma, Arial, sans-serif';
        } catch (_) {}
    }

    function upgradeMisclassifiedPersian(manager) {
        if (!manager?.config?.isEnabled || !manager.isSiteEnabled?.()) return;

        // Skip during active streaming bursts to avoid flip-flopping state
        if (manager._isStreaming) return;

        const candidates = Array.from(document.querySelectorAll('[data-ai-rtl-english-text]:not([data-ai-rtl-persian-text])'));
        let upgraded = 0;
        for (const element of candidates) {
            if (upgraded >= 100) break;
            if (!hasPersianText(element)) continue;

            clearProcessingState(manager, element);
            try {
                if (typeof manager.processElement === 'function') manager.processElement(element);
                else applyPersianFallback(manager, element);
            } catch (_) {
                applyPersianFallback(manager, element);
            }
            upgraded++;
        }
    }

    function schedulePersianUpgrade(manager) {
        const run = () => {
            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(() => upgradeMisclassifiedPersian(manager), { timeout: 200 });
            } else {
                setTimeout(() => upgradeMisclassifiedPersian(manager), 0);
            }
        };

        run();
        if (!manager[MISCLASSIFICATION_TIMER_FLAG]) {
            manager[MISCLASSIFICATION_TIMER_FLAG] = setInterval(run, 1500);
            // Register for cleanup so content.js cleanup() can clear this timer
            if (!window.__rtlFixancerManagedTimers) window.__rtlFixancerManagedTimers = [];
            window.__rtlFixancerManagedTimers.push(manager[MISCLASSIFICATION_TIMER_FLAG]);
        }
    }

    function patchManager(manager) {
        if (!manager) return false;
        if (!manager[PATCH_FLAG]) {
            manager[PATCH_FLAG] = true;
            manager.domainMatches = domainMatches;
            manager.isSiteEnabled = function isSiteEnabledWithSubdomains() {
                const hostname = this.currentDomain || getCurrentDomain();
                const sites = this.config && Array.isArray(this.config.enabledSites)
                    ? this.config.enabledSites
                    : [];
                return domainMatches(sites, hostname);
            };
        }

        try {
            if (manager.config?.isEnabled && manager.isSiteEnabled() && !manager.hasInitialized) {
                manager.startExtension();
            }
            if (manager.config?.isEnabled && manager.isSiteEnabled()) {
                schedulePersianUpgrade(manager);
            }
        } catch (error) {
            console.warn('RTL Fixancer content patch failed:', error);
        }

        return true;
    }

    function patchWhenReady(attempt = 0) {
        if (patchManager(window.rtlManagerAIStudio)) return;
        if (attempt >= MAX_ATTEMPTS) return;
        setTimeout(() => patchWhenReady(attempt + 1), RETRY_DELAY_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => patchWhenReady(), { once: true });
    }
    patchWhenReady();

    try {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'sync' || !changes.enabledSites) return;
            const manager = window.rtlManagerAIStudio;
            if (!manager) return;
            patchManager(manager);

            if (manager.config) {
                manager.config.enabledSites = changes.enabledSites.newValue || [];
            }

            try {
                const enabled = manager.config?.isEnabled && manager.isSiteEnabled();
                if (enabled && !manager.hasInitialized) {
                    manager.startExtension();
                } else if (!enabled && manager.hasInitialized) {
                    if (manager[MISCLASSIFICATION_TIMER_FLAG]) {
                        clearInterval(manager[MISCLASSIFICATION_TIMER_FLAG]);
                        manager[MISCLASSIFICATION_TIMER_FLAG] = null;
                    }
                    manager.cleanup();
                    manager.hasInitialized = false;
                }
            } catch (error) {
                console.warn('RTL Fixancer domain patch storage handling failed:', error);
            }
        });
    } catch (_) {}
})();
