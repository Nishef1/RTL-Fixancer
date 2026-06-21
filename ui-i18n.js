(() => {
    'use strict';

    const DEFAULT_LANGUAGE = 'en';
    const translations = {
        en: {
            title: 'RTL Fixancer',
            statusConnecting: 'Status: Connecting...',
            currentSite: '🌐 Current site',
            exportPdf: '📥 PDF',
            active: 'Active',
            reapply: 'Re-apply',
            settings: '🎨 Settings',
            font: 'Font',
            size: 'Size',
            sensitivity: 'Sensitivity',
            sites: '📋 Sites',
            emptySites: 'No sites added yet',
            help: 'Changes are applied immediately.',
            currentSiteUnknown: 'Restricted or unknown site',
            statusPrefix: 'Status:',
            statusMap: {
                'در حال اتصال...': 'Connecting...',
                'قطع - سایت غیرفعال': 'Disconnected - site disabled',
                'قطع - دامنه نامشخص': 'Disconnected - unknown domain',
                'قطع - خطای اتصال': 'Disconnected - connection error',
                'صفحه محافظت شده': 'Protected page',
                'محدود شده توسط سیاست مرورگر': 'Restricted by browser policy',
                'متصل ✓': 'Connected ✓'
            },
            fonts: {
                vazir: 'Vazir',
                shabnam: 'Shabnam',
                default: 'Default'
            },
            sizes: {
                default: 'Default',
                small: 'Small',
                medium: 'Medium',
                large: 'Large'
            },
            modes: {
                high: 'High',
                medium: 'Medium',
                low: 'Low'
            }
        },
        fa: {
            title: 'RTL Fixancer',
            statusConnecting: 'وضعیت: در حال اتصال...',
            currentSite: '🌐 سایت فعلی',
            exportPdf: '📥 PDF',
            active: 'فعال',
            reapply: 'اعمال مجدد',
            settings: '🎨 تنظیمات',
            font: 'فونت',
            size: 'سایز',
            sensitivity: 'حساسیت',
            sites: '📋 سایتها',
            emptySites: 'هیچ سایتی اضافه نشده',
            help: 'با تغییر تنظیمات، نتایج بلافاصله اعمال می‌شود.',
            currentSiteUnknown: 'سایت محدود یا نامعلوم',
            statusPrefix: 'وضعیت:',
            statusMap: {},
            fonts: {
                vazir: 'وزیر',
                shabnam: 'شبنم',
                default: 'پیشفرض'
            },
            sizes: {
                default: 'پیشفرض',
                small: 'کوچک',
                medium: 'متوسط',
                large: 'بزرگ'
            },
            modes: {
                high: 'بالا',
                medium: 'متوسط',
                low: 'پایین'
            }
        }
    };

    function setText(selector, value) {
        const element = document.querySelector(selector);
        if (element && typeof value === 'string') element.textContent = value;
    }

    function setSelectLabels(selectId, labels) {
        const select = document.getElementById(selectId);
        if (!select || !labels) return;
        Array.from(select.options).forEach(option => {
            if (labels[option.value]) option.textContent = labels[option.value];
        });
    }

    function translateStatusText(text, copy) {
        if (typeof text !== 'string' || !copy?.statusMap) return text;
        const raw = text.replace(/^وضعیت:\s*/, '').replace(/^Status:\s*/, '').trim();
        const translated = copy.statusMap[raw];
        return translated ? `${copy.statusPrefix} ${translated}` : text;
    }

    function translateDynamicText(copy) {
        const status = document.getElementById('status');
        if (status) {
            const translated = translateStatusText(status.textContent, copy);
            if (translated !== status.textContent) status.textContent = translated;
        }

        document.querySelectorAll('.empty-sites').forEach(element => {
            if (element.textContent.trim() === 'هیچ سایتی اضافه نشده') {
                element.textContent = copy.emptySites;
            }
        });

        const currentSite = document.getElementById('currentSiteUrl');
        if (currentSite && currentSite.textContent.trim() === 'سایت محدود یا نامعلوم') {
            currentSite.textContent = copy.currentSiteUnknown;
        }
    }

    function observeDynamicText(copy) {
        if (window.__rtlFixancerI18nObserver) return;
        window.__rtlFixancerI18nObserver = new MutationObserver(() => translateDynamicText(copy));
        window.__rtlFixancerI18nObserver.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    function applyLanguage(languageCode = DEFAULT_LANGUAGE) {
        const lang = translations[languageCode] ? languageCode : DEFAULT_LANGUAGE;
        const copy = translations[lang];
        document.documentElement.lang = lang;
        document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl';

        setText('.header h1', copy.title);
        setText('#status', copy.statusConnecting);
        setText('[data-i18n="currentSite"]', copy.currentSite);
        setText('#btnExportPdf', copy.exportPdf);
        setText('[data-i18n="active"]', copy.active);
        setText('#btnReapply', copy.reapply);
        setText('[data-i18n="settings"]', copy.settings);
        setText('label[for="fontSelect"]', copy.font);
        setText('label[for="fontSizeSelect"]', copy.size);
        setText('label[for="detectionMode"]', copy.sensitivity);
        setText('[data-i18n="sites"]', copy.sites);
        setText('.empty-sites', copy.emptySites);
        setText('.help', copy.help);

        setSelectLabels('fontSelect', copy.fonts);
        setSelectLabels('fontSizeSelect', copy.sizes);
        setSelectLabels('detectionMode', copy.modes);
        translateDynamicText(copy);
        observeDynamicText(copy);
    }

    async function init() {
        let language = DEFAULT_LANGUAGE;
        try {
            const stored = await chrome.storage.sync.get({ uiLanguage: DEFAULT_LANGUAGE });
            language = stored.uiLanguage || DEFAULT_LANGUAGE;
        } catch (_) {}
        applyLanguage(language);
    }

    window.RTLFixancerI18n = {
        DEFAULT_LANGUAGE,
        translations,
        applyLanguage,
        init
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
