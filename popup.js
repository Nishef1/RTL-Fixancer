(() => {
    'use strict';

    const Core = globalThis.RTLFixancerCore;
    if (!Core) return;

    const copy = {
        en: {
            currentSite: 'Current site',
            loading: 'Loading…',
            restricted: 'Restricted or unsupported page',
            disabledHint: 'Enable access only for this site. No page content leaves your browser.',
            enabledHint: 'RTL enhancement is active on this site.',
            permissionHint: 'Chrome will ask for access to this site when you enable it.',
            reapply: 'Re-apply',
            print: 'Print / PDF',
            appearance: 'Appearance',
            font: 'Font',
            size: 'Size',
            detection: 'Detection',
            enabledSites: 'Enabled sites',
            empty: 'No sites enabled yet.',
            remove: 'Remove',
            footer: 'Runs only on sites you enable.',
            enabling: 'Requesting access…',
            enabled: 'Enabled on this site.',
            disabled: 'Disabled on this site.',
            updated: 'Settings updated.',
            denied: 'Site access was not granted.',
            error: 'Something went wrong. Reload the extension and try again.',
            fonts: { vazir: 'Vazir', shabnam: 'Shabnam', default: 'Website default' },
            sizes: { default: 'Website default', small: 'Small', medium: 'Medium', large: 'Large' },
            modes: { strict: 'Strict', balanced: 'Balanced', relaxed: 'Relaxed' }
        },
        fa: {
            currentSite: 'سایت فعلی',
            loading: 'در حال بارگذاری…',
            restricted: 'صفحه محدود یا پشتیبانی‌نشده',
            disabledHint: 'دسترسی فقط برای همین سایت فعال می‌شود و محتوای صفحه از مرورگر خارج نمی‌شود.',
            enabledHint: 'بهبود نوشتار راست‌به‌چپ در این سایت فعال است.',
            permissionHint: 'هنگام فعال‌سازی، کروم برای دسترسی به همین سایت اجازه می‌خواهد.',
            reapply: 'اعمال مجدد',
            print: 'پرینت / PDF',
            appearance: 'نمایش',
            font: 'فونت',
            size: 'اندازه',
            detection: 'تشخیص',
            enabledSites: 'سایت‌های فعال',
            empty: 'هنوز سایتی فعال نشده است.',
            remove: 'حذف',
            footer: 'فقط روی سایت‌هایی اجرا می‌شود که خودت فعال کرده‌ای.',
            enabling: 'در حال درخواست دسترسی…',
            enabled: 'برای این سایت فعال شد.',
            disabled: 'برای این سایت غیرفعال شد.',
            updated: 'تنظیمات به‌روزرسانی شد.',
            denied: 'اجازه دسترسی به سایت داده نشد.',
            error: 'مشکلی رخ داد. افزونه را دوباره بارگذاری و مجدداً تلاش کن.',
            fonts: { vazir: 'وزیر', shabnam: 'شبنم', default: 'فونت سایت' },
            sizes: { default: 'اندازه سایت', small: 'کوچک', medium: 'متوسط', large: 'بزرگ' },
            modes: { strict: 'سخت‌گیرانه', balanced: 'متعادل', relaxed: 'آزاد' }
        }
    };

    const state = {
        tab: null,
        hostname: '',
        supported: false,
        settings: Core.DEFAULT_SETTINGS,
        status: null,
        busy: false
    };

    const elements = {};

    function $(id) {
        return document.getElementById(id);
    }

    function collectElements() {
        for (const id of [
            'notice', 'currentSite', 'siteToggle', 'siteHint', 'reapplyButton',
            'printButton', 'fontSelect', 'fontSizeSelect', 'detectionModeSelect',
            'sitesList', 'sitesCount', 'languageSelect', 'githubButton'
        ]) elements[id] = $(id);
    }

    function t(key) {
        return copy[state.settings.uiLanguage]?.[key] || copy.en[key] || key;
    }

    async function send(message) {
        const response = await chrome.runtime.sendMessage(message);
        if (!response?.ok) {
            const error = new Error(response?.error || t('error'));
            error.code = response?.code;
            throw error;
        }
        return response;
    }

    function showNotice(message, error = false) {
        elements.notice.textContent = message;
        elements.notice.classList.toggle('error', error);
        elements.notice.hidden = false;
        window.clearTimeout(showNotice.timer);
        showNotice.timer = window.setTimeout(() => {
            elements.notice.hidden = true;
        }, 3200);
    }

    function setBusy(busy) {
        state.busy = busy;
        elements.siteToggle.disabled = busy || !state.supported;
        elements.reapplyButton.disabled = busy || !state.status?.enabled;
        elements.printButton.disabled = busy || !state.supported;
        for (const select of [elements.fontSelect, elements.fontSizeSelect, elements.detectionModeSelect, elements.languageSelect]) {
            select.disabled = busy;
        }
    }

    function translateOptions(select, labels) {
        for (const option of select.options) {
            if (labels?.[option.value]) option.textContent = labels[option.value];
        }
    }

    function applyLanguage() {
        const language = state.settings.uiLanguage === 'fa' ? 'fa' : 'en';
        document.documentElement.lang = language;
        document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr';
        document.querySelector('#site-heading').textContent = t('currentSite');
        document.querySelector('#appearance-heading').textContent = t('appearance');
        const fields = document.querySelectorAll('.field > span');
        if (fields[0]) fields[0].textContent = t('font');
        if (fields[1]) fields[1].textContent = t('size');
        if (fields[2]) fields[2].textContent = t('detection');
        document.querySelector('#sites-heading').textContent = t('enabledSites');
        elements.reapplyButton.textContent = t('reapply');
        elements.printButton.textContent = t('print');
        document.querySelector('.footer > span').textContent = t('footer');
        elements.languageSelect.value = language;
        const languageCopy = copy[language];
        translateOptions(elements.fontSelect, languageCopy.fonts);
        translateOptions(elements.fontSizeSelect, languageCopy.sizes);
        translateOptions(elements.detectionModeSelect, languageCopy.modes);
        renderSiteStatus();
        renderSites();
    }

    function renderSiteStatus() {
        elements.currentSite.textContent = state.supported ? state.hostname : t('restricted');
        elements.siteToggle.checked = Boolean(state.status?.enabled);
        elements.siteHint.textContent = !state.supported
            ? t('restricted')
            : state.status?.enabled
                ? t('enabledHint')
                : state.status?.permissionGranted
                    ? t('disabledHint')
                    : t('permissionHint');
        elements.reapplyButton.disabled = state.busy || !state.status?.enabled;
        elements.printButton.disabled = state.busy || !state.supported;
        elements.siteToggle.disabled = state.busy || !state.supported;
    }

    function createSiteItem(hostname) {
        const row = document.createElement('div');
        row.className = 'site-item';

        const label = document.createElement('span');
        label.textContent = hostname;
        label.title = hostname;

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove-button';
        remove.textContent = t('remove');
        remove.setAttribute('aria-label', `${t('remove')} ${hostname}`);
        remove.addEventListener('click', () => void removeSite(hostname));

        row.append(label, remove);
        return row;
    }

    function renderSites() {
        const sites = state.settings.enabledSites || [];
        elements.sitesCount.textContent = String(sites.length);
        elements.sitesList.replaceChildren();
        if (sites.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'empty';
            empty.textContent = t('empty');
            elements.sitesList.appendChild(empty);
            return;
        }
        for (const hostname of sites) elements.sitesList.appendChild(createSiteItem(hostname));
    }

    async function getActiveTab() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        state.tab = tab || null;
        state.supported = Boolean(tab?.url && Core.isSupportedUrl(tab.url));
        state.hostname = state.supported ? Core.normalizeHostname(new URL(tab.url).hostname) : '';
    }

    async function refresh() {
        const settingsResponse = await send({ type: 'settings:get' });
        state.settings = Core.normalizeSettings(settingsResponse.settings);

        if (state.supported) {
            state.status = await send({ type: 'site:status', hostname: state.hostname });
            state.settings = Core.normalizeSettings(state.status.settings);
        } else {
            state.status = { enabled: false, permissionGranted: false };
        }

        elements.fontSelect.value = state.settings.selectedFont;
        elements.fontSizeSelect.value = state.settings.fontSize;
        elements.detectionModeSelect.value = state.settings.detectionMode;
        applyLanguage();
        setBusy(false);
    }

    async function requestCurrentSitePermission() {
        const origins = Core.matchPatternsForHost(state.hostname);
        if (origins.length === 0) return false;
        return chrome.permissions.request({ origins });
    }

    async function toggleSite(enabled) {
        if (!state.supported || state.busy) return;
        setBusy(true);
        try {
            if (enabled && !state.status.permissionGranted) {
                showNotice(t('enabling'));
                const granted = await requestCurrentSitePermission();
                if (!granted) {
                    elements.siteToggle.checked = false;
                    showNotice(t('denied'), true);
                    return;
                }
            }

            const response = await send({
                type: 'site:set',
                hostname: state.hostname,
                enabled,
                tabId: state.tab.id
            });
            state.settings = Core.normalizeSettings(response.settings);
            state.status = {
                ...state.status,
                enabled: response.enabled,
                permissionGranted: enabled ? true : await chrome.permissions.contains({ origins: Core.matchPatternsForHost(state.hostname) })
            };
            showNotice(enabled ? t('enabled') : t('disabled'));
            renderSiteStatus();
            renderSites();
        } catch (error) {
            elements.siteToggle.checked = !enabled;
            showNotice(error.message || t('error'), true);
        } finally {
            setBusy(false);
        }
    }

    async function removeSite(hostname) {
        if (state.busy) return;
        setBusy(true);
        try {
            const response = await send({ type: 'site:set', hostname, enabled: false });
            state.settings = Core.normalizeSettings(response.settings);
            if (Core.siteMatches([hostname], state.hostname)) {
                state.status = { ...state.status, enabled: false };
            }
            showNotice(t('disabled'));
            renderSiteStatus();
            renderSites();
        } catch (error) {
            showNotice(error.message || t('error'), true);
        } finally {
            setBusy(false);
        }
    }

    async function updateSetting(key, value) {
        if (state.busy) return;
        setBusy(true);
        try {
            const response = await send({
                type: 'settings:update',
                patch: { [key]: value }
            });
            state.settings = Core.normalizeSettings(response.settings);
            if (key === 'uiLanguage') applyLanguage();
            showNotice(t('updated'));
        } catch (error) {
            showNotice(error.message || t('error'), true);
        } finally {
            setBusy(false);
        }
    }

    function bindEvents() {
        elements.siteToggle.addEventListener('change', event => void toggleSite(event.target.checked));
        elements.reapplyButton.addEventListener('click', async () => {
            setBusy(true);
            try {
                await send({ type: 'runtime:reapply', tabId: state.tab.id, hostname: state.hostname });
                showNotice(t('updated'));
            } catch (error) {
                showNotice(error.message || t('error'), true);
            } finally {
                setBusy(false);
            }
        });
        elements.printButton.addEventListener('click', async () => {
            setBusy(true);
            try {
                await send({ type: 'runtime:print', tabId: state.tab.id });
            } catch (error) {
                showNotice(error.message || t('error'), true);
            } finally {
                setBusy(false);
            }
        });
        elements.fontSelect.addEventListener('change', event => void updateSetting('selectedFont', event.target.value));
        elements.fontSizeSelect.addEventListener('change', event => void updateSetting('fontSize', event.target.value));
        elements.detectionModeSelect.addEventListener('change', event => void updateSetting('detectionMode', event.target.value));
        elements.languageSelect.addEventListener('change', event => void updateSetting('uiLanguage', event.target.value));
        elements.githubButton.addEventListener('click', () => void chrome.tabs.create({ url: 'https://github.com/Nishef1/RTL-Fixancer' }));
    }

    document.addEventListener('DOMContentLoaded', () => {
        void (async () => {
            collectElements();
            bindEvents();
            setBusy(true);
            await getActiveTab();
            await refresh();
        })().catch(error => {
            console.error('RTL Fixancer popup failed:', error);
            if (elements.notice) showNotice(error.message || copy.en.error, true);
            if (elements.siteToggle) setBusy(false);
        });
    }, { once: true });
})();
