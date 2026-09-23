# RTL Fixancer 4.0 Architecture Audit

Date: 2026-09-23

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

`content.js` uses one `MutationObserver`, an idle-work queue, and delegated editor events. It contains no interval-based DOM scanning. Candidate elements are text-bearing leaves; structural UI, code, embedded content, and navigation are skipped. X/Twitter is handled by a narrow adapter that promotes `[data-testid="tweetText"]` to a block candidate so native `dir="auto"` tweet containers are aligned as a block instead of modifying only an inner span.

Before setting `dir` or extension data attributes, the runtime records whether each attribute existed and its exact original value. It also records the last value written by RTL Fixancer. Cleanup restores an original attribute only when the current DOM value is still the value owned by the extension, so a newer host-page `dir` value is preserved.

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
- Test X/Twitter, ChatGPT, Gemini, Google AI Studio, Perplexity, DeepSeek, and a generic site.
- Test streaming and virtualized/recycled messages.
- Restart Chrome and verify enabled-site registrations persist.
- Test popup keyboard navigation, dark mode, RTL popup language, reduced motion, context menus, and Print / Save as PDF.


## Concurrency and navigation hardening

Settings writes are serialized through a service-worker mutation queue so popup, context-menu, and permission events cannot overwrite each other's read-modify-write updates. Dynamic-registration synchronization always reads the latest stored settings when its queued turn begins, preventing stale storage events from restoring an older registration set.

Per-tab toolbar icons are reset to the inactive icon when a navigation enters the loading state; an enabled page's content runtime sets the active icon again after injection. This keeps tab-specific icon state from leaking across navigations without adding the broad `tabs` permission.

Appearance-only setting changes update runtime styles without restoring and rescanning the full document. Detection-mode changes still perform a full reversible reclassification.


## Runtime upgrade handshake

Injected page runtimes report their implementation version. Re-apply and enable operations only reuse a runtime when that version matches the current extension core; otherwise the current files are injected, the older runtime removes its listeners and restores its DOM changes, and the new runtime replaces it. This prevents already-open tabs from silently continuing to run code from an older extension update.

Site enable/disable operations are serialized as whole operations, including permission removal and runtime injection. Permission revocation from Chrome settings removes the affected hostname from storage, sends a host-scoped cleanup message to existing page runtimes, and then resynchronizes dynamic registrations.
