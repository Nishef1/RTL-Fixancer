// --- Utility Promise Wrappers ---
const DEFAULT_SETTINGS = {
    isEnabled: true,
    selectedFont: 'vazir',
    fontSize: 'default',
    detectionMode: 'medium',
    enabledSites: []
};

const INJECTABLE_PROTOCOLS = new Set(['http:', 'https:']);

function getSyncStorage(defaults = DEFAULT_SETTINGS) {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.get(defaults, (result) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(result);
        });
    });
}

function setSyncStorage(data) {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.set(data, () => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve();
        });
    });
}

function isInjectableUrl(tabUrl) {
    try {
        if (!tabUrl) return false;
        return INJECTABLE_PROTOCOLS.has(new URL(tabUrl).protocol);
    } catch (_) {
        return false;
    }
}

function getHostname(tabUrl) {
    try {
        if (!isInjectableUrl(tabUrl)) return '';
        return new URL(tabUrl).hostname.toLowerCase();
    } catch (_) {
        return '';
    }
}

// --- Context Menu Creation ---
let contextMenusCreating = false;
let contextMenusTimeout = null;

function createContextMenus() {
    if (contextMenusCreating || !chrome.contextMenus) return;
    contextMenusCreating = true;
    clearTimeout(contextMenusTimeout);
    contextMenusTimeout = setTimeout(() => { contextMenusCreating = false; }, 5000);

    chrome.contextMenus.removeAll(() => {
        if (chrome.runtime.lastError) {
            console.warn('removeAll failed:', chrome.runtime.lastError.message);
        }

        const menus = [
            {
                id: 'rtl_parent',
                title: 'RTL Fixancer',
                contexts: ['all']
            },
            {
                id: 'rtl_toggle_current_domain',
                parentId: 'rtl_parent',
                title: 'فعال/غیرفعال کردن دامنه فعلی',
                contexts: ['all']
            },
            {
                id: 'rtl_apply_reload',
                parentId: 'rtl_parent',
                title: 'اعمال مجدد در این صفحه',
                contexts: ['all']
            },
            {
                id: 'rtl_export_pdf',
                parentId: 'rtl_parent',
                title: '⬇️ دانلود PDF از متن صفحه',
                contexts: ['all']
            }
        ];

        let created = 0;
        menus.forEach(menu => {
            chrome.contextMenus.create(menu, () => {
                if (chrome.runtime.lastError) {
                    console.warn('create failed for', menu.id, ':', chrome.runtime.lastError.message);
                }
                created++;
                if (created === menus.length) {
                    clearTimeout(contextMenusTimeout);
                    contextMenusCreating = false;
                }
            });
        });
    });
}

// --- Subdomain Matching ---
function hostnameMatch(enabledSites, hostname) {
    if (!hostname || !Array.isArray(enabledSites)) return false;
    const normalizedHostname = hostname.toLowerCase();
    return enabledSites.some(site => {
        if (typeof site !== 'string') return false;
        const normalizedSite = site.toLowerCase();
        return normalizedHostname === normalizedSite || normalizedHostname.endsWith('.' + normalizedSite);
    });
}

function toggleHostname(enabledSites, hostname) {
    const sites = new Set(Array.isArray(enabledSites) ? enabledSites : []);
    if (hostnameMatch(Array.from(sites), hostname)) {
        sites.delete(hostname);
    } else {
        sites.add(hostname);
    }
    return Array.from(sites).sort();
}

// --- Icon Paths Utility ---
function getIconPaths(isOn) {
    if (isOn) {
        return {
            16: 'images/RTL-on-16.png',
            32: 'images/RTL-on-32.png',
            48: 'images/RTL-on-48.png',
            128: 'images/RTL-on-128.png'
        };
    }
    return {
        16: 'images/RTL-off-16.png',
        32: 'images/RTL-off-32.png',
        48: 'images/RTL-off-48.png',
        128: 'images/RTL-off-128.png'
    };
}

// --- Debounced Icon Update ---
const iconUpdateQueue = {};
function debounceUpdateIcon(tabId, url) {
    clearTimeout(iconUpdateQueue[tabId]);
    iconUpdateQueue[tabId] = setTimeout(() => {
        delete iconUpdateQueue[tabId];
        updateIconForTab(tabId, url);
    }, 150);
}

// --- Update Icon Based On State ---
async function updateIconForTab(tabId, tabUrl) {
    try {
        if (!tabUrl) {
            const tab = await chrome.tabs.get(tabId).catch(() => null);
            tabUrl = tab?.url || '';
        }

        if (!isInjectableUrl(tabUrl)) {
            await chrome.action.setIcon({ tabId, path: getIconPaths(false) });
            return;
        }

        const hostname = getHostname(tabUrl);
        const settings = await getSyncStorage(DEFAULT_SETTINGS);
        const enabled = hostnameMatch(settings.enabledSites, hostname);
        await chrome.action.setIcon({ tabId, path: getIconPaths(enabled) });
    } catch (e) {
        console.error('updateIconForTab error:', e);
    }
}

