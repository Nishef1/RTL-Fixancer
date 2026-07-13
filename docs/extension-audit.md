# RTL Fixancer 4.0 Architecture Audit

Date: 2026-07-13

## Security boundary

- Manifest V3 service worker.
- No static content scripts.
- No required host permissions.
- `optional_host_permissions` are requested only from a popup or context-menu user gesture.
- Dynamic registrations exist only for enabled hostnames with granted permissions.
- Content scripts execute in the isolated world and only in the top frame.
- No remote code, telemetry, or content upload.
- Only bundled font files are web accessible.

## Runtime model

`content.js` uses one `MutationObserver`, an idle-work queue, and delegated editor events. It contains no interval-based DOM scanning. Candidate elements are text-bearing leaves; structural UI, code, embedded content, and navigation are skipped.

Before setting `dir` or extension data attributes, the runtime records whether each attribute existed and its exact original value. A site disable, settings restart, or runtime cleanup restores that snapshot instead of blindly deleting host-page state. If the host changes `dir` after RTL Fixancer applied its own value, cleanup preserves the newer host value.

## Permission lifecycle

1. The user opens the popup on an HTTP/HTTPS page.
2. Enabling the site calls `chrome.permissions.request()` with that exact hostname's match pattern.
3. The service worker stores the hostname and registers `lib/core.js` plus `content.js` with `chrome.scripting.registerContentScripts()`.
4. The current tab is injected immediately; future matching navigations use the persistent dynamic registration.
5. Disabling sends an explicit cleanup message to every matching open tab, unregisters the content script, and removes the now-unused host permission.

Unregistering alone is intentionally not treated as cleanup because already-injected scripts and styles remain in the page until explicitly reverted.

## Automated checks

`npm run check` verifies:

- manifest structure and permissions;
- absence of static content scripts and broad `tabs` access;
- required runtime files;
- no `eval`, `new Function`, or remote JavaScript;
- dynamic `document_idle` registration;
- event-driven observation without `setInterval`;
- relevant host attribute observation;
- reversible mutation support;
- exact-host matching, settings normalization, stable registration IDs, and RTL language classification.

## Release checklist

- Run `npm run check` with Node.js 22+.
- Load unpacked in Chrome 120+.
- Test permission grant, denial, disable, and re-enable.
- Confirm an unenabled site receives no content runtime.
- Confirm exact DOM restoration without page reload.
- Test Persian, Arabic, Hebrew, mixed text, inputs, code blocks, and lists.
- Test ChatGPT, Gemini, Google AI Studio, Perplexity, DeepSeek, and a generic site.
- Test streaming and virtualized/recycled messages.
- Restart Chrome and verify enabled-site registrations persist.
- Test popup keyboard navigation, dark mode, RTL popup language, reduced motion, context menus, and Print / Save as PDF.
