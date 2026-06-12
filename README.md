## RTL Fixancer

Improve and right-align Persian (Farsi) text across the web. RTL Fixancer is a Chrome Extension that detects language per element, switches direction and alignment (RTL/LTR), and applies clean Persian fonts. It works on **all websites** and is optimized for AI chat UIs. Can export chats/pages to PDF while preserving fonts and layout.

![RTL Fixancer Popup Interface](images/Interface.png)

### Highlights
- **Works everywhere**: Enable on any website with one click. No site-specific configuration needed.
- **Smart detection**: Per-element language detection (Persian vs English) with adjustable sensitivity.
- **Automatic direction**: Applies `direction` and alignment (RTL/LTR) with `unicode-bidi: isolate` for mixed text.
- **Beautiful Persian fonts**: Ships WOFF2 versions of Vazir/Shabnam for fast loading; applied only to detected Persian content.
- **AI chat optimized**: Enhanced handling for Perplexity, Google AI Studio, ChatGPT, and DeepSeek.
- **One-click PDF**: Export chat content (or full page) to a print-ready view that preserves fonts, RTL/LTR, and page breaks.
- **SPA aware**: Watches pushState/replaceState/popstate/hashchange and re-applies on route changes.
- **Fast and safe**: Uses MutationObserver + `requestIdleCallback` for non-urgent work; skips code blocks and structural containers.
- **Modern JavaScript**: Built with 2026 patterns — `AbortController` for automatic event cleanup, `requestIdleCallback` for idle-time processing, `[...spread]` operators, and `structuredClone()` for deep comparisons.
- **Per-site enable**: Toggle the current site right from the popup or context menu; changes apply instantly.

### Works on all websites
RTL Fixancer works on **any website** you visit. Simply enable it for the current site using the popup toggle or right-click context menu. While it has enhanced support for AI chat platforms, the core RTL detection and font styling works universally.

**Enhanced support for:**
- `perplexity.ai`
- `aistudio.google.com` / `makersuite.google.com`
- `chat.openai.com` / `chatgpt.com`
- `deepseek.com`
- `gemini.google.com`
- And any other website with Persian/Farsi text!

## Install

### Chrome Web Store
Coming soon.

### Manual (developer) install
1) Download or clone this repository.
2) Open Chrome and go to `chrome://extensions`.
3) Enable "Developer mode".
4) Click "Load unpacked" and select the extension folder (the repo root that contains `manifest.json`).
5) Pin the extension and open a supported site. Use the popup to enable the current site and configure fonts/sensitivity.

## Usage
- Use the popup to toggle the current site, pick a font (Vazir/Shabnam/Default), and set detection sensitivity.
- Click "PDF" in the popup to export chat or page content to a print window. Use the browser print dialog to save as PDF.
- Right-click context menu provides quick actions (toggle site, re-apply, export PDF).

## Permissions
- `storage` for saving settings (font, size, detection mode, enabled sites).
- `activeTab`, `scripting`, `tabs`, `contextMenus` for injecting the content script, capturing visible tab during full-page export, and context menu actions.
- `host_permissions: <all_urls>` so text can be fixed across sites (actual behavior is per-site toggled by you).

## Privacy
- No analytics. No external servers. All processing happens locally in your browser.
- Fonts are bundled (WOFF2) and loaded from the extension package, not the network.
- PDF export uses the system print dialog; if needed, full-page capture uses `chrome.tabs.captureVisibleTab` locally.

## Development
- Manifest V3, content script injected at `document_start`.
- MutationObserver + `requestIdleCallback` for idle-time processing of late content.
- SPA route watcher via history hooks and events.
- Site-specific selectors to avoid changing headers/sidebars on complex UIs.
- `AbortController` for automatic event listener cleanup on teardown.
- Block vs inline element CSS separation to prevent text wrapping issues.

## Architecture
- **Content script** (`content.js`): Core RTL detection engine with `RTLAIStudioManager` class.
- **Background service worker** (`background.js`): Context menus, icon management, PDF export.
- **Popup** (`popup.html` + `popup.js`): Settings UI with site toggle, font/sensitivity controls.
- **Print helper** (`lib/print-helper.js`): PDF export support.

## Roadmap (ideas)
- More site profiles (e.g., other chat/work apps).
- Keyboard shortcuts for Toggle/Export.
- Optional on-page highlight of processed elements for debugging.

## Contributing
Issues and PRs are welcome. Please describe the site/URL and include screenshots if reporting layout problems.

## License
CC BY-NC-ND 4.0 — see `LICENSE`.

## Donate
If this project helps you, consider a small donation. Thank you!

```
Wallet: 0x5ba08cc1429bead9c07dc2030b881c6ed33c3a00
```

## Links
- GitHub: https://github.com/Nishef1/RTL-Fixancer
- [فارسی (Persian)](README.fa.md) - نسخه فارسی برای کاربران ایرانی


