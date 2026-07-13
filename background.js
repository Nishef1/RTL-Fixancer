'use strict';

importScripts('lib/core.js');

const Core = globalThis.RTLFixancerCore;
const CONTENT_FILES = Object.freeze(['lib/core.js', 'content.js']);
const REGISTRATION_PREFIX = 'rtl-fixancer-';
const STORAGE_KEY = 'settings';
let registrationSyncQueue = Promise.resolve();

function getIconPaths(enabled) {
    const state = enabled ? 'on' : 'off';
    return {
        16: `images/RTL-${state}-16.png`,
        32: `images/RTL-${state}-32.png`,
        48: `images/RTL-${state}-48.png`,
        128: `images/RTL-${state}-128.png`
    };
}

async function readSettings() {
    const stored = await chrome.storage.sync.get({ [STORAGE_KEY]: Core.DEFAULT_SETTINGS });
    return Core.normalizeSettings(stored[STORAGE_KEY]);
}

async function writeSettings(settings) {
    const normalized = Core.normalizeSettings(settings);
    await chrome.storage.sync.set({ [STORAGE_KEY]: normalized });
    return normalized;
}

async function hasPermissionForHost(hostname) {
    const origins = Core.matchPatternsForHost(hostname);
    if (origins.length === 0) return false;
    return chrome.permissions.contains({ origins });
}

async function buildDesiredRegistrations(settings) {
    const registrations = [];
    for (const hostname of settings.enabledSites) {
        if (!await hasPermissionForHost(hostname)) continue;
        registrations.push({
            id: Core.registrationId(hostname),
            js: CONTENT_FILES,
            matches: Core.matchPatternsForHost(hostname),
            allFrames: false,
            persistAcrossSessions: true,
            runAt: 'document_idle',
            world: 'ISOLATED'
        });
    }
    return registrations;
}

function sameRegistration(current, desired) {
    const normalizeMatches = values => [...(values || [])].sort();
    return JSON.stringify(current.js || []) === JSON.stringify(desired.js || [])
        && JSON.stringify(normalizeMatches(current.matches)) === JSON.stringify(normalizeMatches(desired.matches))
        && Boolean(current.allFrames) === Boolean(desired.allFrames)
        && Boolean(current.persistAcrossSessions) === Boolean(desired.persistAcrossSessions)
        && current.runAt === desired.runAt
        && (current.world || 'ISOLATED') === desired.world;
}

async function syncRegistrationsNow(settings = null) {
    const normalized = settings || await readSettings();
    const current = await chrome.scripting.getRegisteredContentScripts();
    const managed = new Map(
        current
            .filter(script => script.id.startsWith(REGISTRATION_PREFIX))
            .map(script => [script.id, script])
    );
    const desired = await buildDesiredRegistrations(normalized);
    const desiredById = new Map(desired.map(script => [script.id, script]));

    const obsoleteIds = [...managed.keys()].filter(id => !desiredById.has(id));
    if (obsoleteIds.length > 0) {
        await chrome.scripting.unregisterContentScripts({ ids: obsoleteIds });
    }

    const newScripts = [];
    const changedScripts = [];
    for (const script of desired) {
        const existing = managed.get(script.id);
        if (!existing) newScripts.push(script);
        else if (!sameRegistration(existing, script)) changedScripts.push(script);
    }

    if (changedScripts.length > 0) await chrome.scripting.updateContentScripts(changedScripts);
    if (newScripts.length > 0) await chrome.scripting.registerContentScripts(newScripts);
    return desired;
}

function syncRegistrations(settings = null) {
    const run = () => syncRegistrationsNow(settings);
    registrationSyncQueue = registrationSyncQueue.then(run, run);
    return registrationSyncQueue;
}

function normalizeTabId(value) {
    return Number.isInteger(value) && value >= 0 ? value : null;
}

async function sendToTab(tabId, message) {
    const id = normalizeTabId(tabId);
    if (id === null) return null;
    try {
        return await chrome.tabs.sendMessage(id, message, { frameId: 0 });
    } catch (_) {
        return null;
    }
}

