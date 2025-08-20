## RTL Fixancer

Improve and right-align Persian (Farsi) text across the web. RTL Fixancer is a Chrome Extension that detects language per element, switches direction and alignment (RTL/LTR), and applies clean Persian fonts. It is optimized for AI chat UIs and can export chats/pages to PDF while preserving fonts and layout.

### Highlights
- **Smart detection**: Per-element language detection (Persian vs English) with adjustable sensitivity.
- **Automatic direction**: Applies `direction` and alignment (RTL/LTR) with `unicode-bidi: isolate` for mixed text.
- **Beautiful Persian fonts**: Ships WOFF2 versions of Vazir/Shabnam for fast loading; applied only to detected Persian content.
- **AI chat optimized**: Site-specific handling for Perplexity, Google AI Studio, and ChatGPT to avoid breaking layout while fixing text.
- **One-click PDF**: Export chat content (or full page) to a print-ready view that preserves fonts, RTL/LTR, and page breaks.
- **SPA aware**: Watches pushState/replaceState/popstate/hashchange and re-applies on route changes.
- **Fast and safe**: Uses MutationObserver + idle work; skips code blocks and structural containers.
- **Per-site enable**: Toggle the current site right from the popup or context menu; changes apply instantly.

### Supported sites (best experience)
- `perplexity.ai`
- `aistudio.google.com` / `makersuite.google.com`
- `chat.openai.com` / `chatgpt.com`
- All sites you want

Works generally on most websites for typical text content as well.

## Install

### Chrome Web Store
Coming soon.

## Usage
- Use the popup to toggle the current site, pick a font (Vazir/Shabnam/Default), and set detection sensitivity.
- Click “PDF” in the popup to export chat or page content to a print window. Use the browser print dialog to save as PDF.
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
- MutationObserver + periodic idle checks to catch late content.
- SPA route watcher via history hooks and events.
- Site-specific selectors to avoid changing headers/sidebars on complex UIs.

## Roadmap (ideas)
- More site profiles (e.g., other chat/work apps).
- Keyboard shortcuts for Toggle/Export.
- Optional on-page highlight of processed elements for debugging.

## Contributing
Issues and PRs are welcome. Please describe the site/URL and include screenshots if reporting layout problems.

## License
AGPL-3.0 — see `LICENSE`.

## Donate
If this project helps you, consider a small donation. Thank you!


```
Wallet: 0x5ba08cc1429bead9c07dc2030b881c6ed33c3a00
```

## Links
- GitHub: https://github.com/Nishef1/RTL-Fixancer


