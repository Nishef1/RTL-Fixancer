# RTL Fixancer

RTL Fixancer is a private, per-site Chrome extension that improves Persian, Arabic, and Hebrew typography without sending page content anywhere.

## Permissions and site activation (4.1.9)

Chrome receives HTTP/HTTPS host access once during installation or a version update, eliminating repeated Allow prompts when enabling new domains. Chrome may request approval for this new permission once.

- No static `<all_urls>` content script.
- Broad host capability does **not** automatically process every website.
- Chrome site-access controls can still restrict individual sites.
- Content scripts are registered dynamically for enabled hostnames.
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
- Per-site activation and enabled-site management without repeated Chrome permission prompts.
- Optimized adapters for X (Twitter), ChatGPT, Gemini, Google AI Studio, Perplexity, and DeepSeek.
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

RTL Fixancer works locally. It does not include analytics, remote code, network APIs, or page-content uploads. Chrome grants broad HTTP/HTTPS host capability at installation (or after approving an update), but RTL Fixancer registers scripts only for hostnames explicitly enabled by the user. Chrome's own site-access controls remain available.

The only web-accessible files are the bundled Vazir and Shabnam font files.

## Project structure

```text
background.js        Host-access checks, registrations, context menus, and icons
content.js           Reversible, event-driven page runtime
lib/core.js          Shared settings, domain, and language-detection logic
popup.html/css/js    Accessible extension popup
scripts/validate.mjs Repository architecture and security validation
tests/               Node unit tests
docs/extension-audit.md Architecture and release verification notes
```

## License

See [LICENSE](LICENSE).