function sendMessageToTab(tabId, message) {
    return new Promise(resolve => {
        try {
            chrome.tabs.sendMessage(tabId, message, response => {
                if (chrome.runtime.lastError) {
                    resolve({ ok: false, error: chrome.runtime.lastError.message });
                    return;
                }
                resolve({ ok: true, response });
            });
        } catch (error) {
            resolve({ ok: false, error: error.message });
        }
    });
}

async function executeScriptSafely(tabId, details) {
    try {
        await chrome.scripting.executeScript({ target: { tabId }, ...details });
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

async function requestContentReload(tabId, settings) {
    const message = { action: 'fullReload', ...settings };
    let result = await sendMessageToTab(tabId, message);
    if (result.ok) return result;

    const injection = await executeScriptSafely(tabId, { files: ['content.js'] });
    if (!injection.ok) return injection;

    await new Promise(resolve => setTimeout(resolve, 250));
    return sendMessageToTab(tabId, message);
}

async function exportPdf(tab) {
    if (!tab?.id || !isInjectableUrl(tab.url)) {
        console.warn('Export skipped: unsupported tab URL');
        return;
    }

    let result = await sendMessageToTab(tab.id, { action: 'exportPdf' });
    if (result.ok) return;

    const injection = await executeScriptSafely(tab.id, { files: ['content.js'] });
    if (injection.ok) {
        await new Promise(resolve => setTimeout(resolve, 500));
        result = await sendMessageToTab(tab.id, { action: 'exportPdf' });
        if (result.ok) return;
    }

    const printFallback = await executeScriptSafely(tab.id, { func: () => window.print() });
    if (!printFallback.ok) {
        console.error('Export PDF failed:', result.error || injection.error || printFallback.error);
    }
}

chrome.runtime.onInstalled.addListener(() => {
    console.log('RTL Fixancer installed/updated');
    createContextMenus();
    try { chrome.action.setIcon({ path: getIconPaths(false) }); } catch (e) { console.error(e); }
});

if (chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(() => {
        createContextMenus();
        try { chrome.action.setIcon({ path: getIconPaths(false) }); } catch (e) { console.error(e); }
    });
}

if (chrome.contextMenus) {
    chrome.contextMenus.onClicked.addListener(async (info, tab) => {
        try {
            if (!tab?.id || !isInjectableUrl(tab.url)) return;
            const hostname = getHostname(tab.url);
            if (!hostname) return;

            if (info.menuItemId === 'rtl_toggle_current_domain') {
                const settings = await getSyncStorage(DEFAULT_SETTINGS);
                const enabledSites = toggleHostname(settings.enabledSites, hostname);
                const nextSettings = { ...settings, enabledSites };

                await setSyncStorage({ enabledSites });
                await requestContentReload(tab.id, nextSettings);

                const isNowEnabled = hostnameMatch(enabledSites, hostname);
                await chrome.action.setIcon({ tabId: tab.id, path: getIconPaths(isNowEnabled) });
                return;
            }

            if (info.menuItemId === 'rtl_apply_reload') {
                const settings = await getSyncStorage(DEFAULT_SETTINGS);
                await requestContentReload(tab.id, settings);
                return;
            }

            if (info.menuItemId === 'rtl_export_pdf') {
                await exportPdf(tab);
            }
        } catch (e) {
            console.error('Context menu handler error:', e);
        }
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action === 'heartbeat') {
        const domain = typeof message.domain === 'string' ? message.domain : 'unknown';
        chrome.storage.local.set({
            [`heartbeat_${domain}`]: {
                timestamp: message.timestamp || Date.now(),
                stats: message.stats || {}
            }
        });

        try {
            if (sender?.tab?.id) chrome.action.setIcon({ tabId: sender.tab.id, path: getIconPaths(true) });
        } catch (e) {
            console.error(e);
        }

        sendResponse({ success: true });
        return true;
    }

    sendResponse({ success: false, error: 'Unknown action' });
    return false;
});

// --- Storage Change Handling ---
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs && tabs[0];
            if (tab?.id) debounceUpdateIcon(tab.id, tab.url || '');
        });
    }
});

// --- Clean up pending icon updates when tabs are closed ---
if (chrome.tabs.onRemoved) {
    chrome.tabs.onRemoved.addListener((tabId) => {
        if (iconUpdateQueue[tabId]) {
            clearTimeout(iconUpdateQueue[tabId]);
            delete iconUpdateQueue[tabId];
        }
    });
}

if (chrome.tabs.onActivated) {
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
        try {
            const tab = await chrome.tabs.get(activeInfo.tabId);
            debounceUpdateIcon(activeInfo.tabId, tab.url || '');
        } catch (e) { console.error(e); }
    });
}

if (chrome.tabs.onUpdated) {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.status === 'complete') {
            debounceUpdateIcon(tabId, tab.url || '');
        }
    });
}