async function cleanupOpenTabs(hostname, explicitTabId = null) {
    const host = Core.normalizeHostname(hostname);
    if (!host) return;
    const tabIds = new Set();
    const directId = normalizeTabId(explicitTabId);
    if (directId !== null) tabIds.add(directId);
    try {
        const tabs = await chrome.tabs.query({ url: Core.matchPatternsForHost(host) });
        for (const tab of tabs) {
            const id = normalizeTabId(tab.id);
            if (id !== null) tabIds.add(id);
        }
    } catch (_) {}
    await Promise.all([...tabIds].map(tabId => sendToTab(tabId, { type: 'runtime:cleanup' })));
}

async function injectRuntime(tabId) {
    const id = normalizeTabId(tabId);
    if (id === null) throw new Error('A valid tab is required.');
    await chrome.scripting.executeScript({
        target: { tabId: id, frameIds: [0] },
        files: CONTENT_FILES,
        world: 'ISOLATED'
    });
}

async function ensureRuntime(tabId) {
    const ping = await sendToTab(tabId, { type: 'runtime:ping' });
    if (ping?.ok) return ping;
    await injectRuntime(tabId);
    return sendToTab(tabId, { type: 'runtime:ping' });
}

async function updateIcon(tabId, hostname, settings = null) {
    const id = normalizeTabId(tabId);
    if (id === null) return;
    const normalizedHost = Core.normalizeHostname(hostname);
    const currentSettings = settings || await readSettings();
    const enabled = Core.siteMatches(currentSettings.enabledSites, normalizedHost)
        && await hasPermissionForHost(normalizedHost);
    await chrome.action.setIcon({ tabId: id, path: getIconPaths(enabled) });
}

async function removeUnusedHostPermission(hostname, remainingSites) {
    const host = Core.normalizeHostname(hostname);
    if (!host) return false;
    const stillCovered = remainingSites.some(site => Core.normalizeHostname(site) === host);
    if (stillCovered) return false;
    try {
        return await chrome.permissions.remove({ origins: Core.matchPatternsForHost(host) });
    } catch (_) {
        return false;
    }
}

async function setSiteEnabled({ hostname, enabled, tabId = null }) {
    const host = Core.normalizeHostname(hostname);
    if (!host) throw new Error('Invalid hostname.');

    let settings = await readSettings();
    const sites = new Set(settings.enabledSites);
    let permissionHost = host;

    if (enabled) {
        if (!await hasPermissionForHost(host)) {
            const error = new Error('Site permission has not been granted.');
            error.code = 'HOST_PERMISSION_REQUIRED';
            throw error;
        }
        sites.add(host);
    } else {
        const matched = Core.findMatchingSite([...sites], host);
        if (matched) {
            sites.delete(matched);
            permissionHost = matched;
        }
        await cleanupOpenTabs(permissionHost, tabId);
    }

    settings = await writeSettings({ ...settings, enabledSites: [...sites] });
    await syncRegistrations(settings);

    if (enabled && tabId !== null) {
        await ensureRuntime(tabId);
        await sendToTab(tabId, { type: 'runtime:settings', settings });
    }

    if (!enabled) {
        await removeUnusedHostPermission(permissionHost, settings.enabledSites);
    }

    await updateIcon(tabId, host, settings);
    return { settings, enabled: Core.siteMatches(settings.enabledSites, host) };
}

async function updateSettings(patch) {
    const current = await readSettings();
    const allowedPatch = {};
    for (const key of ['selectedFont', 'fontSize', 'detectionMode', 'uiLanguage']) {
        if (Object.prototype.hasOwnProperty.call(patch || {}, key)) allowedPatch[key] = patch[key];
    }
    return writeSettings({ ...current, ...allowedPatch });
}

async function getSiteStatus(hostname) {
    const host = Core.normalizeHostname(hostname);
    const settings = await readSettings();
    const permissionGranted = host ? await hasPermissionForHost(host) : false;
    return {
        hostname: host,
        enabled: Boolean(host && permissionGranted && Core.siteMatches(settings.enabledSites, host)),
        permissionGranted,
        settings
    };
}

async function reapply(tabId, hostname) {
    const status = await getSiteStatus(hostname);
    if (!status.enabled) throw new Error('Enable this site before re-applying RTL fixes.');
    await ensureRuntime(tabId);
    return sendToTab(tabId, { type: 'runtime:reapply', settings: status.settings });
}

