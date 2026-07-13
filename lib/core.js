(() => {
    'use strict';

    const ROOT_KEY = 'RTLFixancerCore';
    if (globalThis[ROOT_KEY]) return;

    const DEFAULT_SETTINGS = Object.freeze({
        selectedFont: 'vazir',
        fontSize: 'default',
        detectionMode: 'balanced',
        uiLanguage: 'en',
        enabledSites: []
    });

    const VALID_FONTS = new Set(['vazir', 'shabnam', 'default']);
    const VALID_SIZES = new Set(['default', 'small', 'medium', 'large']);
    const VALID_MODES = new Set(['strict', 'balanced', 'relaxed']);
    const VALID_LANGUAGES = new Set(['en', 'fa']);

    const HEBREW_RE = /[\u0590-\u05FF\uFB1D-\uFB4F]/u;
    const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u;
    const PERSIAN_RE = /[\u067E\u0686\u0698\u06AF\u06A9\u06CC\u06F0-\u06F9\u200C]/u;
    const LATIN_RE = /\p{Script=Latin}/u;

    function normalizeHostname(value) {
        if (typeof value !== 'string') return '';
        const candidate = value.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
        if (!candidate || /[\s/*@?#]/.test(candidate)) return '';
        try {
            const url = new URL(`http://${candidate}`);
            if (url.username || url.password || url.port || url.pathname !== '/') return '';
            return url.hostname.toLowerCase().replace(/^\.+|\.+$/g, '');
        } catch (_) {
            return '';
        }
    }

    function isSupportedUrl(value) {
        try {
            const url = value instanceof URL ? value : new URL(value);
            return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
        } catch (_) {
            return false;
        }
    }

    function matchPatternsForHost(hostname) {
        const host = normalizeHostname(hostname);
        if (!host) return [];
        return [`http://${host}/*`, `https://${host}/*`];
    }

    function siteMatches(enabledSites, hostname) {
        const host = normalizeHostname(hostname);
        if (!host || !Array.isArray(enabledSites)) return false;
        return enabledSites.some(site => normalizeHostname(site) === host);
    }

    function findMatchingSite(enabledSites, hostname) {
        const host = normalizeHostname(hostname);
        if (!host || !Array.isArray(enabledSites)) return null;
        return enabledSites.map(normalizeHostname).find(site => site === host) || null;
    }

    function normalizeSites(value) {
        if (!Array.isArray(value)) return [];
        return [...new Set(value.map(normalizeHostname).filter(Boolean))].sort();
    }

    function normalizeSettings(value = {}) {
        const source = value && typeof value === 'object' ? value : {};
        return {
            selectedFont: VALID_FONTS.has(source.selectedFont) ? source.selectedFont : DEFAULT_SETTINGS.selectedFont,
            fontSize: VALID_SIZES.has(source.fontSize) ? source.fontSize : DEFAULT_SETTINGS.fontSize,
            detectionMode: VALID_MODES.has(source.detectionMode) ? source.detectionMode : DEFAULT_SETTINGS.detectionMode,
            uiLanguage: VALID_LANGUAGES.has(source.uiLanguage) ? source.uiLanguage : DEFAULT_SETTINGS.uiLanguage,
            enabledSites: normalizeSites(source.enabledSites)
        };
    }

    function registrationId(hostname) {
        const host = normalizeHostname(hostname);
        let hash = 2166136261;
        for (let index = 0; index < host.length; index += 1) {
            hash ^= host.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return `rtl-fixancer-${(hash >>> 0).toString(36)}`;
    }

    function getThreshold(mode) {
        switch (mode) {
            case 'strict':
                return { minRtl: 3, minRatio: 0.6 };
            case 'relaxed':
                return { minRtl: 1, minRatio: 0.2 };
            default:
                return { minRtl: 2, minRatio: 0.35 };
        }
    }

    function classifyText(value, mode = DEFAULT_SETTINGS.detectionMode) {
        const text = typeof value === 'string' ? value.normalize('NFKC') : '';
        if (!text.trim()) {
            return { direction: 'neutral', language: null, rtlCount: 0, ltrCount: 0, ratio: 0 };
        }

        let rtlCount = 0;
        let ltrCount = 0;
        let persianCount = 0;
        let arabicCount = 0;
        let hebrewCount = 0;

        for (const character of text) {
            if (HEBREW_RE.test(character)) {
                rtlCount += 1;
                hebrewCount += 1;
                continue;
            }
            if (ARABIC_RE.test(character)) {
                rtlCount += 1;
                arabicCount += 1;
                if (PERSIAN_RE.test(character)) persianCount += 1;
                continue;
            }
            if (LATIN_RE.test(character)) ltrCount += 1;
        }

        const strongCount = rtlCount + ltrCount;
        const ratio = strongCount > 0 ? rtlCount / strongCount : 0;
        const threshold = getThreshold(VALID_MODES.has(mode) ? mode : DEFAULT_SETTINGS.detectionMode);
        const direction = rtlCount >= threshold.minRtl && ratio >= threshold.minRatio ? 'rtl' : (ltrCount > 0 ? 'ltr' : 'neutral');

        let language = null;
        if (direction === 'rtl') {
            if (hebrewCount > arabicCount) language = 'he';
            else if (persianCount > 0) language = 'fa';
            else language = 'ar';
        }

        return { direction, language, rtlCount, ltrCount, ratio };
    }

    function fontStack(selectedFont, language) {
        const fallback = language === 'he'
            ? "'Noto Sans Hebrew', 'Segoe UI', Arial, sans-serif"
            : "'Noto Sans Arabic', 'Noto Naskh Arabic', Tahoma, Arial, sans-serif";
        if (selectedFont === 'vazir') return `'RTLFixancerVazir', ${fallback}`;
        if (selectedFont === 'shabnam') return `'RTLFixancerShabnam', ${fallback}`;
        return fallback;
    }

    globalThis[ROOT_KEY] = Object.freeze({
        DEFAULT_SETTINGS,
        classifyText,
        findMatchingSite,
        fontStack,
        isSupportedUrl,
        matchPatternsForHost,
        normalizeHostname,
        normalizeSettings,
        registrationId,
        siteMatches
    });
})();
