# RTL Fixancer Agent Guide

## Scope

RTL Fixancer is a Manifest V3 Chrome extension. Version 4 uses optional per-site host permissions and dynamic content-script registration. Work directly on `main`; do not create compatibility branches, duplicate runtimes, or patch layers.

## Architecture

- `lib/core.js`: the single source of truth for settings normalization, hostname matching, match patterns, registration IDs, language detection, and font stacks.
- `background.js`: owns optional permissions, dynamic registrations, storage, context menus, icon state, and privileged scripting.
- `content.js`: owns page observation and reversible DOM changes. It must remain polling-free.
- `popup.html`, `popup.css`, `popup.js`: own the user-facing controls and permission request initiated by a user gesture.

## Hard rules

1. Never restore static `<all_urls>` content scripts or broad mandatory host permissions.
2. Never add `tabs` unless a shipped feature demonstrably requires it.
3. Never process a domain unless it exists in `settings.enabledSites` and Chrome has granted its host permission.
4. Never change page DOM without capturing the exact original attribute state first.
5. Never add a recurring `setInterval` scan to `content.js`.
6. Do not modify structural containers, navigation, toolbars, code editors, or code blocks.
7. Do not add remote code, analytics, trackers, or page-content network requests.
8. Prefer deleting or integrating old code over adding another compatibility file.
9. Do not maintain legacy storage schemas or dual code paths.
10. Keep all user-visible strings safe through DOM APIs; do not interpolate site values into `innerHTML`.

## Required verification

Run:

```bash
npm run check
```

Then load the repository root as an unpacked extension and verify:

- an unenabled site is untouched;
- enabling a site requests only that site's permission;
- disabling restores existing `dir` and extension attributes without refreshing;
- Persian, Arabic, and Hebrew text becomes RTL;
- English, code blocks, sidebars, headers, and tool controls remain unchanged;
- streaming and recycled chat messages are reprocessed without polling;
- popup settings, Re-apply, context-menu actions, and Print / PDF work;
- service-worker restart preserves dynamic registrations.