async function printCurrentPage(tabId) {
    const response = await sendToTab(tabId, { type: 'runtime:print' });
    if (response?.ok) return response;
    await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: () => window.print(),
        world: 'ISOLATED'
    });
    return { ok: true };
}

async function createContextMenus() {
    await chrome.contextMenus.removeAll();
    const entries = [
        { id: 'rtl-fixancer-root', title: 'RTL Fixancer', contexts: ['all'] },
        { id: 'rtl-fixancer-toggle', parentId: 'rtl-fixancer-root', title: 'Enable or disable on this site', contexts: ['all'] },
        { id: 'rtl-fixancer-reapply', parentId: 'rtl-fixancer-root', title: 'Re-apply RTL fixes', contexts: ['all'] },
        { id: 'rtl-fixancer-print', parentId: 'rtl-fixancer-root', title: 'Print / Save as PDF', contexts: ['all'] }
    ];
    for (const entry of entries) chrome.contextMenus.create(entry);
}

chrome.runtime.onInstalled.addListener(() => {
    void (async () => {
        const stored = await chrome.storage.sync.get(STORAGE_KEY);
        if (!stored[STORAGE_KEY]) await writeSettings(Core.DEFAULT_SETTINGS);
        await createContextMenus();
        await syncRegistrations();
        await chrome.action.setIcon({ path: getIconPaths(false) });
    })().catch(error => console.error('RTL Fixancer installation failed:', error));
});

chrome.runtime.onStartup.addListener(() => {
    void Promise.all([createContextMenus(), syncRegistrations()])
        .catch(error => console.error('RTL Fixancer startup failed:', error));
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id || !Core.isSupportedUrl(tab.url || '')) return;
    const hostname = new URL(tab.url).hostname;

    if (info.menuItemId === 'rtl-fixancer-toggle') {
        const origins = Core.matchPatternsForHost(hostname);
        const previousPermission = chrome.permissions.contains({ origins });
        const permissionRequest = chrome.permissions.request({ origins });
        void Promise.all([previousPermission, permissionRequest]).then(async ([hadPermission, granted]) => {
            if (!granted) return;
            const status = await getSiteStatus(hostname);
            const enable = hadPermission ? !status.enabled : true;
            await setSiteEnabled({ hostname, enabled: enable, tabId: tab.id });
        }).catch(error => console.error('RTL Fixancer context-menu toggle failed:', error));
        return;
    }

    void (async () => {
        if (info.menuItemId === 'rtl-fixancer-reapply') {
            await reapply(tab.id, hostname);
            return;
        }
        if (info.menuItemId === 'rtl-fixancer-print') await printCurrentPage(tab.id);
    })().catch(error => console.error('RTL Fixancer context-menu action failed:', error));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void (async () => {
        switch (message?.type) {
            case 'settings:get':
                return { ok: true, settings: await readSettings() };
            case 'settings:update':
                return { ok: true, settings: await updateSettings(message.patch) };
            case 'site:status':
                return { ok: true, ...(await getSiteStatus(message.hostname)) };
            case 'site:set':
                return { ok: true, ...(await setSiteEnabled(message)) };
            case 'runtime:reapply':
                return { ok: true, response: await reapply(message.tabId, message.hostname) };
            case 'runtime:print':
                return await printCurrentPage(message.tabId);
            default:
                return { ok: false, error: 'Unknown message type.' };
        }
    })().then(sendResponse).catch(error => {
        sendResponse({ ok: false, error: error.message, code: error.code || 'UNKNOWN' });
    });
    return true;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes[STORAGE_KEY]) return;
    void syncRegistrations(Core.normalizeSettings(changes[STORAGE_KEY].newValue))
        .catch(error => console.error('RTL Fixancer registration sync failed:', error));
});

chrome.permissions.onAdded.addListener(() => {
    void syncRegistrations().catch(error => console.error('RTL Fixancer permission sync failed:', error));
});

chrome.permissions.onRemoved.addListener(() => {
    void syncRegistrations().catch(error => console.error('RTL Fixancer permission sync failed:', error));
});
