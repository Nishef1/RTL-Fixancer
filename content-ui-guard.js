(() => {
    'use strict';

    const TIMER_KEY = '__rtlFixancerUiGuardTimer';
    const UI_TEXT_PATTERNS = [
        /^Called tool\b/i,
        /^Calling tool\b/i,
        /^Thought for\b/i,
        /^Thinking\b/i,
        /^Sources\b/i,
        /^Follow up\b/i,
        /^Ask anything\b/i,
        /^Share\b/i,
        /^New chat\b/i,
        /^Library\b/i,
        /^Projects\b/i,
        /^Scheduled\b/i,
        /^Apps\b/i,
        /^More\b/i,
        /^Recents\b/i,
        /^ChatGPT Plus\b/i
    ];

    const UI_SELECTOR = [
        'button',
        '[role="button"]',
        '[role="tab"]',
        '[role="menuitem"]',
        '[aria-label]',
        'summary',
        'nav *',
        'header *',
        'aside *',
        '[data-testid*="sidebar" i] *',
        '[data-testid*="composer" i] *',
        '[data-testid*="tool" i] *',
        '[class*="sidebar" i] *',
        '[class*="composer" i] *',
        '[class*="tool" i] *'
    ].join(', ');

    function ownText(element) {
        try {
            return Array.from(element.childNodes)
                .filter(node => node.nodeType === Node.TEXT_NODE)
                .map(node => node.textContent || '')
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();
        } catch (_) {
            return '';
        }
    }

    function looksLikeHostUi(element) {
        const text = ownText(element) || (element.getAttribute?.('aria-label') || '').trim();
        if (!text) return false;
        return UI_TEXT_PATTERNS.some(pattern => pattern.test(text));
    }

    function protect(element) {
        try { element.setAttribute('dir', 'ltr'); } catch (_) {}
        try { element.setAttribute('data-rtl-fixancer-ui-guard', 'true'); } catch (_) {}
        try { element.removeAttribute('data-rtl-fixancer-rtl-text'); } catch (_) {}
        try { element.removeAttribute('data-rtl-fixancer-language'); } catch (_) {}
        try { element.style.direction = 'ltr'; } catch (_) {}
        try { element.style.textAlign = 'left'; } catch (_) {}
        try { element.style.unicodeBidi = 'isolate'; } catch (_) {}
        try { element.style.removeProperty('font-family'); } catch (_) {}
    }

    function run() {
        const candidates = Array.from(document.querySelectorAll(UI_SELECTOR));
        let guarded = 0;
        for (const element of candidates) {
            if (guarded >= 250) break;
            if (!looksLikeHostUi(element)) continue;
            protect(element);
            guarded++;
        }
    }

    function start() {
        if (window[TIMER_KEY]) return;
        const tick = () => {
            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(run, { timeout: 200 });
            } else {
                setTimeout(run, 0);
            }
        };
        window[TIMER_KEY] = setInterval(tick, 1200);
        tick();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    start();
})();
