(() => {
    'use strict';

    const INSTANCE_KEY = '__RTL_FIXANCER_RUNTIME_V4__';
    const Core = globalThis.RTLFixancerCore;
    if (!Core) return;
    const RUNTIME_VERSION = Core.version || 'unknown';

    const existingRuntime = globalThis[INSTANCE_KEY];
    if (existingRuntime) {
        if (existingRuntime.version === RUNTIME_VERSION) {
            void existingRuntime.restart();
            return;
        }
        try {
            existingRuntime.cleanup?.({ keepRuntimeListeners: false });
        } catch (_) {}
        delete globalThis[INSTANCE_KEY];
    }

    const STORAGE_KEY = 'settings';
    const MARK_ATTR = 'data-rtl-fixancer';
    const LANGUAGE_ATTR = 'data-rtl-fixancer-language';
    const INPUT_ATTR = 'data-rtl-fixancer-input';
    const LIST_ATTR = 'data-rtl-fixancer-list';
    const LTR_ATTR = 'data-rtl-fixancer-ltr';
    const OWNED_ATTRIBUTES = [MARK_ATTR, LANGUAGE_ATTR, INPUT_ATTR, LIST_ATTR, LTR_ATTR, 'dir'];

    // The engine is site-agnostic: it follows text nodes that contain RTL
    // characters up to their nearest non-inline ancestor (the text block) and
    // classifies that block. No site-specific selectors are needed, so host
    // redesigns (ChatGPT, Grok, X, Gemini...) do not break detection.
    const INLINE_TAGS = new Set([
        'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'data', 'del', 'dfn', 'em', 'font', 'i', 'ins',
        'label', 'mark', 'q', 's', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var'
    ]);
    // Subtrees that are never read or modified.
    const SKIP_TAGS = new Set([
        'script', 'style', 'noscript', 'template', 'pre', 'code', 'kbd', 'samp',
        'svg', 'math', 'canvas', 'video', 'audio', 'iframe', 'object', 'embed',
        'textarea', 'input', 'select', 'option', 'button',
        'nav', 'header', 'footer', 'aside', 'menu'
    ]);
    const SKIP_SELECTOR = [
        ...SKIP_TAGS,
        '[role="navigation"]', '[role="banner"]', '[role="toolbar"]',
        '[role="menu"]', '[role="menubar"]', '[role="tablist"]', '[role="button"]',
        '[aria-hidden="true"]', '[data-rtl-fixancer-ignore]',
        '[contenteditable]:not([contenteditable="false"])', '[role="textbox"]',
        '.CodeMirror', '.cm-editor', '.monaco-editor', '.ace_editor'
    ].join(',');
    // Match whole class names only. Substring matches such as
    // [class*="code-block"] hit Tailwind variants like
    // `[&_[data-streamdown=code-block]]:border-0` on Grok's response
    // container and silently skipped every message.
    const UI_CLASS_RE = /(?:^|\s)(?:[\w-]*[-_])?(?:sidebar|navbar|topbar|toolbar|breadcrumbs?|pagination)(?:[-_][\w-]*)?(?=\s|$)/i;
    // Elements whose content model is phrasing text: always a text block,
    // even when a host nests a widget (e.g. a ChatGPT citation chip) inside.
    const TEXT_BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dt', 'dd', 'figcaption', 'caption', 'summary']);
    // Block descendants that make an element a layout container rather than a
    // text block. Containers are never marked (lists excepted, see syncList).
    const NESTED_BLOCK_SELECTOR = [
        'div', 'p', 'section', 'article', 'main', 'table', 'ul', 'ol', 'dl', 'form', 'pre',
        'blockquote', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'nav', 'header', 'footer', 'aside'
    ].join(',');
    // Hosts also use <li> for whole chat messages (ChatGPT renders the thread
    // as an <ol>). Such an item holds headings, tables, code or many
    // paragraphs; it is a container and must never become an RTL list item.
    const LIST_ITEM_CONTAINER_SELECTOR = [
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'pre', 'section', 'article',
        'form', 'figure', 'header', 'footer', 'nav', 'aside'
    ].join(',');
    const MAX_LIST_ITEM_PARAGRAPHS = 4;
    const NEVER_BLOCK_TAGS = new Set(['html', 'body', 'main']);
    const LIST_SELECTOR = 'ol, ul, [role="list"]';
    const INLINE_SELECTOR = [...INLINE_TAGS].join(',');
    const EDITABLE_SELECTOR = [
        'textarea',
        'input:not([type])',
        'input[type="text"]',
        'input[type="search"]',
        '[contenteditable]:not([contenteditable="false"])',
        '[role="textbox"]'
    ].join(',');
    const CODE_EDITOR_SELECTOR = 'pre, code, .CodeMirror, .cm-editor, .monaco-editor, .ace_editor';
    // A lone word needs no bidi isolation; hosts that wrap every streamed
    // word in a span (ChatGPT) would otherwise get thousands of writes.
    const SINGLE_WORD_RE = /^\s*[\p{L}\p{M}'’-]+\s*$/u;
    const MARKED_SELECTOR = `[${MARK_ATTR}], [${LTR_ATTR}]`;
    const MAX_BLOCK_TEXT = 4000;
    const MAX_LTR_INLINE_TEXT = 160;
    const FRAME_BUDGET_MS = 8;

    class RTLFixancerRuntime {
        constructor() {
            this.version = RUNTIME_VERSION;
            this.active = false;
            this.settings = Core.DEFAULT_SETTINGS;
            this.observer = null;
            this.styleElement = null;
            this.shadowSheet = null;
            this.shadowRoots = new Set();
            this.pendingNodes = new Set();
            this.pendingBlocks = new Set();
            this.pendingEditors = new Set();
            this.walkers = [];
            this.scheduled = false;
            this.idleHandle = null;
            this.originalState = new WeakMap();
            this.appliedState = new WeakMap();
            this.touchedElements = new Set();
            this.signatures = new WeakMap();

            this.acceptNode = this.acceptNode.bind(this);
            this.onInput = this.onInput.bind(this);
            this.onMutation = this.onMutation.bind(this);
            this.onMessage = this.onMessage.bind(this);
            this.onStorageChanged = this.onStorageChanged.bind(this);
            chrome.runtime.onMessage.addListener(this.onMessage);
            chrome.storage.onChanged.addListener(this.onStorageChanged);
        }

        async loadSettings() {
            const stored = await chrome.storage.sync.get({ [STORAGE_KEY]: Core.DEFAULT_SETTINGS });
            this.settings = Core.normalizeSettings(stored[STORAGE_KEY]);
            return this.settings;
        }

        isAllowed() {
            return Core.siteMatches(this.settings.enabledSites, location.hostname);
        }

        async start() {
            await this.loadSettings();
            if (!this.isAllowed()) {
                this.cleanup();
                return false;
            }
            if (this.active) return true;
            this.activate();
            return true;
        }

        async restart(settings = null) {
            if (settings) this.settings = Core.normalizeSettings(settings);
            else await this.loadSettings();

            this.cleanup({ keepRuntimeListeners: true });
            if (!this.isAllowed()) return false;
            this.activate();
            return true;
        }

        activate() {
            this.active = true;
            this.installStyles();
            this.attachListeners();
            this.observeRoot(document);
            for (const editor of document.querySelectorAll(EDITABLE_SELECTOR)) this.pendingEditors.add(editor);
            this.schedule();
            this.notifyState(true);
        }

        notifyState(active) {
            try {
                const response = chrome.runtime.sendMessage({ type: 'runtime:state', active: Boolean(active) });
                response?.catch?.(() => {});
            } catch (_) {}
        }

        attachListeners() {
            this.observer?.disconnect();
            this.observer = new MutationObserver(this.onMutation);
            document.addEventListener('input', this.onInput, true);
            document.addEventListener('compositionend', this.onInput, true);
            document.addEventListener('focusin', this.onInput, true);
        }

        detachListeners() {
            this.observer?.disconnect();
            this.observer = null;
            document.removeEventListener('input', this.onInput, true);
            document.removeEventListener('compositionend', this.onInput, true);
            document.removeEventListener('focusin', this.onInput, true);
        }

        // Observes a document or open shadow root and queues it for a full,
        // time-sliced text walk. Only `dir` is observed among attributes: it
        // is the one attribute a host can rewrite over our changes. Watching
        // `class`/`style` page-wide is what made busy SPAs like ChatGPT lag.
        observeRoot(root) {
            if (!this.observer) return;
            this.observer.observe(root === document ? (document.documentElement || document) : root, {
                subtree: true,
                childList: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['dir']
            });
            if (root !== document) {
                this.shadowRoots.add(root);
                this.adoptShadowSheet(root);
            }
            this.walkers.push(this.createWalker(root));
            this.schedule();
        }

        createWalker(root) {
            return document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, this.acceptNode);
        }

        acceptNode(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                return Core.hasRtlCharacters(node.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
            }
            if (SKIP_TAGS.has(node.localName)) return NodeFilter.FILTER_REJECT;
            if (node.shadowRoot && !this.shadowRoots.has(node.shadowRoot)) this.observeRoot(node.shadowRoot);
            if (node.hasAttribute('contenteditable') && node.getAttribute('contenteditable') !== 'false') {
                return NodeFilter.FILTER_REJECT;
            }
            if (node.getAttribute('aria-hidden') === 'true' || node.hasAttribute('data-rtl-fixancer-ignore')) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_SKIP;
        }

        buildRules() {
            const fontSize = {
                small: '0.9em',
                medium: '1em',
                large: '1.125em'
            }[this.settings.fontSize];
            const custom = this.settings.selectedFont !== 'default';
            const fontRule = language => custom
                ? `font-family: ${Core.fontStack(this.settings.selectedFont, language)} !important;`
                : '';
            const sizeRule = fontSize ? `font-size: ${fontSize} !important;` : '';

            // Hosts (X/Grok in particular) set their own font on nested spans,
            // which beats an inherited font-family on the RTL block. Override
            // text descendants; descendants of code and LTR segments INSIDE
            // the marked block inherit from that segment instead. A page-wide
            // [dir="ltr"] wrapper above the block must not disable the font.
            //
            // Every selector here is matched against every span on the page
            // (ChatGPT renders one span per word), so :not() holds only
            // simple selectors: no descendant combinators, no substring
            // attribute matches.
            const inlineText = ':is(span, a, strong, b, em, i, u, small, mark, cite, q, del, ins, sub, sup)';
            const protectedText = `:is(pre, code, kbd, samp, [dir="ltr"], [${LTR_ATTR}="true"], [data-rtl-fixancer-ignore])`;
            const scopes = [`[${MARK_ATTR}="rtl"]`, `[${LIST_ATTR}="rtl"] > li`];
            const nestedTextFontRule = custom ? `
                ${scopes.map(scope => `${scope} ${inlineText}:not(${protectedText})`).join(',\n')} {
                    ${fontRule('ar')}
                }
                [${MARK_ATTR}="rtl"][${LANGUAGE_ATTR}="he"],
                [${MARK_ATTR}="rtl"][${LANGUAGE_ATTR}="he"] ${inlineText}:not(${protectedText}),
                [${INPUT_ATTR}="rtl"][${LANGUAGE_ATTR}="he"] {
                    ${fontRule('he')}
                }
                ${scopes.map(scope => `${scope} ${protectedText} ${inlineText}`).join(',\n')} {
                    font-family: inherit !important;
                }
            ` : '';

            return `
                [${MARK_ATTR}="rtl"], [${INPUT_ATTR}="rtl"] {
                    direction: rtl !important;
                    text-align: right !important;
                    unicode-bidi: isolate !important;
                    ${fontRule('ar')}
                }
                /* Prevent relative size multiplication on nested marked blocks. */
                [${MARK_ATTR}="rtl"]:not([${MARK_ATTR}="rtl"] [${MARK_ATTR}="rtl"]),
                [${INPUT_ATTR}="rtl"]:not([${INPUT_ATTR}="rtl"] [${INPUT_ATTR}="rtl"]) {
                    ${sizeRule}
                }
                /* Rich-text editors (ProseMirror, Lexical...) align child paragraphs themselves. */
                [${INPUT_ATTR}="rtl"] > :is(p, div) {
                    direction: rtl !important;
                    text-align: right !important;
                    unicode-bidi: isolate !important;
                }
                [${LTR_ATTR}="true"] {
                    direction: ltr !important;
                    unicode-bidi: isolate !important;
                }
                [${LIST_ATTR}="rtl"] {
                    direction: rtl !important;
                    text-align: right !important;
                    padding-inline-start: 1.55em !important;
                    padding-inline-end: 0 !important;
                    padding-left: 0 !important;
                    padding-right: 1.55em !important;
                    list-style-position: outside !important;
                }
                [${LIST_ATTR}="rtl"] > li {
                    direction: rtl !important;
                    text-align: right !important;
                    unicode-bidi: isolate !important;
                }
                [${LIST_ATTR}="rtl"] > li::marker {
                    direction: rtl;
                    unicode-bidi: isolate;
                    font-variant-numeric: tabular-nums;
                }
                [${MARK_ATTR}="rtl"] :is(pre, code, kbd, samp),
                [${MARK_ATTR}="rtl"] :is(bdi, [dir="ltr"]) {
                    direction: ltr !important;
                    text-align: left !important;
                    unicode-bidi: isolate !important;
                }
                [${MARK_ATTR}="rtl"] :is(pre, code, kbd, samp) {
                    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
                }
                ${nestedTextFontRule}
            `;
        }

        installStyles() {
            this.styleElement?.remove();
            const style = document.createElement('style');
            style.id = 'rtl-fixancer-runtime-styles';
            const vazirUrl = chrome.runtime.getURL('vazir.woff2');
            const shabnamUrl = chrome.runtime.getURL('shabnam.woff2');
            const rules = this.buildRules();

            // @font-face only works at document scope, so shadow roots adopt
            // the rules without the font declarations.
            style.textContent = `
                @font-face {
                    font-family: 'RTLFixancerVazir';
                    src: url('${vazirUrl}') format('woff2');
                    font-display: swap;
                    font-style: normal;
                    font-weight: normal;
                }
                @font-face {
                    font-family: 'RTLFixancerShabnam';
                    src: url('${shabnamUrl}') format('woff2');
                    font-display: swap;
                    font-style: normal;
                    font-weight: normal;
                }
                ${rules}
            `;
            (document.head || document.documentElement).appendChild(style);
            this.styleElement = style;

            if (this.shadowSheet) {
                try {
                    this.shadowSheet.replaceSync(rules);
                } catch (_) {}
            }
        }

        adoptShadowSheet(root) {
            try {
                if (!this.shadowSheet) {
                    this.shadowSheet = new CSSStyleSheet();
                    this.shadowSheet.replaceSync(this.buildRules());
                }
                if (!root.adoptedStyleSheets.includes(this.shadowSheet)) {
                    root.adoptedStyleSheets = [...root.adoptedStyleSheets, this.shadowSheet];
                }
            } catch (_) {}
        }

        removeShadowSheets() {
            for (const root of this.shadowRoots) {
                try {
                    root.adoptedStyleSheets = root.adoptedStyleSheets.filter(sheet => sheet !== this.shadowSheet);
                } catch (_) {}
            }
            this.shadowRoots.clear();
            this.shadowSheet = null;
        }

        // The mutation callback only records work; everything else happens in
        // an idle, time-budgeted flush. It must stay O(mutations).
        onMutation(mutations) {
            if (!this.active) return;
            for (const mutation of mutations) {
                const target = mutation.target;
                if (mutation.type === 'attributes') {
                    // Ignore our own `dir` writes; re-evaluate host rewrites.
                    const owned = this.appliedState.get(target)?.get('dir');
                    if (owned && target.getAttribute('dir') !== owned.value) this.pendingNodes.add(target);
                    continue;
                }
                if (mutation.type === 'characterData') {
                    this.pendingNodes.add(target);
                    continue;
                }
                for (const node of mutation.addedNodes) this.pendingNodes.add(node);
                if (mutation.removedNodes.length > 0) this.pendingNodes.add(target);
            }
            this.schedule();
        }

        schedule() {
            if (this.scheduled || !this.active) return;
            this.scheduled = true;
            const run = deadline => this.flush(deadline);
            if (typeof requestIdleCallback === 'function') {
                this.idleHandle = requestIdleCallback(run, { timeout: 150 });
            } else {
                this.idleHandle = setTimeout(() => run(null), 16);
            }
        }

        flush(deadline) {
            this.scheduled = false;
            this.idleHandle = null;
            if (!this.active) return;

            const started = performance.now();
            // Idle periods can be 50ms long; cap anyway so typing never waits on us.
            const hasTime = () => performance.now() - started < FRAME_BUDGET_MS
                && (!deadline || deadline.didTimeout || deadline.timeRemaining() > 1);

            try {
                for (const node of this.pendingNodes) {
                    this.pendingNodes.delete(node);
                    if (node.isConnected) this.collectNode(node);
                }

                while (this.walkers.length > 0 && hasTime()) {
                    const walker = this.walkers[0];
                    for (let count = 0; count < 200; count += 1) {
                        const text = walker.nextNode();
                        if (!text) {
                            this.walkers.shift();
                            break;
                        }
                        this.collectText(text);
                    }
                }

                for (const editor of this.pendingEditors) {
                    this.pendingEditors.delete(editor);
                    this.processEditor(editor);
                }

                for (const block of this.pendingBlocks) {
                    if (!hasTime()) break;
                    this.pendingBlocks.delete(block);
                    this.processBlock(block);
                }
            } catch (_) {}

            if (this.pendingNodes.size > 0 || this.walkers.length > 0
                || this.pendingBlocks.size > 0 || this.pendingEditors.size > 0) {
                this.schedule();
            }
            if (this.touchedElements.size > 500) this.pruneTouchedElements();
        }

        collectNode(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                this.collectText(node, true);
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;

            // Host rewrote one of our attributes, or a child was removed /
            // an element added inside a marked block: re-evaluate that block.
            const marked = node.closest(MARKED_SELECTOR);
            if (marked) this.pendingBlocks.add(this.blockFor(marked));
            if (node.matches(LIST_SELECTOR) && this.touchedElements.has(node)) this.syncList(node);

            const editor = node.closest(`[${INPUT_ATTR}]`);
            if (editor) this.pendingEditors.add(editor);

            if (node.firstChild || node.shadowRoot) this.walkers.push(this.createWalker(node));
        }

        collectText(text, fromMutation = false) {
            const parent = text.parentElement;
            if (!parent) return;
            const hasRtl = Core.hasRtlCharacters(text.data);
            if (fromMutation) {
                // Editors are classified as a whole by processEditor.
                const editor = parent.closest(EDITABLE_SELECTOR);
                if (editor) {
                    if (hasRtl || editor.hasAttribute(INPUT_ATTR)) this.pendingEditors.add(editor);
                    return;
                }
                const marked = parent.closest(MARKED_SELECTOR);
                if (marked) this.pendingBlocks.add(this.blockFor(marked));
            }
            if (hasRtl) this.pendingBlocks.add(this.blockFor(parent));
        }

        blockFor(element) {
            let current = element;
            while (current.parentElement && INLINE_TAGS.has(current.localName)) current = current.parentElement;
            return current;
        }

        isTextBlock(block) {
            if (!block?.isConnected || NEVER_BLOCK_TAGS.has(block.localName)) return false;
            if (block.closest(SKIP_SELECTOR)) return false;
            if (typeof block.className === 'string' && UI_CLASS_RE.test(block.className)) return false;
            if (TEXT_BLOCK_TAGS.has(block.localName)) return true;
            if (block.localName === 'li') return this.isListItemBlock(block);
            return !this.hasNestedBlock(block);
        }

        // A nested block only counts as layout when it is not wrapped in an
        // inline element: an inline-wrapped <div> is a widget inside the text.
        hasNestedBlock(block) {
            for (const nested of block.querySelectorAll(NESTED_BLOCK_SELECTOR)) {
                let parent = nested.parentElement;
                while (parent && parent !== block && !INLINE_TAGS.has(parent.localName)) parent = parent.parentElement;
                if (parent === block) return true;
            }
            return false;
        }

        isListItemBlock(item) {
            if (item.querySelector(LIST_ITEM_CONTAINER_SELECTOR)) return false;
            let paragraphs = 0;
            for (const paragraph of item.querySelectorAll('p')) {
                // Paragraphs of nested sub-lists belong to their own items.
                if (paragraph.closest('li') === item && ++paragraphs > MAX_LIST_ITEM_PARAGRAPHS) return false;
            }
            return true;
        }

        blockText(block) {
            const walker = document.createTreeWalker(block, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
                acceptNode: node => {
                    if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
                    return SKIP_TAGS.has(node.localName) || node.getAttribute('aria-hidden') === 'true'
                        ? NodeFilter.FILTER_REJECT
                        : NodeFilter.FILTER_SKIP;
                }
            });
            let text = '';
            let node;
            while ((node = walker.nextNode())) {
                text += node.data;
                if (text.length >= MAX_BLOCK_TEXT) break;
            }
            return text;
        }

        processBlock(block) {
            if (!this.isTextBlock(block)) {
                if (this.touchedElements.has(block)) this.restoreBlock(block);
                return;
            }

            const text = this.blockText(block);
            const result = Core.classifyText(text, this.settings.detectionMode);
            const signature = `${result.direction}|${text}`;
            if (this.signatures.get(block) === signature && this.ownedAttributesMatch(block)) return;

            if (result.direction === 'rtl') {
                this.removeOwnedAttribute(block, LTR_ATTR);
                this.setOwnedAttribute(block, MARK_ATTR, 'rtl');
                this.setOwnedAttribute(block, LANGUAGE_ATTR, result.language || 'ar');
                this.setOwnedAttribute(block, 'dir', 'rtl');
                this.isolateLtrInlines(block);
            } else {
                this.restoreBlock(block);
            }
            this.signatures.set(block, signature);

            if (block.localName === 'li') {
                if (block.parentElement?.matches(LIST_SELECTOR)) this.syncList(block.parentElement);
            } else {
                // A paragraph inside a list item (li > p) also decides the
                // item's direction, so the list marker follows the text.
                const item = block.parentElement?.closest('li');
                if (item) this.pendingBlocks.add(item);
            }
        }

        // Short Latin-only inline runs (names, URLs, product names) inside
        // an RTL block are isolated so their punctuation stays in place.
        isolateLtrInlines(block) {
            for (const inline of block.querySelectorAll(INLINE_SELECTOR)) {
                const text = inline.textContent;
                if (text.length <= MAX_LTR_INLINE_TEXT && !SINGLE_WORD_RE.test(text) && !Core.hasRtlCharacters(text)
                    && Core.classifyText(text, this.settings.detectionMode).direction === 'ltr') {
                    this.setOwnedAttribute(inline, LTR_ATTR, 'true');
                    this.setOwnedAttribute(inline, 'dir', 'ltr');
                } else if (this.touchedElements.has(inline)) {
                    this.restoreElement(inline);
                }
            }
        }

        restoreBlock(block) {
            if (this.touchedElements.has(block)) {
                for (const inline of block.querySelectorAll(`[${LTR_ATTR}]`)) this.restoreElement(inline);
            }
            this.restoreElement(block);
            const list = block.localName === 'li' ? block.parentElement : null;
            if (list && this.touchedElements.has(list)) this.syncList(list);
        }

        ownedAttributesMatch(element) {
            const applied = this.appliedState.get(element);
            if (!applied) return true;
            for (const [name, state] of applied) {
                const present = element.hasAttribute(name);
                if (present !== state.present) return false;
                if (present && element.getAttribute(name) !== state.value) return false;
            }
            return true;
        }

        syncList(list) {
            if (!list?.isConnected) return;
            const hasRtlItem = [...list.children].some(item =>
                item.localName === 'li' && item.getAttribute(MARK_ATTR) === 'rtl');
            if (hasRtlItem) {
                this.setOwnedAttribute(list, LIST_ATTR, 'rtl');
                this.setOwnedAttribute(list, 'dir', 'rtl');
            } else {
                this.restoreElement(list);
            }
        }

        editorHostFor(element) {
            let host = element?.closest?.(EDITABLE_SELECTOR);
            if (!host) return null;
            // Rich-text editors nest editable nodes; classify the outermost.
            for (let parent = host.parentElement?.closest(EDITABLE_SELECTOR); parent;
                parent = parent.parentElement?.closest(EDITABLE_SELECTOR)) {
                host = parent;
            }
            if (host.closest(CODE_EDITOR_SELECTOR) || host.querySelector('.cm-content, .view-lines')) return null;
            return host;
        }

        editorText(element) {
            // textContent, never innerText: innerText forces a synchronous
            // layout on every keystroke.
            const text = typeof element.value === 'string' ? element.value : element.textContent || '';
            return text.slice(0, MAX_BLOCK_TEXT);
        }

        processEditor(element) {
            if (!this.active) return;
            const editor = this.editorHostFor(element);
            if (!editor) return;
            try {
                const result = Core.classifyText(this.editorText(editor), this.settings.detectionMode);
                if (result.direction !== 'rtl') {
                    this.restoreElement(editor);
                    return;
                }
                this.setOwnedAttribute(editor, INPUT_ATTR, 'rtl');
                this.setOwnedAttribute(editor, LANGUAGE_ATTR, result.language || 'ar');
                this.setOwnedAttribute(editor, 'dir', 'rtl');
            } catch (_) {}
        }

        onInput(event) {
            const target = event.composedPath?.()[0] || event.target;
            if (target?.nodeType === Node.ELEMENT_NODE) this.processEditor(target);
            else if (target?.parentElement) this.processEditor(target.parentElement);
        }

        captureElement(element) {
            if (this.originalState.has(element)) return;
            const snapshot = {};
            for (const name of OWNED_ATTRIBUTES) {
                snapshot[name] = element.hasAttribute(name)
                    ? { present: true, value: element.getAttribute(name) }
                    : { present: false, value: null };
            }
            this.originalState.set(element, snapshot);
            this.touchedElements.add(element);
        }

        appliedAttributes(element) {
            let applied = this.appliedState.get(element);
            if (!applied) {
                applied = new Map();
                this.appliedState.set(element, applied);
            }
            return applied;
        }

        setOwnedAttribute(element, name, value) {
            this.captureElement(element);
            const normalized = String(value);
            const previous = this.appliedState.get(element)?.get(name);
            const stillOwned = previous && element.hasAttribute(name) === previous.present
                && (!previous.present || element.getAttribute(name) === previous.value);
            if (previous && !stillOwned) {
                // Preserve a new value written by the site while RTL was on.
                this.originalState.get(element)[name] = element.hasAttribute(name)
                    ? { present: true, value: element.getAttribute(name) }
                    : { present: false, value: null };
            }
            this.appliedAttributes(element).set(name, { present: true, value: normalized });
            if (element.getAttribute(name) !== normalized) element.setAttribute(name, normalized);
        }

        removeOwnedAttribute(element, name) {
            if (!element.hasAttribute(name) && !this.appliedState.get(element)?.has(name)) return;
            this.captureElement(element);
            this.appliedAttributes(element).set(name, { present: false, value: null });
            element.removeAttribute(name);
        }

        restoreElement(element) {
            const snapshot = this.originalState.get(element);
            if (!snapshot) return;
            const applied = this.appliedState.get(element);

            for (const [name, state] of Object.entries(snapshot)) {
                const owned = applied?.get(name);
                if (!owned) continue;
                const stillOwned = owned.present
                    ? element.hasAttribute(name) && element.getAttribute(name) === owned.value
                    : !element.hasAttribute(name);
                if (!stillOwned) continue;
                if (state.present) element.setAttribute(name, state.value ?? '');
                else element.removeAttribute(name);
            }
            this.forget(element);
        }

        forget(element) {
            this.originalState.delete(element);
            this.appliedState.delete(element);
            this.touchedElements.delete(element);
            this.signatures.delete(element);
        }

        restoreAll() {
            for (const element of [...this.touchedElements]) {
                if (element.isConnected) this.restoreElement(element);
                else this.forget(element);
            }
        }

        pruneTouchedElements() {
            for (const element of [...this.touchedElements]) {
                if (!element.isConnected) this.forget(element);
            }
        }

        cancelScheduledWork() {
            if (this.idleHandle !== null) {
                if (typeof cancelIdleCallback === 'function') cancelIdleCallback(this.idleHandle);
                else clearTimeout(this.idleHandle);
            }
            this.idleHandle = null;
            this.scheduled = false;
        }

        cleanup({ keepRuntimeListeners = true } = {}) {
            this.active = false;
            this.detachListeners();
            this.cancelScheduledWork();
            this.pendingNodes.clear();
            this.pendingBlocks.clear();
            this.pendingEditors.clear();
            this.walkers = [];
            this.restoreAll();
            this.removeShadowSheets();
            this.styleElement?.remove();
            this.styleElement = null;
            this.notifyState(false);

            if (!keepRuntimeListeners) {
                chrome.runtime.onMessage.removeListener(this.onMessage);
                chrome.storage.onChanged.removeListener(this.onStorageChanged);
            }
        }

        async applySettings(nextSettings) {
            const next = Core.normalizeSettings(nextSettings);
            const wasAllowed = this.isAllowed();
            const detectionChanged = next.detectionMode !== this.settings.detectionMode;
            const appearanceChanged = next.selectedFont !== this.settings.selectedFont
                || next.fontSize !== this.settings.fontSize;
            this.settings = next;
            const isAllowed = this.isAllowed();

            if (!isAllowed) {
                if (this.active || wasAllowed) this.cleanup({ keepRuntimeListeners: true });
                return false;
            }
            if (!this.active || detectionChanged) return this.restart(next);
            if (appearanceChanged) this.installStyles();
            return true;
        }

        onStorageChanged(changes, areaName) {
            if (areaName !== 'sync' || !changes[STORAGE_KEY]) return;
            void this.applySettings(changes[STORAGE_KEY].newValue);
        }

        onMessage(message, _sender, sendResponse) {
            void (async () => {
                switch (message?.type) {
                    case 'runtime:ping':
                        return { ok: true, version: this.version, active: this.active, touched: this.touchedElements.size };
                    case 'runtime:settings':
                    case 'runtime:reapply':
                        await this.restart(message.settings || null);
                        return { ok: true, active: this.active };
                    case 'runtime:cleanup': {
                        const requestedHost = Core.normalizeHostname(message.hostname || '');
                        if (requestedHost && requestedHost !== Core.normalizeHostname(location.hostname)) {
                            return { ok: true, skipped: true };
                        }
                        this.cleanup({ keepRuntimeListeners: true });
                        return { ok: true };
                    }
                    case 'runtime:print':
                        window.print();
                        return { ok: true };
                    default:
                        return { ok: false, error: 'Unknown message type.' };
                }
            })().then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
            return true;
        }
    }

    const runtime = new RTLFixancerRuntime();
    globalThis[INSTANCE_KEY] = runtime;
    void runtime.start();
})();
