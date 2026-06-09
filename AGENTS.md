# RTL Fixancer — Agent Guide

## Project Overview

Chrome Extension (Manifest V3) for intelligent Persian/Farsi text RTL detection, direction fixing, and font enhancement across the web. Optimized for AI chat UIs (Perplexity, Google AI Studio, ChatGPT).

- **Version:** 3.4 (post bug-fix pass)
- **Manifest:** MV3, content script at `document_start`, runs in `all_frames`
- **License:** CC BY-NC-ND 4.0
- **Repo:** https://github.com/Nishef1/RTL-Fixancer

---

## Architecture (3 Layers)

### 1. Background Service Worker (`background.js`)

Persistent event-driven service worker. Handles:

- **Context menus** — 4 items under "RTL Fixancer" parent: toggle domain, re-apply, export PDF
- **Icon management** — Debounced icon updates per tab (on/off based on `enabledSites`), listening to `onActivated`, `onUpdated`, `onRemoved`, `storage.onChanged`
- **Message routing** — Listens for `heartbeat` (pings from content script) and `captureVisible` (PDF capture)
- **PDF export** — Multi-fallback strategy: content script → injected script → native `window.print()` → `javascript:` new tab
- **Subdomain matching** — `hostnameMatch()` supports exact + subdomain matching

**Key functions:** `getSyncStorage`, `setSyncStorage`, `createContextMenus`, `hostnameMatch`, `getIconPaths`, `debounceUpdateIcon`, `updateIconForTab`

### 2. Content Script (`content.js`)

Single class `RTLAIStudioManager` — the core engine. Injected at `document_start` into all frames.

**Lifecycle:**
1. `constructor()` → loads settings → detects current site (AI Studio / Perplexity / ChatGPT / generic)
2. `startExtension()` → if site enabled: injects fonts, sets up MutationObserver, processes all content
3. Periodic timers: force processing (2s), per-site checks (500ms-1s), heartbeats (30s)
4. Responds to messages: `ping`, `updateSettings`, `smoothReprocess`, `fullReload`, `exportPdf`

**Key methods:**

| Method | Purpose |
|--------|---------|
| `detectLanguage(text)` | Returns `'persian'` / `'english'` / `'unknown'` using ratio-based threshold + keyword fallback |
| `hasAnyPersianChar(text)` | Quick regex check for Persian Unicode range |
| `processElement(element)` | Core method: detects language, sets `data-ai-rtl-persian-text` or `data-ai-rtl-english-text` attribute |
| `isSafeElementForProcessing(element)` | Filters: skips code blocks, layout containers, sidebars, nav, editable composers |
| `isAbsolutelySafeForRTL(element)` | Additional safety check for DIVs (viewport size, child count limits) |
| `setupSmartObserver()` | MutationObserver on `document.body` with debounced batch processing (50ms) |
| `setupSmartInputHandler(input)` | Attaches `input`/`keyup`/`paste`/`composition*` handlers to editable fields for real-time RTL |
| `injectPersianFonts()` | Injects `<style id="ai-rtl-fonts">` with Vazir/Shabnam @font-face + RTL CSS |
| `generateOptimizedCSS()` | Produces CSS for Persian elements, inputs, code blocks, Perplexity-specific selectors |
| `fullReload()` / `cleanup()` | Complete reload (re-process all) / teardown (disconnect observers, clear caches) |
| `exportPdf()` | Opens a print-friendly window with all RTL fixes applied |
| `_setupSiteMonitoring(name, method, interval, emergency)` | Generic periodic checker for site-specific processing |

**Site-specific methods:**
- `processAIStudioSpecialElements()` — Google AI Studio chat containers
- `processPerplexitySpecialElements()` — Perplexity prose/answer containers
- `processChatGPTSpecialElements()` — ChatGPT conversation turns + markdown

**SPA handling:**
- Hooks `history.pushState` / `history.replaceState`, listens to `popstate` / `hashchange`
- Polls URL every 500ms for changes via `setupSpaUrlWatcher()`

