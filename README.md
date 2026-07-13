# RTL Fixancer

RTL Fixancer is a private, per-site Chrome extension that improves Persian, Arabic, and Hebrew typography without sending page content anywhere.

## What changed in 4.0

Version 4.0 replaces the legacy all-site runtime with a permission-first architecture:

- No static `<all_urls>` content script.
- No permanent access to every website at install time.
- Chrome asks for access only when the user enables a site.
- Content scripts are registered dynamically for enabled domains.
- Only the top frame is processed.
- One event-driven `MutationObserver` replaces recurring DOM polling.
- Every changed attribute is captured and restored when the site is disabled.
- Legacy patch files and runtime monkey-patching have been removed.
- Print / Save as PDF uses the browser's native print flow and no longer scrolls through infinite pages.

## Features

- Persian, Arabic, and Hebrew detection.
- Safe handling of mixed RTL/LTR text.
- Vazir, Shabnam, or the website's own font.
- Adjustable font size and detection sensitivity.
- Per-site permissions and enabled-site management.
- Optimized adapters for ChatGPT, Gemini, Google AI Studio, Perplexity, and DeepSeek.
- Code blocks and host navigation controls remain LTR.
- English and Persian popup UI.

## Install for development

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the repository root.
5. Open a normal HTTP/HTTPS page, click RTL Fixancer, and enable that site.

Chrome 120 or newer is required.

## Verification

Node.js 22 or newer is required for repository checks.

```bash
npm run check
```

This runs manifest/source validation and the core unit tests. After runtime changes, also verify the extension manually in Chrome on a generic page and each supported AI chat UI.

## Privacy and security

RTL Fixancer works locally. It does not include analytics, remote code, network APIs, or page-content uploads. Host access is optional and requested only for domains explicitly enabled by the user.

The only web-accessible files are the bundled Vazir and Shabnam font files.

## Project structure

```text
background.js        Permission, registration, context-menu, and icon controller
content.js           Reversible, event-driven page runtime
lib/core.js          Shared settings, domain, and language-detection logic
popup.html/css/js    Accessible extension popup
scripts/validate.mjs Repository architecture and security validation
tests/               Node unit tests
docs/extension-audit.md Architecture and release verification notes
```

## License

See [LICENSE](LICENSE).

## Donate

If this project helps you, donations are welcome:

```text
0x5ba08cc1429bead9c07dc2030b881c6ed33c3a00
```
