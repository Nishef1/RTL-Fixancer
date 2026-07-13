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
    const CANDIDATE_SELECTOR = [
        'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th',
        'blockquote', 'figcaption', 'caption', 'summary', 'cite', 'q', 'em',
        'strong', 'b', 'i', 'u', 'mark', 'small', 'del', 'ins', 'sub', 'sup',
        'time', 'abbr', 'dd', 'dt', 'address', 'output', 'span', 'a'
    ].join(',');
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
            this.stats = {
                processed: 0,
                restored: 0,
                queued: 0,
                errors: 0
            };
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
            return true;
        }

        attachListeners() {
            if (this.observer) this.observer.disconnect();
            this.observer = new MutationObserver(this.onMutation);
            const target = document.documentElement || document;
            this.observer.observe(target, {
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
                    unicode-bidi: plaintext !important;
                    ${this.settings.selectedFont === 'default' ? '' : `font-family: ${fontStack} !important;`}
                    ${this.settings.fontSize === 'default' ? '' : `font-size: ${fontSize} !important;`}
                }
                [${MARK_ATTR}="rtl"] :is(pre, code, kbd, samp, [class*="codeblock" i], [class*="code-block" i]) {
                    direction: ltr !important;
                    text-align: left !important;
                    unicode-bidi: isolate !important;
                    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
                }
                :is(ol, ul, [role="list"]):has(> [${MARK_ATTR}="rtl"]) {
                    direction: rtl;
                    padding-inline-start: 1.5em;
                    padding-inline-end: 0;
                }
            `;

            (document.head || document.documentElement).appendChild(style);
            this.styleElement = style;
        }

        onMutation(mutations) {
            if (!this.active) return;
            for (const mutation of mutations) {
                if (mutation.type === 'attributes') {
                    const element = mutation.target;
                    if (element?.matches?.(CANDIDATE_SELECTOR)) this.enqueue(element);
                    const candidate = element?.closest?.(CANDIDATE_SELECTOR);
                    if (candidate && candidate !== element) this.enqueue(candidate);
                    if (element?.matches?.(EDITABLE_SELECTOR)) this.processEditor(element);
                    continue;
                }

                if (mutation.type === 'characterData') {
                    const parent = mutation.target.parentElement;
                    const candidate = parent?.closest?.(CANDIDATE_SELECTOR);
                    if (candidate) this.enqueue(candidate);
                    const editor = parent?.closest?.(EDITABLE_SELECTOR);
                    if (editor) this.processEditor(editor);
                    continue;
                }

                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        const parent = node.parentElement;
                        if (parent?.matches?.(CANDIDATE_SELECTOR)) this.enqueue(parent);
                        continue;
                    }
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;
                    this.scan(node);
                    this.scanEditors(node);
                }
            }
            this.pruneTouchedElements();
        }

        scan(root) {
            if (!this.active || !root) return;
            if (root.nodeType === Node.ELEMENT_NODE && root.matches?.(CANDIDATE_SELECTOR)) this.enqueue(root);
            const elements = root.querySelectorAll?.(CANDIDATE_SELECTOR) || [];
            for (const element of elements) this.enqueue(element);
        }

        scanEditors(root) {
            if (!this.active || !root) return;
            if (root.nodeType === Node.ELEMENT_NODE && root.matches?.(EDITABLE_SELECTOR)) this.processEditor(root);
            const editors = root.querySelectorAll?.(EDITABLE_SELECTOR) || [];
            for (const editor of editors) this.processEditor(editor);
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
            if (/\b(sidebar|navbar|topbar|toolbar|breadcrumb|pagination|composer-actions?)\b/.test(className)) return true;
            return false;
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

                if (result.direction !== 'rtl') {
                    this.restoreElement(element);
                    return;
                }

                this.captureElement(element);
                element.setAttribute(MARK_ATTR, 'rtl');
                element.setAttribute(LANGUAGE_ATTR, result.language || 'ar');
                element.setAttribute('dir', 'rtl');
                this.stats.processed += 1;
            } catch (_) {
                this.stats.errors += 1;
            }
        }

        isSupportedEditor(element) {
            if (!element?.matches?.(EDITABLE_SELECTOR)) return false;
            if (element.closest(CODE_ANCESTOR_SELECTOR)) return false;
            if (this.adapter?.editor && !element.matches(this.adapter.editor) && !element.closest(this.adapter.editor)) {
                const inContent = element.closest(this.adapter.content);
                if (!inContent) return false;
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
                const text = this.editorText(element);
                const result = Core.classifyText(text, this.settings.detectionMode);
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
            const attributes = [MARK_ATTR, LANGUAGE_ATTR, INPUT_ATTR, 'dir'];
            const snapshot = {};
            for (const name of attributes) {
                snapshot[name] = element.hasAttribute(name)
                    ? { present: true, value: element.getAttribute(name) }
                    : { present: false, value: null };
            }
            this.originalState.set(element, snapshot);
            this.touchedElements.add(element);
        }

        restoreElement(element) {
            const snapshot = this.originalState.get(element);
            if (!snapshot) return;
            for (const [name, state] of Object.entries(snapshot)) {
                // Do not overwrite a direction change made by the host after our mutation.
                if (name === 'dir' && element.getAttribute('dir') !== 'rtl') continue;
                if (state.present) element.setAttribute(name, state.value ?? '');
                else element.removeAttribute(name);
            }
            this.originalState.delete(element);
            this.touchedElements.delete(element);
            this.signatures.delete(element);
            this.stats.restored += 1;
        }

        restoreAll() {
            for (const element of [...this.touchedElements]) {
                if (element?.isConnected) this.restoreElement(element);
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
            const settings = Core.normalizeSettings(changes[STORAGE_KEY].newValue);
            void this.restart(settings);
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
