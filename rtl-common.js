(() => {
    'use strict';

    const ROOT_KEY = 'RTLFixancerCommon';
    const root = window[ROOT_KEY] || {};

    root.languages = root.languages || {};

    root.registerLanguage = function registerLanguage(config) {
        if (!config || typeof config.code !== 'string' || !(config.regex instanceof RegExp)) return;
        root.languages[config.code] = {
            code: config.code,
            name: config.name || config.code,
            regex: config.regex,
            fontStack: config.fontStack || 'Tahoma, Arial, sans-serif',
            direction: config.direction || 'rtl'
        };
    };

    root.registerLanguage({
        code: 'fa',
        name: 'Persian',
        regex: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/,
        fontStack: 'Vazir, Shabnam, Tahoma, Arial, sans-serif'
    });

    root.detectLanguages = function detectLanguages(text) {
        const value = typeof text === 'string' ? text : '';
        return Object.values(root.languages).filter(language => language.regex.test(value));
    };

    root.detectPrimaryLanguage = function detectPrimaryLanguage(text) {
        const matches = root.detectLanguages(text);
        return matches[0] || null;
    };

    root.hasRtlText = function hasRtlText(text) {
        return root.detectLanguages(text).length > 0;
    };

    root.applyRtlTypography = function applyRtlTypography(element, options = {}) {
        if (!element) return false;
        const text = options.text || element.textContent || '';
        const language = options.language || root.detectPrimaryLanguage(text);
        if (!language) return false;

        element.setAttribute('dir', 'rtl');
        element.setAttribute('data-rtl-fixancer-rtl-text', 'true');
        element.setAttribute('data-rtl-fixancer-language', language.code);
        element.style.direction = 'rtl';
        element.style.textAlign = 'right';
        element.style.unicodeBidi = 'plaintext';
        element.style.fontFamily = language.fontStack;
        return true;
    };

    window[ROOT_KEY] = root;
})();
