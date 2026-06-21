# RTL Fixancer — Agent Guide

## Project overview

RTL Fixancer is a Manifest V3 Chrome extension for multilingual right-to-left text enhancement across the web. It is optimized for AI chat UIs such as ChatGPT, Perplexity, Google AI Studio, Gemini, and DeepSeek, while remaining usable on normal websites.

- **Version:** 3.5
- **Manifest:** MV3, content scripts at `document_start`, `all_frames: true`
- **Default popup UI language:** English
- **Supported RTL text:** Persian/Farsi, Arabic, Hebrew
- **License:** CC BY-NC-ND 4.0
- **Repo:** https://github.com/Nishef1/RTL-Fixancer

## Runtime architecture

### Background service worker

File: `background.js`

Responsibilities:

- Context menu creation
- Current-domain toggle
- Re-apply action
- PDF export fallback
- Icon state updates
- Subdomain-aware enabled-site matching
- Safe script injection only on `http:` and `https:` URLs

Important: `CONTENT_SCRIPT_FILES` must stay in sync with the manifest content-script chain.

### Content script chain

Manifest order matters:

1. `rtl-common.js`
2. `languages/arabic.js`
3. `languages/hebrew.js`
4. `content.js`
5. `content-patch.js`
6. `content-rtl-upgrade.js`
7. `content-ui-guard.js`

### Shared RTL helpers

File: `rtl-common.js`

Responsibilities:

- Register RTL language configs.
- Detect available RTL language modules.
- Apply shared RTL typography behavior.
- Avoid duplicating detection/styling logic inside language-specific files.

### Language modules

Files:

- `languages/arabic.js`
- `languages/hebrew.js`

These files should only register language config through `window.RTLFixancerCommon.registerLanguage(...)`. Do not duplicate core processing logic here.

### Legacy core engine

File: `content.js`

This is the large legacy engine. It still contains the main class `RTLAIStudioManager` and handles most site-specific processing, PDF export, observers, and messaging.

Treat this file as fragile. Prefer small patch files over broad edits.

### Compatibility patches

Files:

- `content-patch.js`: subdomain-aware runtime patch and legacy compatibility fixes.
- `content-rtl-upgrade.js`: generic multilingual RTL upgrade for safe text-leaf elements only.
- `content-ui-guard.js`: protects host-app UI controls such as `Called tool`, `Thought for`, sidebars, nav labels, composer controls, and tool metadata from being forced RTL.

### Popup UI

Files:

- `popup.html`
- `popup.js`
- `popup-patch.js`
- `ui-i18n.js`

The popup defaults to English. UI strings should live in `ui-i18n.js`, not be duplicated across popup markup and logic. Persian strings may remain as translations, but English is the default.

## Configuration keys

Stored in `chrome.storage.sync`:

| Key | Type | Default | Purpose |
| --- | --- | --- | --- |
| `isEnabled` | boolean | `true` | Master runtime flag |
| `selectedFont` | string | `vazir` | `vazir`, `shabnam`, or `default` |
| `fontSize` | string | `default` | `default`, `small`, `medium`, `large` |
| `detectionMode` | string | `medium` | Detection sensitivity |
| `enabledSites` | string[] | `[]` | Enabled hostnames |
| `uiLanguage` | string | `en` | Popup UI language |

## Hard safety rules

### Do not over-apply RTL

Never apply RTL styles to structural containers such as:

- `div`
- `main`
- `section`
- `article`
- `nav`
- `header`
- `footer`
- `aside`
- `button`
- sidebars
- topbars
- composer controls
- tool-call metadata

Only apply generic RTL upgrades to safe text-leaf elements with direct RTL text.

### Keep host UI LTR

Host-app UI labels like `Called tool`, `Thought for`, `Sources`, `Share`, sidebar entries, and composer controls must remain LTR even when nearby assistant text is RTL.

Use `content-ui-guard.js` for this behavior.

### Keep background and manifest script chains synchronized

When adding/removing a content script, update both:

- `manifest.json` content script list
- `background.js` `CONTENT_SCRIPT_FILES`

### Avoid broad `host_permissions`

The extension should avoid broad `host_permissions`. Runtime behavior is controlled by the enabled-site list and supported user-triggered scripting paths.

### Be careful with `content.js`

`content.js` is historically fragile and large. Avoid large refactors unless there is live browser verification. Prefer isolated patch files for targeted compatibility behavior.

## Known historical failure pattern

Previous optimization attempts failed because scripts performed broad string replacements against the large `content.js` file without verifying the final runtime behavior. Future changes must avoid blind multi-replacement refactors and must verify the extension inside Chrome.

## Manual QA checklist

After any runtime change:

1. Reload unpacked extension from `chrome://extensions`.
2. Hard-refresh ChatGPT.
3. Verify sidebar and topbar remain LTR.
4. Verify `Called tool`, `Thought for`, `Sources`, and composer controls remain LTR.
5. Verify Persian assistant/user content is RTL.
6. Verify Arabic text is RTL.
7. Verify Hebrew text is RTL.
8. Verify code blocks remain LTR.
9. Verify popup text is English by default.
10. Verify Re-apply and PDF actions still work.
11. Verify a protected page such as `chrome://extensions` fails gracefully.
12. Verify subdomain matching: enabling `example.com` covers `sub.example.com`.
