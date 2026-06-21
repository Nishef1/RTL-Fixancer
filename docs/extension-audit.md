# Chrome Extension Audit Notes

Date: 2026-06-20

## Current status

RTL Fixancer is now a Manifest V3 Chrome extension for multilingual RTL text enhancement. It supports Persian/Farsi, Arabic, and Hebrew through a shared RTL helper and separate language modules.

## Runtime architecture

- `manifest.json` loads the full content chain at `document_start`.
- `rtl-common.js` owns shared RTL language registration and typography helpers.
- `languages/arabic.js` and `languages/hebrew.js` register extra RTL language configs.
- `content.js` remains the legacy core engine.
- `content-patch.js` patches subdomain-aware site matching without broad edits to the legacy core.
- `content-rtl-upgrade.js` upgrades only safe text-leaf elements and avoids structural layout containers.
- `content-ui-guard.js` keeps host-app UI controls such as tool-call labels, sidebars, nav items, and composer controls LTR.
- `ui-i18n.js` centralizes popup UI strings and defaults to English.
- `background.js` uses the same full content-script chain for fallback injection.

## Fixed issues

### 1. Removed broad host permissions

The old manifest requested broad `host_permissions`, including `*://*/*`. The current manifest does not request broad host permissions. Runtime behavior is controlled by the user's enabled-site list.

### 2. Hardened background URL handling

The background service worker only attempts scripting and print fallback on supported `http:` and `https:` pages.

### 3. Removed unsafe JavaScript URL print fallback

The previous `javascript:window.print()` tab fallback was removed. The remaining fallback uses `chrome.scripting.executeScript({ func: () => window.print() })` on supported pages.

### 4. Fixed stale settings dispatch after context-menu toggle

The background toggle now stores the new `enabledSites` list and sends the fresh settings object to the current tab.

### 5. Fixed subdomain mismatch

Background, popup, and content runtime now use subdomain-aware matching so enabling `example.com` can cover `sub.example.com`.

### 6. Added multilingual RTL support

Arabic and Hebrew are registered through separate modules while shared behavior is kept in `rtl-common.js`.

### 7. Prevented over-aggressive RTL on host UI

The generic RTL upgrade no longer targets structural containers such as `div`, `nav`, `header`, `aside`, `button`, sidebars, or topbars. A separate host UI guard forces known UI controls such as `Called tool`, `Thought for`, `Sources`, `Share`, and navigation/sidebar labels to stay LTR.

### 8. Popup UI cleanup

The popup is English by default and dynamic status/empty-state strings are translated through `ui-i18n.js`.

## Manual verification checklist

1. Reload the unpacked extension in `chrome://extensions`.
2. Hard-refresh ChatGPT after the extension reload.
3. Confirm the left sidebar, top bar, `Called tool`, and `Thought for` stay LTR.
4. Confirm Persian assistant/user message text is RTL and readable.
5. Test Arabic and Hebrew sample text in an AI chat response.
6. Test popup site toggle, Re-apply, and PDF export on a normal `https://` page.
7. Test a protected page such as `chrome://extensions` and confirm the extension fails gracefully.
8. Test subdomain behavior: enable `example.com`, then verify `sub.example.com` inherits the enabled state.

## Remaining caution

`content.js` is still a large legacy file. Future improvements should continue using small, isolated patch files unless the core file is refactored with live browser verification.
