(() => {
    'use strict';

    const TIMER_KEY = '__rtlFixancerGenericUpgradeTimer';
    const RTL_RE = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFB4F\uFB50-\uFDFF\uFE70-\uFEFF]/;
    const TEXT_SELECTOR = 'p, li, td, th, blockquote, h1, h2, h3, h4, h5, h6, span, cite, q, em, strong, b, i, u, mark, small, time, dd, dt';
    const SKIP_SELECTOR = [
        'script', 'style', 'noscript', 'code', 'pre', 'kbd', 'samp', 'textarea', 'input',
        'button', 'select', 'option', 'nav', 'header', 'footer', 'aside', 'menu', 'form',
        '[role="navigation"]', '[role="banner"]', '[role="toolbar"]', '[role="button"]',
        '[data-testid*="sidebar" i]', '[data-testid*="nav" i]', '[aria-label*="sidebar" i]',
        '[class*="sidebar" i]', '[class*="navbar" i]', '[class*="topbar" i]', '[class*="header" i]'
    ].join(', ');

    function isEnabled(manager) {
        try {
            return !!(manager?.config?.isEnabled && manager.isSiteEnabled?.());
        } catch (_) {
            return false;
        }
    }

    function directText(element) {
        try {
            return Array.from(element.childNodes)
                .filter(node => node.nodeType === Node.TEXT_NODE)
                .map(node => node.textContent || '')
                .join(' ')
                .trim();
        } catch (_) {
            return '';
        }
    }

    function isStructuralContainer(element) {
        if (!element || element.matches?.(SKIP_SELECTOR) || element.closest?.(SKIP_SELECTOR)) return true;
        const tag = element.tagName?.toLowerCase();
        if (tag === 'div' || tag === 'section' || tag === 'article' || tag === 'main') return true;
        if ((element.children?.length || 0) > 3) return true;
        return false;
    }

    function hasDirectRtlText(element) {
        if (isStructuralContainer(element)) return false;
        const text = directText(element);
        if (!text) return false;
        const common = window.RTLFixancerCommon;
        return common?.hasRtlText ? common.hasRtlText(text) : RTL_RE.test(text);
    }

    function clearOldState(manager, element) {
        try { element.removeAttribute('data-ai-rtl-english-text'); } catch (_) {}
        try { element.removeAttribute('data-ai-rtl-persian-text'); } catch (_) {}
        try { element.removeAttribute('data-ai-rtl-processed'); } catch (_) {}
        try { manager.processedElements?.delete?.(element); } catch (_) {}
        try { manager.stableElements?.delete?.(element); } catch (_) {}
        try {
            const text = typeof manager?.getCleanText === 'function' ? manager.getCleanText(element) : (element.textContent || '').trim();
            if (typeof manager?.generateElementSignature === 'function') {
                manager.processedTextCache?.delete?.(manager.generateElementSignature(element, text));
            }
            if (typeof manager?.getElementSignature === 'function') {
                manager.elementSignatureCache?.delete?.(manager.getElementSignature(element));
            }
        } catch (_) {}
    }

    function clearWrongUpgrade(manager, element) {
        clearOldState(manager, element);
        try { element.removeAttribute('data-rtl-fixancer-rtl-text'); } catch (_) {}
        try { element.removeAttribute('data-rtl-fixancer-language'); } catch (_) {}
        try { element.removeAttribute('dir'); } catch (_) {}
        try { element.style.removeProperty('direction'); } catch (_) {}
        try { element.style.removeProperty('text-align'); } catch (_) {}
        try { element.style.removeProperty('unicode-bidi'); } catch (_) {}
        try { element.style.removeProperty('font-family'); } catch (_) {}
    }

    function cleanupStructuralMistakes(manager) {
        const upgraded = Array.from(document.querySelectorAll('[data-rtl-fixancer-rtl-text], [data-ai-rtl-persian-text]'));
        for (const element of upgraded) {
            if (isStructuralContainer(element) || !hasDirectRtlText(element)) clearWrongUpgrade(manager, element);
        }
    }

    function applyTypography(element) {
        const common = window.RTLFixancerCommon;
        if (common?.applyRtlTypography?.(element, { text: directText(element) })) return true;
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
        cleanupStructuralMistakes(manager);

        const selector = [
            '[data-ai-rtl-english-text]:not([data-rtl-fixancer-rtl-text])',
            `${TEXT_SELECTOR}:not([data-ai-rtl-persian-text]):not([data-rtl-fixancer-rtl-text])`
        ].join(', ');

        const candidates = Array.from(document.querySelectorAll(selector));
        let upgraded = 0;
        for (const element of candidates) {
            if (upgraded >= 150) break;
            if (!hasDirectRtlText(element)) continue;
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
