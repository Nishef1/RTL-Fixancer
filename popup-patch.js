(() => {
    'use strict';

    const PATCH_FLAG = '__rtlFixancerPopupPatchApplied';
    const MAX_ATTEMPTS = 80;
    const RETRY_DELAY_MS = 100;

    function normalize(value) {
        return typeof value === 'string' ? value.toLowerCase() : '';
    }

    function domainMatches(enabledSites, hostname) {
        const normalizedHostname = normalize(hostname);
        if (!normalizedHostname) return false;

        return Array.from(enabledSites || []).some(site => {
            const normalizedSite = normalize(site);
            return normalizedHostname === normalizedSite || normalizedHostname.endsWith('.' + normalizedSite);
        });
    }

    function findMatchedSite(enabledSites, hostname) {
        const normalizedHostname = normalize(hostname);
        if (!normalizedHostname) return null;

        return Array.from(enabledSites || []).find(site => {
            const normalizedSite = normalize(site);
            return normalizedHostname === normalizedSite || normalizedHostname.endsWith('.' + normalizedSite);
        }) || null;
    }

    function patchEnabledSet(manager) {
        if (!manager || !manager.enabledSites || manager.enabledSites.__rtlFixancerHasPatched) return;

        const originalHas = manager.enabledSites.has.bind(manager.enabledSites);
        manager.enabledSites.has = (hostname) => originalHas(hostname) || domainMatches(manager.enabledSites, hostname);
        Object.defineProperty(manager.enabledSites, '__rtlFixancerHasPatched', { value: true });
    }

    async function requestPrint(manager) {
        try {
            await manager.sendMessageToContent('exportPdf', {}, 5000);
            manager.showSuccessMessage?.('در حال ساخت PDF...');
            return;
        } catch (_) {
            // Fall through to safe native print fallback.
        }

        try {
            await chrome.scripting.executeScript({
                target: { tabId: manager.currentTab.id },
                func: () => window.print()
            });
            manager.showSuccessMessage?.('پنجره پرینت باز شد...');
        } catch (error) {
            manager.logError?.('popup safe PDF fallback failed', error);
            manager.showErrorMessage?.('امکان پرینت در این صفحه وجود ندارد');
        }
    }

    function patchManager(manager) {
        if (!manager) return false;
        patchEnabledSet(manager);
        if (manager[PATCH_FLAG]) return true;
        manager[PATCH_FLAG] = true;

        manager.domainMatches = domainMatches;
        manager.findMatchedSite = findMatchedSite;
        manager.isCurrentDomainEnabled = function isCurrentDomainEnabled() {
            return domainMatches(this.enabledSites, this.currentDomain);
        };

        const originalLoadSettings = manager.loadSettings.bind(manager);
        manager.loadSettings = async function loadSettingsWithDomainPatch(...args) {
            const result = await originalLoadSettings(...args);
            patchEnabledSet(this);
            return result;
        };

        const originalUpdateCurrentSiteDisplay = manager.updateCurrentSiteDisplay.bind(manager);
        manager.updateCurrentSiteDisplay = function updateCurrentSiteDisplayWithSubdomains(...args) {
            originalUpdateCurrentSiteDisplay(...args);
            try {
                if (!this.currentDomain) return;
                this.safeSetElementProperty('currentSiteToggle', 'checked', this.isCurrentDomainEnabled());
            } catch (error) {
                this.logError?.('popup domain patch display update failed', error);
            }
        };

        const toggle = manager.elements?.currentSiteToggle;
        if (toggle && !toggle.__rtlFixancerTogglePatched) {
            toggle.addEventListener('change', async (event) => {
                event.preventDefault();
                event.stopImmediatePropagation();

                if (!manager.currentDomain) return;

                try {
                    patchEnabledSet(manager);
                    if (event.target.checked) {
                        manager.enabledSites.add(manager.currentDomain);
                    } else {
                        const matchedSite = findMatchedSite(manager.enabledSites, manager.currentDomain);
                        if (matchedSite) manager.enabledSites.delete(matchedSite);
                    }

                    await manager.updateSetting('enabledSites', Array.from(manager.enabledSites).sort());
                    await manager.triggerFullReload();
                    manager.updateCurrentSiteDisplay();
                    manager.updateSitesList();
                } catch (error) {
                    manager.showErrorMessage?.('خطا در به‌روزرسانی وضعیت سایت');
                    manager.logError?.('popup domain patch toggle failed', error);
                }
            }, true);
            toggle.__rtlFixancerTogglePatched = true;
        }

        const exportButton = manager.elements?.btnExportPdf;
        if (exportButton && !exportButton.__rtlFixancerPdfPatched) {
            exportButton.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopImmediatePropagation();

                try {
                    exportButton.classList.add('loading');
                    await requestPrint(manager);
                } finally {
                    setTimeout(() => exportButton.classList.remove('loading'), 1200);
                }
            }, true);
            exportButton.__rtlFixancerPdfPatched = true;
        }

        manager.updateCurrentSiteDisplay();
        return true;
    }

    function patchWhenReady(attempt = 0) {
        if (patchManager(window.popupManager)) return;
        if (attempt >= MAX_ATTEMPTS) return;
        setTimeout(() => patchWhenReady(attempt + 1), RETRY_DELAY_MS);
    }

    document.addEventListener('DOMContentLoaded', () => patchWhenReady(), { once: true });
    patchWhenReady();
})();