### 3. Popup (`popup.html` + `popup.js`)

Class `PopupManagerInstantTrigger` — 340px wide popup UI.

**UI sections:**
- **Header** — Title, GitHub/donate icon buttons, connection status badge (connected/disconnected/policy-restricted)
- **Current Site** — Domain name, on/off toggle switch, re-apply button, PDF export button
- **Settings** — Font (Vazir/Shabnam/Default), Font size (Default/Small/Medium/Large), Detection sensitivity (High/Medium/Low) — displayed in a single horizontal row
- **Sites List** — Scrollable list of enabled domains with delete buttons

**Key methods:**

| Method | Purpose |
|--------|---------|
| `checkPolicyRestrictions()` | Detects browser policy blocks (ExtensionsSettings, protected pages) |
| `loadSettings()` / `updateSetting(key, value)` | Read/write `chrome.storage.sync` with timeout handling |
| `sendMessageToContent(action, data, timeout)` | Messaging with auto-injection fallback + policy error detection |
| `triggerImmediateApply()` / `triggerFullReload()` | Send settings updates to content script |
| `checkConnectionStatus()` | Ping content script with retry logic + auto-injection |
| `ensureContentScriptReady()` | Inject + wait for content script to become responsive |

---

## Key Module Files (`lib/`)

> **Note:** The `lib/` directory files exist but are **NOT loaded by the manifest**. The manifest only loads `content.js` (and `lib/print-helper.js` for PDF). All core logic lives directly in `content.js`. The `lib/` files are reference/source-of-truth only. See [Optimization Failure Chain](#-optimization-failure-chain-documented) below for why.

> **The `lib/` files are outdated snapshots.** The actual running code is always in `content.js`. Do not modify `lib/` files expecting behavior changes — they are not loaded by the manifest (except `lib/print-helper.js`).

### `lib/detector.js`
Pure functions — no DOM access. Exports:
- `hasAnyPersianChar(text)`, `hashText(text)`, `simpleHash(str)`
- `hasPersianKeywords(text)` — 30+ Persian keyword matcher
- `getDetectionThreshold(mode)` — maps `high`(0.25) / `medium`(0.4) / `low`(0.6)
- `createBoundedCache(maxSize)` — LRU-like bounded Map cache
- `detectLanguage(text, threshold, langCache)` — Full detection pipeline
- `generateElementSignature(element, text)` — Unique element fingerprint

### `lib/observer.js`
Browser API wrappers:
- `isScrollContainer`, `createMutationObserver`, `createIntersectionObserver`
- `createScrollHandler(callback)` — Debounced scroll listener (200ms)
- `createSpaUrlWatcher(onUrlChange)` — History API hook + URL polling
- `attachElementRemovalObserver(element, onRemove)` — Auto-cleanup when nodes leave DOM

### `lib/processor.js`
DOM processing utilities:
- `getCleanText`, `isCodeRelatedElement`, `isInsideEditableComposer`, `isLayoutContainer`, `isSafeElementForProcessing`, `isAbsolutelySafeForRTL`
- `getFontFamily`, `getFontSize` — Map config to CSS values
- `generateOptimizedCSS` — Full CSS generator for RTL + fonts
- `injectPersianFonts`, `removeFontStyles`, `removeAllRTLAttributes`
- `findEditableLeaf` — Finds the real editable element inside wrappers

---

## Configuration (`chrome.storage.sync`)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `isEnabled` | boolean | `true` | Master toggle |
| `selectedFont` | string | `'vazir'` | `vazir` / `shabnam` / `default` |
| `fontSize` | string | `'default'` | `default` / `small`(12px) / `medium`(16px) / `large`(18px) |
| `detectionMode` | string | `'medium'` | `high`(25%) / `medium`(40%) / `low`(60%) persian ratio threshold |
| `enabledSites` | string[] | `[]` | Array of hostnames where extension is active |

---

## Messaging Protocol

### Content → Background (`chrome.runtime.sendMessage`)
- `{ action: 'heartbeat', domain, stats }` — Periodic status (30s)
- `{ action: 'captureVisible' }` — Request tab screenshot (for PDF)

### Popup → Content (`chrome.tabs.sendMessage`)
- `{ action: 'ping' }` — Connection check (response: `{ success: true, stats }`)
- `{ action: 'updateSettings', ...config }` — Apply font/size changes
- `{ action: 'smoothReprocess', settings: { detectionMode } }` — Change sensitivity
- `{ action: 'fullReload', ...config }` — Complete re-initialization
- `{ action: 'exportPdf' }` — Trigger PDF export

---

## Detection Algorithm

1. **Normalize** text (NFKC, strip numbers/whitespace/punctuation/symbols/control chars)
2. **Count** Persian chars (`\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF`) vs English (`[a-zA-Z]`)
3. **Ratio check:** if Persian/total >= threshold → Persian
4. **Short text fallbacks** (< 10 chars: Persian if any Persian char; < 20 chars: Persian keyword match)
5. **Cached** via bounded Map (200 entries max) by text hash
6. **Per-site overrides:** Perplexity main content always favors Persian

---

## CSS Strategy

- **Data attributes** `[data-ai-rtl-persian-text="true"]` trigger CSS rules
- **@font-face** for VazirAIStudio and ShabnamAIStudio (WOFF2, bundled)
- **Code blocks** forced LTR (`font-family: Consolas, Monaco, monospace`)
- **List containers** get `padding-inline-start: 1.5em` for RTL bullets
- **Inline `!important` styles** applied in addition to CSS for cross-site compatibility
- **Fallback fonts** (Tahoma, Arial) injected if WOFF2 fonts fail to load

---

## ⚠️ Optimization Failure Chain (DOCUMENTED)

This section documents the **exact sequence of failures** that occurred when optimizing `content.js`, so future agents never repeat these mistakes.

### What Happened (6 commits, 3 reverts)

| Commit | What was attempted | What went wrong |
|--------|-------------------|-----------------|
| `3ebe9cb` | DRY refactor: extract `PERSIAN_REGEX`, `CHAT_CONTAINER_SELECTORS`, `TEXT_TAGS_NEG_SELECTOR` constants into module scope | Node.js apply scripts (`apply-fixes.js`) reported "SUCCESS" for all 13 patches but **12 of 13 silently failed** due to `\r\n` vs `\n` line-ending mismatch. Constants were **referenced** in code but **never declared**. |
| `e9f6ef5` | Performance: precompute selectors, WeakMap cache for `isSafeElementForProcessing`, early-returns in hot loops | Built on broken foundation from `3ebe9cb`. Added more references to undefined constants (`PERSIAN_REGEX` in `processElement`, `hasAnyPersianChar`; `TEXT_TAGS_NEG_SELECTOR` in `observeExistingElements`). |
| `de2770d` | Relax `isAbsolutelySafeForRTL` child limit for inline tags | Also built on broken foundation. |
| `bfe95eb` | Emergency fix: add missing constants at module level | **Still broken** — the constants were added but other issues from the cascade remained (e.g., line-ending artifacts in the file itself). |
| `8dee14b` | **REVERT** content.js to `fc4d556` (last known working) | ✅ Extension works again |

### Root Causes

1. **`str_replace` tool fails silently on 123K-char files** — the file exceeds the 100,000 char limit, so multi-replacement patches are truncated. The tool returns "String replace applied successfully" but the patch was never actually applied.

2. **Node.js string-replace scripts are unreliable on Windows** — `\r\n` (CRLF) line endings cause `code.replace(old, new)` to fail when the `old` string uses `\n` (LF). The scripts reported "SUCCESS" because they caught exceptions but didn't verify the replacement actually happened.

3. **Cascading commits on broken foundation** — each subsequent commit (`e9f6ef5`, `de2770d`) added more code that referenced the undefined constants, making the eventual fix harder.

4. **No runtime verification** — `node -c content.js` (syntax check) passes even when constants are referenced but never declared, because `node -c` only checks syntax, not runtime correctness. A ReferenceError only manifests in the browser.

### Rules for Safe Optimization of `content.js`

> **These rules are MANDATORY for any agent modifying `content.js`.**

#### Rule 1: NEVER use Node.js string-replace scripts
The `apply-fixes.js` / `apply-perf.js` pattern is **banned**. These scripts silently fail on Windows due to CRLF line endings and give false-positive results.

**Instead:** Use the `str_replace` tool for small, targeted changes (< 5 edits per call). For large refactors, rewrite the entire file with `write_file`.

#### Rule 2: NEVER extract constants without verifying they land in the file
If you add a `const X = ...` at the top of `content.js`, you MUST verify it actually appears in the file afterward:
```bash
grep -c 'const X = ' content.js  # must return >= 1
```

#### Rule 3: ALWAYS verify with a LIVE runtime check, not just `node -c`
After any change to `content.js`, run:
```bash
node -e "const fs=require('fs'); const c=fs.readFileSync('content.js','utf8'); const m=c.match(/\\bconst\\s+(\\w+)\\s*=/g); const r=c.match(/\\b(\\w+)\\b/g); const defined=new Set(m?.map(x=>x.match(/const\\s+(\\w+)/)[1])); const used=new Set(); const re=/[^.]\\b([A-Z_][A-Z0-9_]*)\\b/g; let match; while((match=re.exec(c))!==null){if(match[1].length>2)used.add(match[1])} const missing=[...used].filter(u=>!defined.has(u)); if(missing.length){console.log('UNDEFINED:',missing);process.exit(1)} else console.log('ALL CONSTANTS DEFINED')"
```
Or more simply: load the extension in Chrome and check DevTools console for `ReferenceError`.

#### Rule 4: Make ONE change, verify, commit, then make the next
Never batch multiple optimization commits without verifying the previous one works in the browser. The failure chain happened because 3 commits were made on a broken foundation.

#### Rule 5: The file is a SINGLE monolithic script — no modules
`content.js` is NOT an ES module. It's a classic script injected via `manifest.json`. There are no `import`/`export` statements. All code lives in a single scope wrapped by the `if (window.RTLAIStudioManager) { ... } else { ... }` guard. The `lib/` files exist as reference but are not loaded.

#### Rule 6: Line endings are CRLF (`\r\n`)
The file uses Windows-style CRLF line endings. Any string matching or replacement must account for this.

#### Rule 7: `isAbsolutelySafeForRTL` child limits are tuned, not arbitrary
- **DIVs:** `children.length > 8` — catches layout containers
- **Inline tags (P, SPAN, H1-H6, LI, TD, TH, BLOCKQUOTE):** `children.length > 50` — relaxed limit since inline tags can have many `<code>`, `<strong>`, `<a>` children in chat output. ✅ Fixed in `fe0b794`.
- **`blockChildren > 4`** — catches paragraphs containing actual block-level elements

#### Rule 8: `TEXT_TAGS_SELECTOR` is the single source of truth for tag lists
All querySelector calls should reference `TEXT_TAGS_SELECTOR` (defined at the top of the file) rather than hardcoding tag lists. If you need a different subset, derive it from `TEXT_TAGS_SELECTOR`.

---

## Adding a New Site Profile

1. Add `detect<Site>()` method in `RTLAIStudioManager`
2. Add `process<Site>SpecialElements()` method
3. Register in `startExtension()` / `fullReload()` via `_setupSiteMonitoring()`
4. Add site-specific CSS selectors in `generateOptimizedCSS()` if needed
5. Optionally add host pattern to `manifest.json` `host_permissions`
6. Consider adding `is<Site>` checks in `isSafeElementForProcessing()` for containment

---

## Common Pitfalls

- **Policy restrictions:** Some enterprise browsers block content script injection. Always handle `ExtensionsSettings policy` / `Cannot access contents` errors gracefully
- **SPA navigations:** URL polling + history hooks are both needed — some SPAs only trigger one
- **Chat composers:** Editable fields inside complex wrappers need `findEditableLeaf()` to find the real input
- **DIVs as layout containers:** Large DIVs (>80vw, >60vh, or >8 children) are skipped to avoid breaking page layout
- **CRLF line endings:** The file uses `\r\n`. Any programmatic string manipulation must account for this.
- **File size (125K+ chars):** The `str_replace` tool truncates files over 100K chars. Use `write_file` for large rewrites or apply changes in very small batches.

---

## Recent Fixes (this session)

All originally documented known bugs have been fixed:

| Commit | Fix | Impact |
|--------|-----|--------|
| `fe0b794` | `isAbsolutelySafeForRTL` child limit split: DIVs keep `> 8`, inline tags get `> 50` | Paragraphs with many `<code>`/`<strong>` children now get RTL'd |
| `a799bac` | `immediateProcessAllContent` uses `TEXT_TAGS_SELECTOR` instead of hardcoded 11 tags | Initial full-page scan now covers all 44 text-bearing tags |
| `5e4218f` | `generateOptimizedCSS` generates CSS rules for all 44 tags | Elements like `<a>`, `<button>`, `<em>`, `<strong>` now get RTL styling |
| `15ce3ca` | Perplexity CSS selectors simplified to wildcard `[data-ai-rtl-persian-text]` inside containers | All tagged elements in Perplexity answers get container-scoped CSS rules |
| `81db81c` | Removed duplicate `setupIntersectionObserver`; wildcard selectors in all `process*SpecialElements` | Dead code removed; all 44 tags covered in site-specific processing |
| `960b16e` | `_recheckElements` limited selector lists replaced with `TEXT_TAGS_SELECTOR` and wildcards | Recheck covers all 44 tags, not just p/span/div |
| `8dcebda` | `_recheckElements` attribute selectors inverted: `:not([data-ai-rtl-persian-text])` instead of `[data-ai-rtl-persian-text]` | Critical logic fix — recheck was a complete no-op for Perplexity and ChatGPT |
| (latest) | `process*SpecialElements` wildcards narrowed to text-bearing tags via `buildContainerSelector` helper | Avoids matching `<script>`, `<img>`, `<br>`, `<svg>` in hot paths |
| (latest) | Removed `processInputsOptimized` duplicate, replaced with `processInputs` | DRY fix — `processInputs` is a strict superset |
| (latest) | Extracted `PERSIAN_REGEX` module-level constant, removed `processChatGPTInputs` duplicate, cleaned 12 verbose `console.log` calls | DRY + cleanup — 17 insertions, 38 deletions |

## Known Remaining Bugs

✅ **All originally documented bugs are now fixed.** No remaining known bugs.

**Potential future improvements** (not bugs):
- Extract `buildContainerSelector` from module scope into a class static method (minor cleanup)
- `processInputs` could use `TEXT_TAGS_SELECTOR`-based input selectors instead of hardcoded lists

---

## Development Guidelines

### Code Style
- No build tool — plain script injected via manifest
- `content.js` uses a single `RTLAIStudioManager` class wrapped in singleton guard
- `popup.js` uses `PopupManagerInstantTrigger` class
- JSDoc comments for public methods
- Persian comments throughout (codebase is bilingual)

### Testing
- No test suite currently. Manual testing via Chrome DevTools
- **Always reload the extension** in `chrome://extensions` (toggle off → on) after changes
- **Always hard-refresh** the target page (`Ctrl+Shift+R`) after changes
- Check DevTools console for `[RTL]` logs and any `ReferenceError` / `TypeError`
