(() => {
    'use strict';

    const INSTANCE_KEY = '__RTL_FIXANCER_RUNTIME_V4__';
    const Core = globalThis.RTLFixancerCore;
    if (!Core) return;

    if (globalThis[INSTANCE_KEY]) {
        void globalThis[INSTANCE_KEY].restart();
        return;
    }

    const STORAGE_KEY = 'settings';
    const MARK_ATTR = 'data-rtl-fixancer';
    const LANGUAGE_ATTR = 'data-rtl-fixancer-language';
    const INPUT_ATTR = 'data-rtl-fixancer-input';
    const LIST_ATTR = 'data-rtl-fixancer-list';
    const LTR_ATTR = 'data-rtl-fixancer-ltr';

    const BLOCK_SELECTOR = [
        'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th',
        'blockquote', 'figcaption', 'caption', 'summary', 'dd', 'dt', 'address', 'output'
    ].join(',');
    const INLINE_SELECTOR = [
        'span', 'a', 'cite', 'q', 'em', 'strong', 'b', 'i', 'u', 'mark',
        'small', 'del', 'ins', 'sub', 'sup', 'time', 'abbr'
    ].join(',');
    const CANDIDATE_SELECTOR = `${BLOCK_SELECTOR},${INLINE_SELECTOR}`;
    const LIST_SELECTOR = 'ol, ul, [role="list"]';
    const EDITABLE_SELECTOR = [
        'textarea',
        'input:not([type])',
        'input[type="text"]',
        'input[type="search"]',
        '[contenteditable="true"]',
        '[role="textbox"]'
    ].join(',');
    const SKIP_SELECTOR = [
        'script', 'style', 'noscript', 'template', 'pre', 'code', 'kbd', 'samp',
        'svg', 'canvas', 'video', 'audio', 'iframe', 'object', 'embed',
        'nav', 'header', 'footer', 'aside', 'menu', 'select', 'option', 'button',
        '[role="navigation"]', '[role="banner"]', '[role="toolbar"]',
        '[role="menu"]', '[role="menubar"]', '[role="tablist"]',
        '[aria-hidden="true"]', '[data-rtl-fixancer-ignore]'
    ].join(',');
    const CODE_ANCESTOR_SELECTOR = [
        'pre', 'code', 'kbd', 'samp',
        '[class*="codeblock" i]', '[class*="code-block" i]',
        '[class*="codemirror" i]', '[class*="monaco" i]'
    ].join(',');

    const SITE_ADAPTERS = [
        {
            test: host => host === 'chatgpt.com' || host === 'chat.openai.com',
            content: '[data-message-author-role], [data-testid="conversation-turn"], article[data-testid*="conversation" i]',
            editor: '#prompt-textarea, [data-testid*="composer" i] [contenteditable="true"]'
        },
        {
            test: host => host === 'perplexity.ai' || host.endsWith('.perplexity.ai'),
            content: '.prose, [data-testid="answer"], [data-cplx-component="message-block-answer"], [class*="threadContent" i]',
            editor: 'textarea, [contenteditable="true"], [role="textbox"]'
        },
        {
            test: host => host === 'aistudio.google.com' || host === 'makersuite.google.com',
            content: '.conversation-container, .chat-message, .message-content, .model-response, ms-chat-turn',
            editor: 'ms-textarea textarea, textarea[aria-label*="prompt" i], [contenteditable="true"]'
        },
        {
            test: host => host === 'gemini.google.com' || host.endsWith('.gemini.google.com'),
            content: 'message-content, .model-response-text, [data-test-id*="response" i], [class*="response-container" i]',
            editor: 'rich-textarea [contenteditable="true"], textarea, [role="textbox"]'
        },
        {
            test: host => host === 'chat.deepseek.com' || host.endsWith('.deepseek.com'),
            content: '.ds-markdown, [class*="message" i] [class*="markdown" i], [class*="message-content" i]',
            editor: 'textarea, [contenteditable="true"], [role="textbox"]'
        }
    ];

    class RTLFixancerRuntime {
        constructor() {
            this.active = false;
            this.settings = Core.DEFAULT_SETTINGS;
            this.adapter = SITE_ADAPTERS.find(candidate => candidate.test(location.hostname)) || null;
            this.observer = null;
            this.styleElement = null;
            this.queue = new Set();
            this.scheduled = false;
            this.idleHandle = null;
            this.originalState = new WeakMap();
            this.touchedElements = new Set();
            this.signatures = new WeakMap();
            this.stats = { processed: 0, restored: 0, queued: 0, errors: 0 };

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

            this.active = true;
            this.installStyles();
            this.attachListeners();
            this.scan(document);
            this.scanEditors(document);
            this.notifyState(true);
            return true;
        }

        async restart(settings = null) {
            if (settings) this.settings = Core.normalizeSettings(settings);
            else await this.loadSettings();

            this.cleanup({ keepRuntimeListeners: true });
            if (!this.isAllowed()) return false;

            this.active = true;
            this.installStyles();
            this.attachListeners();
            this.scan(document);
            this.scanEditors(document);
            this.notifyState(true);
            return true;
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
            this.observer.observe(document.documentElement || document, {
                subtree: true,
                childList: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['class', 'role', 'aria-hidden', 'contenteditable']
            });

            document.addEventListener('input', this.onInput, true);
            document.addEventListener('compositionend', this.onInput, true);
            document.addEventListener('focusin', this.onInput, true);
        }

        installStyles() {
            this.styleElement?.remove();
            const style = document.createElement('style');
            style.id = 'rtl-fixancer-runtime-styles';

            const vazirUrl = chrome.runtime.getURL('vazir.woff2');
            const shabnamUrl = chrome.runtime.getURL('shabnam.woff2');
            const fontSize = {
                default: 'inherit',
                small: '0.9em',
                medium: '1em',
                large: '1.125em'
            }[this.settings.fontSize] || 'inherit';
            const fontStack = Core.fontStack(this.settings.selectedFont, 'ar');
            const fontRule = this.settings.selectedFont === 'default'
                ? ''
                : `font-family: ${fontStack} !important;`;
            const sizeRule = this.settings.fontSize === 'default'
                ? ''
                : `font-size: ${fontSize} !important;`;

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
                [${MARK_ATTR}="rtl"], [${INPUT_ATTR}="rtl"] {
                    direction: rtl !important;
                    text-align: right !important;
                    unicode-bidi: isolate !important;
                    ${fontRule}
                    ${sizeRule}
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
                [${MARK_ATTR}="rtl"] :is(pre, code, kbd, samp, [class*="codeblock" i], [class*="code-block" i]),
                [${MARK_ATTR}="rtl"] :is(bdi, [dir="ltr"]) {
                    direction: ltr !important;
                    text-align: left !important;
                    unicode-bidi: isolate !important;
                }
                [${MARK_ATTR}="rtl"] :is(pre, code, kbd, samp, [class*="codeblock" i], [class*="code-block" i]) {
                    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
                }
            `;

            (document.head || document.documentElement).appendChild(style);
            this.styleElement = style;
        }

        enqueueCandidateAndBlock(element) {
            if (!element) return;
            const candidate = element.matches?.(CANDIDATE_SELECTOR)
                ? element
                : element.closest?.(CANDIDATE_SELECTOR);
            if (candidate) this.enqueue(candidate);

            const block = element.matches?.(BLOCK_SELECTOR)
                ? element
                : element.closest?.(BLOCK_SELECTOR);
            if (block && block !== candidate) this.enqueue(block);
        }

        onMutation(mutations) {
            if (!this.active) return;
            for (const mutation of mutations) {
                if (mutation.type === 'attributes') {
                    const element = mutation.target;
                    this.enqueueCandidateAndBlock(element);
                    if (element?.matches?.(EDITABLE_SELECTOR)) this.processEditor(element);
                    continue;
                }

                if (mutation.type === 'characterData') {
                    const parent = mutation.target.parentElement;
                    this.enqueueCandidateAndBlock(parent);
                    const editor = parent?.closest?.(EDITABLE_SELECTOR);
                    if (editor) this.processEditor(editor);
                    continue;
                }

                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        this.enqueueCandidateAndBlock(node.parentElement);
                        continue;
                    }
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;
                    this.scan(node);
                    this.scanEditors(node);
                    this.enqueueCandidateAndBlock(node.parentElement);
                }
            }
            this.pruneTouchedElements();
        }

        scan(root) {
            if (!this.active || !root) return;
            if (root.nodeType === Node.ELEMENT_NODE && root.matches?.(CANDIDATE_SELECTOR)) this.enqueue(root);
            for (const element of root.querySelectorAll?.(CANDIDATE_SELECTOR) || []) this.enqueue(element);
        }

        scanEditors(root) {
            if (!this.active || !root) return;
            if (root.nodeType === Node.ELEMENT_NODE && root.matches?.(EDITABLE_SELECTOR)) this.processEditor(root);
            for (const editor of root.querySelectorAll?.(EDITABLE_SELECTOR) || []) this.processEditor(editor);
        }

        enqueue(element) {
            if (!element || this.queue.has(element)) return;
            this.queue.add(element);
            this.stats.queued += 1;
            this.schedule();
        }

        schedule() {
            if (this.scheduled || !this.active) return;
            this.scheduled = true;
            const run = deadline => this.flush(deadline);
            if (typeof requestIdleCallback === 'function') {
                this.idleHandle = requestIdleCallback(run, { timeout: 250 });
            } else {
                this.idleHandle = setTimeout(() => run(null), 0);
            }
        }

        flush(deadline) {
            this.scheduled = false;
            this.idleHandle = null;
            if (!this.active) return;

            let processed = 0;
            for (const element of this.queue) {
                this.queue.delete(element);
                if (element.isConnected) this.processElement(element);
                processed += 1;
                if (processed >= 250) break;
                if (deadline && !deadline.didTimeout && deadline.timeRemaining() < 2) break;
            }
            if (this.queue.size > 0) this.schedule();
        }

        isInContentArea(element) {
            if (!this.adapter) return true;
            return Boolean(element.closest(this.adapter.content));
        }

        shouldSkip(element) {
            if (!element?.isConnected) return true;
            if (element.matches(SKIP_SELECTOR) || element.closest(SKIP_SELECTOR)) return true;
            if (element.closest(CODE_ANCESTOR_SELECTOR)) return true;
            if (!this.isInContentArea(element)) return true;

            const className = typeof element.className === 'string' ? element.className.toLowerCase() : '';
            return /\b(sidebar|navbar|topbar|toolbar|breadcrumb|pagination|composer-actions?)\b/.test(className);
        }

        getText(element) {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
                acceptNode: node => {
                    const parent = node.parentElement;
                    if (!parent || parent.closest(CODE_ANCESTOR_SELECTOR)) return NodeFilter.FILTER_REJECT;
                    if (parent.closest('[aria-hidden="true"]')) return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                }
            });

            let text = '';
            let node;
            while ((node = walker.nextNode())) {
                text += ` ${node.textContent || ''}`;
                if (text.length >= 4000) break;
            }
            return text.replace(/\s+/g, ' ').trim();
        }

        signatureFor(text, result) {
            return `${this.settings.detectionMode}|${result.direction}|${result.language || ''}|${text}`;
        }

        isInlineElement(element) {
            return element.matches?.(INLINE_SELECTOR) || false;
        }

        rtlBlockAncestor(element) {
            const ancestor = element.parentElement?.closest?.(`[${MARK_ATTR}="rtl"]`);
            return ancestor?.matches?.(BLOCK_SELECTOR) ? ancestor : null;
        }

        processElement(element) {
            try {
                if (this.shouldSkip(element)) {
                    this.restoreElement(element);
                    return;
                }

                const text = this.getText(element);
                const result = Core.classifyText(text, this.settings.detectionMode);
                const signature = this.signatureFor(text, result);
                if (this.signatures.get(element) === signature) return;
                this.signatures.set(element, signature);

                const rtlAncestor = this.rtlBlockAncestor(element);
                if (this.isInlineElement(element) && rtlAncestor) {
                    if (result.direction === 'ltr' && result.rtlCount === 0 && result.ltrCount > 0 && text.length <= 160) {
                        this.markLtrInline(element);
                    } else {
                        this.restoreElement(element);
                    }
                    return;
                }

                if (result.direction !== 'rtl') {
                    this.restoreElement(element);
                    return;
                }

                this.captureElement(element);
                element.removeAttribute(LTR_ATTR);
                element.setAttribute(MARK_ATTR, 'rtl');
                element.setAttribute(LANGUAGE_ATTR, result.language || 'ar');
                element.setAttribute('dir', 'rtl');
                this.stats.processed += 1;

                const list = element.closest(LIST_SELECTOR);
                if (list) this.syncListContainer(list);
            } catch (_) {
                this.stats.errors += 1;
            }
        }

        markLtrInline(element) {
            this.captureElement(element);
            element.removeAttribute(MARK_ATTR);
            element.removeAttribute(LANGUAGE_ATTR);
            element.setAttribute(LTR_ATTR, 'true');
            element.setAttribute('dir', 'ltr');
        }

        listHasRtlContent(list) {
            try {
                return [...list.querySelectorAll(':scope > li')].some(item =>
                    item.matches(`[${MARK_ATTR}="rtl"]`) || Boolean(item.querySelector(`[${MARK_ATTR}="rtl"]`))
                );
            } catch (_) {
                return Boolean(list.querySelector(`[${MARK_ATTR}="rtl"]`));
            }
        }

        syncListContainer(list) {
            if (!list?.isConnected) return;
            if (this.listHasRtlContent(list)) {
                this.captureElement(list);
                list.setAttribute(LIST_ATTR, 'rtl');
                list.setAttribute('dir', 'rtl');
            } else if (this.originalState.has(list)) {
                this.restoreElement(list, { syncList: false });
            }
        }

        isSupportedEditor(element) {
            if (!element?.matches?.(EDITABLE_SELECTOR)) return false;
            if (element.closest(CODE_ANCESTOR_SELECTOR)) return false;
            if (this.adapter?.editor && !element.matches(this.adapter.editor) && !element.closest(this.adapter.editor)) {
                if (!element.closest(this.adapter.content)) return false;
            }
            return true;
        }

        editorText(element) {
            if (typeof element.value === 'string') return element.value.trim();
            return (element.innerText || element.textContent || '').trim();
        }

        processEditor(element) {
            if (!this.active || !this.isSupportedEditor(element)) return;
            try {
                const result = Core.classifyText(this.editorText(element), this.settings.detectionMode);
                if (result.direction !== 'rtl') {
                    this.restoreElement(element);
                    return;
                }
                this.captureElement(element);
                element.setAttribute(INPUT_ATTR, 'rtl');
                element.setAttribute(LANGUAGE_ATTR, result.language || 'ar');
                element.setAttribute('dir', 'rtl');
            } catch (_) {
                this.stats.errors += 1;
            }
        }

        onInput(event) {
            const target = event.target;
            if (target?.matches?.(EDITABLE_SELECTOR)) this.processEditor(target);
        }

        captureElement(element) {
            if (this.originalState.has(element)) return;
            const attributes = [MARK_ATTR, LANGUAGE_ATTR, INPUT_ATTR, LIST_ATTR, LTR_ATTR, 'dir'];
            const snapshot = {};
            for (const name of attributes) {
                snapshot[name] = element.hasAttribute(name)
                    ? { present: true, value: element.getAttribute(name) }
                    : { present: false, value: null };
            }
            this.originalState.set(element, snapshot);
            this.touchedElements.add(element);
        }

        restoreElement(element, { syncList = true } = {}) {
            const snapshot = this.originalState.get(element);
            if (!snapshot) return;
            const list = syncList && !element.matches?.(LIST_SELECTOR) ? element.closest?.(LIST_SELECTOR) : null;

            for (const [name, state] of Object.entries(snapshot)) {
                if (name === 'dir' && !['rtl', 'ltr'].includes(element.getAttribute('dir'))) continue;
                if (state.present) element.setAttribute(name, state.value ?? '');
                else element.removeAttribute(name);
            }

            this.originalState.delete(element);
            this.touchedElements.delete(element);
            this.signatures.delete(element);
            this.stats.restored += 1;
            if (list) this.syncListContainer(list);
        }

        restoreAll() {
            const elements = [...this.touchedElements];
            for (const element of elements) {
                if (element?.isConnected) this.restoreElement(element, { syncList: false });
                else {
                    this.touchedElements.delete(element);
                    this.originalState.delete(element);
                    this.signatures.delete(element);
                }
            }
        }

        pruneTouchedElements() {
            if (this.touchedElements.size < 500) return;
            for (const element of [...this.touchedElements]) {
                if (!element.isConnected) {
                    this.touchedElements.delete(element);
                    this.originalState.delete(element);
                    this.signatures.delete(element);
                }
            }
        }

        cancelScheduledWork() {
            if (this.idleHandle === null) return;
            if (typeof cancelIdleCallback === 'function') cancelIdleCallback(this.idleHandle);
            else clearTimeout(this.idleHandle);
            this.idleHandle = null;
            this.scheduled = false;
        }

        cleanup({ keepRuntimeListeners = true } = {}) {
            this.active = false;
            this.observer?.disconnect();
            this.observer = null;
            document.removeEventListener('input', this.onInput, true);
            document.removeEventListener('compositionend', this.onInput, true);
            document.removeEventListener('focusin', this.onInput, true);
            this.cancelScheduledWork();
            this.queue.clear();
            this.restoreAll();
            this.styleElement?.remove();
            this.styleElement = null;
            this.notifyState(false);

            if (!keepRuntimeListeners) {
                chrome.runtime.onMessage.removeListener(this.onMessage);
                chrome.storage.onChanged.removeListener(this.onStorageChanged);
            }
        }

        getStats() {
            return {
                ...this.stats,
                active: this.active,
                hostname: location.hostname,
                touched: this.touchedElements.size,
                queuedNow: this.queue.size
            };
        }

        onStorageChanged(changes, areaName) {
            if (areaName !== 'sync' || !changes[STORAGE_KEY]) return;
            void this.restart(Core.normalizeSettings(changes[STORAGE_KEY].newValue));
        }

        onMessage(message, _sender, sendResponse) {
            void (async () => {
                switch (message?.type) {
                    case 'runtime:ping':
                        return { ok: true, stats: this.getStats() };
                    case 'runtime:settings':
                    case 'runtime:reapply':
                        await this.restart(message.settings || null);
                        return { ok: true, stats: this.getStats() };
                    case 'runtime:cleanup':
                        this.cleanup({ keepRuntimeListeners: true });
                        return { ok: true };
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
