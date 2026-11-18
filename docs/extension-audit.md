# RTL Fixancer Architecture Audit (4.2.3 update)

Date: 2026-10-25

## Security boundary

- Manifest V3 service worker.
- No static content scripts.
- Manifest-declared HTTP/HTTPS host permissions replace per-site runtime prompts.
- Chrome may ask once on install/update; Chrome site restrictions are still respected.
- Dynamic registrations exist only for enabled hostnames with granted permissions.
- Content scripts execute in the isolated world and only in the top frame.
- No remote code, telemetry, or content upload.
- Only bundled font files are web accessible.

## Runtime model

`content.js` uses one `MutationObserver`, an idle-work queue, and delegated editor events. It contains no interval-based DOM scanning and no per-site selectors.

Detection is text driven: a text node containing RTL characters is followed up to its nearest non-inline ancestor (its text block), and that block is classified as a whole. Blocks that contain other block elements are layout containers and are never marked; `<li>` items qualify only when they hold no headings, tables, code, sections, or more than four paragraphs, because hosts such as ChatGPT render whole messages as `<li>`. Code, embedded content, editors, navigation, headers, footers, asides, buttons, and toolbars are skipped. Open shadow roots are observed and receive the rules through `adoptedStyleSheets`.

The observer callback only records nodes; classification runs in `requestIdleCallback` with an 8 ms budget per pass. Only the `dir` attribute is observed (to re-apply after a host rewrite) — observing `class`/`style` page-wide made busy SPAs lag. Editors are read with `textContent`, never `innerText`, to avoid forced layout on each keystroke.

Before setting `dir` or extension data attributes, the runtime records whether each attribute existed and its exact original value. It also records the last value written by RTL Fixancer. Cleanup restores an original attribute only when the current DOM value is still the value owned by the extension, so a newer host-page `dir` value is preserved.

## Permission lifecycle

1. On installation/upgrade, Chrome may ask once for access to HTTP/HTTPS sites.
2. The user enables a hostname in the popup or context menu, without a `chrome.permissions.request()` call.
3. The service worker checks Chrome-granted host access, saves the hostname, and registers scripts **only for enabled hosts**.
4. The current tab is injected immediately; future matching navigations use the persistent dynamic registration.
5. Disabling sends explicit cleanup messages and unregisters the script without revoking browser host permission.
6. Chrome site-access restrictions trigger re-synchronization without erasing the saved enabled-site list.

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
- Test installation/upgrade permission consent, no per-site Allow on enable, Chrome site restrictions, disable and re-enable.
- Confirm an unenabled site receives no content runtime.
- Confirm exact DOM restoration without page reload.
- Test Persian, Arabic, Hebrew, mixed text, inputs, code blocks, and lists.
- Test X/Twitter, ChatGPT, Grok, Gemini, Google AI Studio, Perplexity, DeepSeek, and a generic site.
- Test streaming and virtualized/recycled messages.
- Restart Chrome and verify enabled-site registrations persist.
- Test popup keyboard navigation, dark mode, RTL popup language, reduced motion, context menus, and Print / Save as PDF.


## Concurrency and navigation hardening

Settings writes are serialized through a service-worker mutation queue so popup, context-menu, and permission events cannot overwrite each other's read-modify-write updates. Dynamic-registration synchronization always reads the latest stored settings when its queued turn begins, preventing stale storage events from restoring an older registration set.

Per-tab toolbar icons are reset to the inactive icon when a navigation enters the loading state; an enabled page's content runtime sets the active icon again after injection. This keeps tab-specific icon state from leaking across navigations without adding the broad `tabs` permission.

Appearance-only setting changes update runtime styles without restoring and rescanning the full document. Detection-mode changes still perform a full reversible reclassification.


## Runtime upgrade handshake

Injected page runtimes report their implementation version. Re-apply and enable operations only reuse a runtime when that version matches the current extension core; otherwise the current files are injected, the older runtime removes its listeners and restores its DOM changes, and the new runtime replaces it. This prevents already-open tabs from silently continuing to run code from an older extension update.

Site enable/disable operations are serialized as whole operations, including runtime injection. Browser permission changes never erase saved enabled sites; restrictions trigger host-scoped cleanup attempts and registration sync, and restoring access reactivates saved sites.


On extension install/update, already-open enabled tabs are refreshed automatically. The service worker queries only enabled hosts for which permission is still granted and performs the same version handshake, so a site-specific fix does not require a manual page refresh before it can take effect.
