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
