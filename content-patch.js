(() => {
    'use strict';

    const PATCH_FLAG = '__rtlFixancerDomainPatchApplied';
    const MAX_ATTEMPTS = 80;
    const RETRY_DELAY_MS = 100;

    function getCurrentDomain() {
        try {
            return window.location.hostname.toLowerCase();
        } catch (_) {
            return '';
        }
    }

    function domainMatches(enabledSites, hostname) {
        if (!hostname || !Array.isArray(enabledSites)) return false;
        const normalizedHostname = hostname.toLowerCase();

        return enabledSites.some(site => {
            if (typeof site !== 'string') return false;
            const normalizedSite = site.toLowerCase();
            return normalizedHostname === normalizedSite || normalizedHostname.endsWith('.' + normalizedSite);
        });
    }

    function patchManager(manager) {
        if (!manager || manager[PATCH_FLAG]) return false;

        manager[PATCH_FLAG] = true;
        manager.domainMatches = domainMatches;
        manager.isSiteEnabled = function isSiteEnabledWithSubdomains() {
            const hostname = this.currentDomain || getCurrentDomain();
            const sites = this.config && Array.isArray(this.config.enabledSites)
                ? this.config.enabledSites
                : [];
            return domainMatches(sites, hostname);
        };

        try {
            if (manager.config?.isEnabled && manager.isSiteEnabled() && !manager.hasInitialized) {
                manager.startExtension();
            }
        } catch (error) {
            console.warn('RTL Fixancer domain patch start failed:', error);
        }

        return true;
    }

    function patchWhenReady(attempt = 0) {
        if (patchManager(window.rtlManagerAIStudio)) return;
        if (attempt >= MAX_ATTEMPTS) return;
        setTimeout(() => patchWhenReady(attempt + 1), RETRY_DELAY_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => patchWhenReady(), { once: true });
    }
    patchWhenReady();

    try {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'sync' || !changes.enabledSites) return;
            const manager = window.rtlManagerAIStudio;
            if (!manager) return;
            patchManager(manager);

            if (manager.config) {
                manager.config.enabledSites = changes.enabledSites.newValue || [];
            }

            try {
                const enabled = manager.config?.isEnabled && manager.isSiteEnabled();
                if (enabled && !manager.hasInitialized) {
                    manager.startExtension();
                } else if (!enabled && manager.hasInitialized) {
                    manager.cleanup();
                    manager.hasInitialized = false;
                }
            } catch (error) {
                console.warn('RTL Fixancer domain patch storage handling failed:', error);
            }
        });
    } catch (_) {}
})();
