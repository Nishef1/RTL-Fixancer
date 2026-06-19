# Chrome Extension Audit Notes

Date: 2026-06-20

## Scope

Reviewed the extension against Manifest V3 operational and security practices:

- Manifest permissions and host permissions
- Background service worker behavior
- Content script activation model
- Popup-to-content messaging and script injection fallback
- URL handling for restricted browser pages

## Fixed in this PR

### 1. Removed unnecessary broad host permissions

The manifest had `host_permissions` with `*://*/*` plus specific hosts. The extension already uses a static content script with `<all_urls>` and an internal per-site enable list, while popup/context-menu injection can rely on user invocation through `activeTab` and `scripting`.

Keeping broad `host_permissions` increases install-time warnings and violates least-privilege expectations. The PR removes the host permissions block and keeps the runtime permissions the current architecture actually needs.

### 2. Aligned manifest version metadata

`AGENTS.md` described the post-fix version as `3.4`, but `manifest.json` was still `3.3`. The PR updates the manifest version to `3.4` and adds `minimum_chrome_version: 88`, which is the general baseline for Manifest V3 support.

### 3. Hardened background URL handling

The background service worker now only attempts script injection or page printing on `http:` and `https:` pages. This avoids noisy failures on browser pages such as `chrome://`, `chrome-extension://`, `edge://`, local restricted pages, and similar protected URLs.

### 4. Removed unsafe `javascript:` tab fallback

The old PDF export fallback attempted to open a new tab with `javascript:window.print()`. This is brittle, unsafe, and not a reliable MV3 pattern. The PR replaces it with a single controlled `chrome.scripting.executeScript({ func: () => window.print() })` fallback and logs a safe error if that fails.

### 5. Fixed stale settings dispatch after context-menu toggle

The previous context-menu toggle stored a new `enabledSites` list, but sent the old settings object to the content script immediately after. The PR now builds `nextSettings` and sends the fresh state to the tab.

### 6. Centralized tab messaging and injection fallback

`background.js` now uses small helpers for:

- URL support checks
- hostname extraction
- tab messaging with `runtime.lastError` handling
- script injection with explicit error handling
- content reload fallback

This reduces duplicated callback code and prevents unhandled `runtime.lastError` noise.

## Important follow-up issue not changed in this PR

`background.js` uses subdomain-aware matching:

```js
hostname === site || hostname.endsWith('.' + site)
```

But `content.js` currently checks only exact domain membership:

```js
return sites.includes(this.currentDomain);
```

That can create an icon/content mismatch for subdomains. This PR intentionally did not touch `content.js` because it is a large, historically fragile file and the repo guide explicitly warns against broad edits there. Recommended targeted future fix:

```js
isSiteEnabled() {
    if (!this.currentDomain) return false;
    const sites = this.config && Array.isArray(this.config.enabledSites)
        ? this.config.enabledSites
        : [];
    return sites.some(site => {
        if (typeof site !== 'string') return false;
        const normalizedSite = site.toLowerCase();
        const normalizedDomain = this.currentDomain.toLowerCase();
        return normalizedDomain === normalizedSite || normalizedDomain.endsWith('.' + normalizedSite);
    });
}
```

## Manual verification checklist

1. Load the unpacked extension in Chrome.
2. Confirm no manifest warning appears for unnecessary host permissions beyond content-script access.
3. Open a normal `https://` page, enable the domain, and verify the icon turns on.
4. Use context menu → re-apply and verify the page updates without console errors.
5. Use context menu → export PDF and verify it opens the print dialog.
6. Open `chrome://extensions` or another protected page and verify the extension fails gracefully without trying to inject scripts.
7. Test subdomain behavior after the follow-up `content.js` fix.
