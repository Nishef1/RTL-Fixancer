(() => {
    'use strict';

    const TIMER_KEY = '__rtlFixancerGenericUpgradeTimer';
    const RTL_RE = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFB4F\uFB50-\uFDFF\uFE70-\uFEFF]/;
    const TEXT_SELECTOR = 'p, span, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, div, a, button, label, summary, details, cite, q, em, strong, b, i, u, mark, small, time, dd, dt';
    const SKIP_SELECTOR = 'script, style, noscript, code, pre, kbd, samp, textarea, input';

    function isEnabled(manager) {
        try {
            return !!(manager?.config?.isEnabled && manager.isSiteEnabled?.());
        } catch (_) {
            return false;
        }
    }

    function hasRtlText(element) {
        if (!element || element.matches?.(SKIP_SELECTOR) || element.closest?.(SKIP_SELECTOR)) return false;
        const text = element.textContent || '';
        const common = window.RTLFixancerCommon;
        return common?.hasRtlText ? common.hasRtlText(text) : RTL_RE.test(text);
    }

    function clearOldState(manager, element) {
        try { element.removeAttribute('data-ai-rtl-english-text'); } catch (_) {}
        try { element.removeAttribute('data-ai-rtl-processed'); } catch (_) {}
        try { manager.processedElements?.delete?.(element); } catch (_) {}
        try { manager.stableElements?.delete?.(element); } catch (_) {}
    }

    function applyTypography(element) {
        const common = window.RTLFixancerCommon;
        if (common?.applyRtlTypography?.(element)) return true;
        try { element.setAttribute('dir', 'rtl'); } catch (_) {}
        try { element.setAttribute('data-rtl-fixancer-rtl-text', 'true'); } catch (_) {}
        try { element.style.direction = 'rtl'; } catch (_) {}
        try { element.style.textAlign = 'right'; } catch (_) {}
        try { element.style.unicodeBidi = 'plaintext'; } catch (_) {}
        try { element.style.fontFamily = 'Segoe UI, Tahoma, Arial, sans-serif'; } catch (_) {}
        return true;
    }

    function run(manager) {
        if (!isEnabled(manager)) return;
        const selector = [
            '[data-ai-rtl-english-text]:not([data-rtl-fixancer-rtl-text])',
            `${TEXT_SELECTOR}:not([data-ai-rtl-persian-text]):not([data-rtl-fixancer-rtl-text])`
        ].join(', ');
        const candidates = Array.from(document.querySelectorAll(selector));
        let upgraded = 0;
        for (const element of candidates) {
            if (upgraded >= 150) break;
            if (!hasRtlText(element)) continue;
            clearOldState(manager, element);
            applyTypography(element);
            upgraded++;
        }
    }

    function start(manager) {
        if (!manager || manager[TIMER_KEY]) return;
        const tick = () => {
            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(() => run(manager), { timeout: 200 });
            } else {
                setTimeout(() => run(manager), 0);
            }
        };
        manager[TIMER_KEY] = setInterval(tick, 1500);
        tick();
    }

    function wait(attempt = 0) {
        const manager = window.rtlManagerAIStudio;
        if (manager) {
            start(manager);
            return;
        }
        if (attempt < 80) setTimeout(() => wait(attempt + 1), 100);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => wait(), { once: true });
    wait();
})();
