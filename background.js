
// --- Utility Promise Wrappers ---
function getSyncStorage(defaults) {
    return new Promise(resolve => chrome.storage.sync.get(defaults, resolve));
}

function setSyncStorage(data) {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.set(data, () => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve();
        });
    });
}

// --- Context Menu Creation ---
function createContextMenus() {
    try {
        chrome.contextMenus.removeAll(() => {
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
            menus.forEach(menu => chrome.contextMenus.create(menu));
        });
    } catch (e) {
        console.warn('Failed to create context menus:', e);
    }
}

// --- Subdomain Matching ---
function hostnameMatch(enabledSites, hostname) {
    return enabledSites.some(
        site => hostname === site || hostname.endsWith('.' + site)
    );
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
        updateIconForTab(tabId, url);
    }, 150);
}

// --- Update Icon Based On State ---
async function updateIconForTab(tabId, tabUrl) {
    try {
        if (!tabUrl) {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.id === tabId) tabUrl = tab.url || '';
        }
        if (!tabUrl || tabUrl.startsWith('chrome://') || tabUrl.startsWith('chrome-extension://')) {
            await chrome.action.setIcon({ tabId, path: getIconPaths(false) });
            return;
        }
        const hostname = new URL(tabUrl).hostname;
        const defaults = { enabledSites: [] };
        const settings = await getSyncStorage(defaults);
        const enabled = Array.isArray(settings.enabledSites) && hostnameMatch(settings.enabledSites, hostname);
        await chrome.action.setIcon({ tabId, path: getIconPaths(enabled) });
    } catch (e) {
        console.error('updateIconForTab error:', e);
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

chrome.contextMenus && chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    try {
        if (!tab || !tab.id || !tab.url) return;
        const url = new URL(tab.url);
        const hostname = url.hostname;
        const defaults = {
            isEnabled: true,
            selectedFont: 'vazir',
            fontSize: 'default',
            detectionMode: 'medium',
            enabledSites: []
        };

        if (info.menuItemId === 'rtl_toggle_current_domain') {
            let settings;
            try {
                settings = await getSyncStorage(defaults);
                const enabledSites = new Set(settings.enabledSites || []);
                if (hostnameMatch(Array.from(enabledSites), hostname)) {
                    enabledSites.delete(hostname);
                } else {
                    enabledSites.add(hostname);
                }
                await setSyncStorage({ enabledSites: Array.from(enabledSites) });
                // Trigger full reload
                chrome.tabs.sendMessage(tab.id, { action: 'fullReload', ...settings }, () => {});
                const isNowEnabled = enabledSites.has(hostname);
                try { chrome.action.setIcon({ tabId: tab.id, path: getIconPaths(isNowEnabled) }); } catch (e) { console.error(e); }
            } catch (err) {
                console.error('Toggle domain failed:', err);
            }
        }

        if (info.menuItemId === 'rtl_apply_reload') {
            const settings = await getSyncStorage(defaults);
            try {
                chrome.tabs.sendMessage(tab.id, { action: 'fullReload', ...settings }, () => {});
            } catch (err) {
                console.error('Apply reload failed:', err);
            }
        }

        if (info.menuItemId === 'rtl_export_pdf') {
            try {
                // First, try to send message to existing content script
                chrome.tabs.sendMessage(tab.id, { action: 'exportPdf' }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.log('Content script not available, attempting injection...');
                        
                        // Try to inject content script
                        chrome.scripting.executeScript({
                            target: { tabId: tab.id },
                            files: ['content.js']
                        }).then(() => {
                            setTimeout(() => {
                                chrome.tabs.sendMessage(tab.id, { action: 'exportPdf' }, (response) => {
                                    if (chrome.runtime.lastError) {
                                        console.log('Export via content script failed, using native print...');
                                        chrome.scripting.executeScript({
                                            target: { tabId: tab.id },
                                            func: () => window.print()
                                        });
                                    }
                                });
                            }, 500);
                        }).catch(injectionError => {
                            console.error('Content script injection failed:', injectionError.message);
                            console.log('Using native browser print as fallback...');
                            // Direct native print fallback when injection fails
                            chrome.scripting.executeScript({
                                target: { tabId: tab.id },
                                func: () => window.print()
                            }).catch(printError => {
                                console.error('All print methods failed:', printError);
                                // Try alternative method for policy-restricted pages
                                chrome.tabs.create({
                                    url: `javascript:window.print()`
                                });
                            });
                        });
                    }
                });
            } catch (e) {
                console.error('Export PDF failed:', e);
                // Final fallback - try direct print
                try {
                    chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        func: () => window.print()
                    });
                } catch (printError) {
                    console.error('Native print also failed:', printError);
                    // Try opening a new tab with print dialog
                    chrome.tabs.create({
                        url: `javascript:window.print()`
                    });
                }
            }
        }
    } catch (e) {
        console.error('Context menu handler error:', e);
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'heartbeat') {
        console.log('Heartbeat received from:', message.domain, 'Stats:', message.stats);
        // Store or process stats
        chrome.storage.local.set({
            [`heartbeat_${message.domain}`]: {
                timestamp: message.timestamp,
                stats: message.stats
            }
        });
        // Set ON icon for the sender tab
        try { if (sender && sender.tab && sender.tab.id) chrome.action.setIcon({ tabId: sender.tab.id, path: getIconPaths(true) }); } catch (e) { console.error(e); }
        sendResponse({ success: true });
        return true;
    }

    if (message.action === 'captureVisible') {
        try {
            chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }, (dataUrl) => {
                if (chrome.runtime.lastError) {
                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                } else {
                    sendResponse({ success: true, dataUrl });
                }
            });
        } catch (e) {
            sendResponse({ success: false, error: e.message });
        }
        return true;
    }
    return true;
});

// --- Storage Change Handling ---
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
        console.log('Settings changed:', changes);
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs && tabs[0];
            if (tab && tab.id) debounceUpdateIcon(tab.id, tab.url || '');
        });
    }
});

// --- Keep Service Worker Alive ---
chrome.runtime.onConnect.addListener((port) => {
    port.onDisconnect.addListener(() => {
        console.log('Port disconnected');
    });
});

chrome.tabs.onActivated && chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        debounceUpdateIcon(activeInfo.tabId, tab.url || '');
    } catch (e) { console.error(e); }
});

chrome.tabs.onUpdated && chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        debounceUpdateIcon(tabId, tab.url || '');
    }
});
