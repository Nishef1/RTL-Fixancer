(() => {
    'use strict';

    const Core = globalThis.RTLFixancerCore;
    if (!Core) return;

    const DONATION_ADDRESS = '0x5ba08cc1429bead9c07dc2030b881c6ed33c3a00';
    const SVG_NS = 'http://www.w3.org/2000/svg';

    const copy = {
        en: {
            currentSite: 'Current site',
            loading: 'Loading…',
            restricted: 'Restricted page',
            enabledHint: 'Private, on-device RTL processing is active.',
            disabledHint: 'Enable access for this site only.',
            permissionHint: 'Chrome will ask once for this hostname.',
            reapply: 'Re-apply',
            print: 'PDF',
            settings: 'Settings',
            font: 'Font',
            size: 'Size',
            sensitivity: 'Sensitivity',
            sites: 'Sites',
            empty: 'No sites enabled yet.',
            remove: 'Remove',
            footer: 'Changes are applied immediately.',
            enabling: 'Requesting access…',
            enabled: 'Enabled on this site.',
            disabled: 'Disabled on this site.',
            updated: 'Settings updated.',
            denied: 'Site access was not granted.',
            error: 'Something went wrong. Reload the extension and try again.',
            active: 'Active',
            inactive: 'Inactive',
            statusActive: 'Status: Active on this site',
            statusDisabled: 'Status: Disconnected · site disabled',
            statusRestricted: 'Status: This page is restricted',
            switchLanguage: 'Switch popup language',
            donate: 'Copy donation address',
            donationCopied: 'Donation address copied.',
            github: 'Open GitHub repository',
            fonts: { vazir: 'Vazir', shabnam: 'Shabnam', default: 'Default' },
            sizes: { default: 'Default', small: 'Small', medium: 'Medium', large: 'Large' },
            modes: { strict: 'Strict', balanced: 'Medium', relaxed: 'Relaxed' }
        },
        fa: {
            currentSite: 'سایت فعلی',
            loading: 'در حال بارگذاری…',
            restricted: 'صفحه محدود است',
            enabledHint: 'پردازش راست‌به‌چپ به‌صورت محلی فعال است.',
            disabledHint: 'دسترسی فقط برای همین سایت فعال می‌شود.',
            permissionHint: 'کروم یک‌بار برای همین دامنه اجازه می‌خواهد.',
            reapply: 'اعمال مجدد',
            print: 'PDF',
            settings: 'تنظیمات',
            font: 'فونت',
            size: 'اندازه',
            sensitivity: 'حساسیت',
            sites: 'سایت‌ها',
            empty: 'هنوز سایتی فعال نشده است.',
            remove: 'حذف',
            footer: 'تغییرات بلافاصله اعمال می‌شوند.',
            enabling: 'در حال درخواست دسترسی…',
            enabled: 'برای این سایت فعال شد.',
            disabled: 'برای این سایت غیرفعال شد.',
            updated: 'تنظیمات به‌روزرسانی شد.',
            denied: 'اجازه دسترسی به سایت داده نشد.',
            error: 'مشکلی رخ داد. افزونه را دوباره بارگذاری کن.',
            active: 'فعال',
            inactive: 'غیرفعال',
            statusActive: 'وضعیت: برای این سایت فعال است',
            statusDisabled: 'وضعیت: قطع · سایت غیرفعال است',
            statusRestricted: 'وضعیت: این صفحه محدود است',
            switchLanguage: 'تغییر زبان افزونه',
            donate: 'کپی آدرس حمایت مالی',
            donationCopied: 'آدرس حمایت مالی کپی شد.',
            github: 'بازکردن مخزن گیت‌هاب',
            fonts: { vazir: 'وزیر', shabnam: 'شبنم', default: 'پیش‌فرض' },
            sizes: { default: 'پیش‌فرض', small: 'کوچک', medium: 'متوسط', large: 'بزرگ' },
            modes: { strict: 'سخت‌گیرانه', balanced: 'متوسط', relaxed: 'آزاد' }
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
            'notice', 'currentSite', 'siteToggle', 'siteHint', 'activeLabel',
            'reapplyButton', 'printButton', 'fontSelect', 'fontSizeSelect',
            'detectionModeSelect', 'sitesList', 'sitesCount', 'languageToggle',
            'githubButton', 'donateButton', 'connectionStatus', 'statusText'
        ]) {
            elements[id] = $(id);
        }
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
        }, 2800);
    }

    function setBusy(busy) {
        state.busy = busy;
        elements.siteToggle.disabled = busy || !state.supported;
        elements.reapplyButton.disabled = busy || !state.status?.enabled;
        elements.printButton.disabled = busy || !state.supported;
        elements.languageToggle.disabled = busy;
        for (const select of [elements.fontSelect, elements.fontSizeSelect, elements.detectionModeSelect]) {
            select.disabled = busy;
        }
    }

    function translateOptions(select, labels) {
        for (const option of select.options) {
            if (labels?.[option.value]) option.textContent = labels[option.value];
        }
    }

    function setButtonLabel(button, value) {
        const label = button.querySelector('span');
        if (label) label.textContent = value;
    }

    function updateLanguageToggle(language) {
        for (const option of elements.languageToggle.querySelectorAll('.language-option')) {
            option.classList.toggle('active', option.dataset.language === language);
        }
        elements.languageToggle.setAttribute('aria-label', t('switchLanguage'));
        elements.languageToggle.title = t('switchLanguage');
    }

    function applyLanguage() {
        const language = state.settings.uiLanguage === 'fa' ? 'fa' : 'en';
        document.documentElement.lang = language;
        document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr';

        $('#site-heading').textContent = t('currentSite');
        $('#appearance-heading').textContent = t('settings');
        $('#sites-heading').textContent = t('sites');

        const fields = document.querySelectorAll('.field > span');
        if (fields[0]) fields[0].textContent = t('font');
        if (fields[1]) fields[1].textContent = t('size');
        if (fields[2]) fields[2].textContent = t('sensitivity');

        setButtonLabel(elements.reapplyButton, t('reapply'));
        setButtonLabel(elements.printButton, t('print'));
        $('.footer > span').textContent = t('footer');

        elements.donateButton.setAttribute('aria-label', t('donate'));
        elements.donateButton.title = t('donate');
        elements.githubButton.setAttribute('aria-label', t('github'));
        elements.githubButton.title = t('github');

        updateLanguageToggle(language);
        translateOptions(elements.fontSelect, copy[language].fonts);
        translateOptions(elements.fontSizeSelect, copy[language].sizes);
        translateOptions(elements.detectionModeSelect, copy[language].modes);
        renderSiteStatus();
        renderSites();
    }

    function renderSiteStatus() {
        const enabled = Boolean(state.status?.enabled);
        elements.currentSite.textContent = state.supported ? state.hostname : t('restricted');
        elements.siteToggle.checked = enabled;
        elements.activeLabel.textContent = enabled ? t('active') : t('inactive');

        elements.connectionStatus.classList.remove('connected', 'disconnected', 'restricted');
        if (!state.supported) {
            elements.connectionStatus.classList.add('restricted');
            elements.statusText.textContent = t('statusRestricted');
            elements.siteHint.textContent = t('restricted');
        } else if (enabled) {
            elements.connectionStatus.classList.add('connected');
            elements.statusText.textContent = t('statusActive');
            elements.siteHint.textContent = t('enabledHint');
        } else {
            elements.connectionStatus.classList.add('disconnected');
            elements.statusText.textContent = t('statusDisabled');
            elements.siteHint.textContent = state.status?.permissionGranted
                ? t('disabledHint')
                : t('permissionHint');
        }

        elements.reapplyButton.disabled = state.busy || !enabled;
        elements.printButton.disabled = state.busy || !state.supported;
        elements.siteToggle.disabled = state.busy || !state.supported;
    }

    function createTrashIcon() {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');

        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', 'M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5');
        svg.appendChild(path);
        return svg;
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
        remove.title = t('remove');
        remove.setAttribute('aria-label', `${t('remove')} ${hostname}`);
        remove.appendChild(createTrashIcon());
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

        for (const hostname of sites) {
            elements.sitesList.appendChild(createSiteItem(hostname));
        }
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
                permissionGranted: enabled
                    ? true
                    : await chrome.permissions.contains({ origins: Core.matchPatternsForHost(state.hostname) })
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
                state.status = {
                    ...state.status,
                    enabled: false,
                    permissionGranted: await chrome.permissions.contains({
                        origins: Core.matchPatternsForHost(state.hostname)
                    })
                };
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

    async function copyDonationAddress() {
        try {
            await navigator.clipboard.writeText(DONATION_ADDRESS);
            showNotice(t('donationCopied'));
        } catch (_) {
            const textarea = document.createElement('textarea');
            textarea.value = DONATION_ADDRESS;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            const copied = document.execCommand('copy');
            textarea.remove();
            showNotice(copied ? t('donationCopied') : DONATION_ADDRESS, !copied);
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
        elements.languageToggle.addEventListener('click', () => {
            const nextLanguage = state.settings.uiLanguage === 'fa' ? 'en' : 'fa';
            void updateSetting('uiLanguage', nextLanguage);
        });
        elements.donateButton.addEventListener('click', () => void copyDonationAddress());
        elements.githubButton.addEventListener('click', () => {
            void chrome.tabs.create({ url: 'https://github.com/Nishef1/RTL-Fixancer' });
        });
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
