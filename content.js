if (window.RTLAIStudioManager) {
    console.log('RTL AI Studio: script already loaded, skipping redefinition');
} else {

// Comprehensive list of text-bearing HTML tags. Layout containers (header/footer/nav/aside/article/section/main)
// are intentionally excluded — they are filtered out by isSafeElementForProcessing anyway.
const TEXT_TAGS_SELECTOR = 'p, span, h1, h2, h3, h4, h5, h6, li, td, th, tr, blockquote, div, a, button, label, option, optgroup, legend, figcaption, caption, summary, details, cite, q, em, strong, b, i, u, mark, small, del, ins, sub, sup, time, abbr, dd, dt, address, output, thead, tbody, tfoot';
const TEXT_TAGS_LIST = TEXT_TAGS_SELECTOR.split(',').map(t => t.trim());
const TEXT_TAGS_NO_ATTR = ':not([data-ai-rtl-persian-text]):not([data-ai-rtl-english-text])';
const PERSIAN_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/; // No /g flag — use with .test() only. For .match(), use /g inline.
function buildContainerSelector(containers) {
    return containers.flatMap(c => TEXT_TAGS_LIST.map(t => c + ' ' + t + TEXT_TAGS_NO_ATTR)).join(', ');
}

class RTLAIStudioManager {
    constructor() {
        this.config = {
            isEnabled: true,
            selectedFont: 'vazir',
            fontSize: 'default',
            detectionMode: 'medium',
            enabledSites: []
        };

        this.processedElements = new WeakMap();
        this.stableElements = new WeakSet();
        this.observer = null;
        this.inputCheckTimer = null;
        this.aiStudioMutationObserver = null;
        this.heartbeatInterval = null;
        this.hasInitialized = false; // پرچم شروع موفق
        
        // بهینه‌سازی: timer manager ساده
        this.timers = new Map();
        this.lastMutationTime = 0;
        this.mutationDebounceTimer = null;
        this.processingQueue = new Set();
        this.lastFullScanTime = 0; // زمان آخرین اسکن کامل
        this.scrollHandler = null; // scroll handler reference
        this.intersectionObserver = null; // intersection observer reference
        this.intersectionObserverTimer = null; // intersection observer timer
        this.processedTextCache = new Map(); // کش متون پردازش شده با signature
        this.elementSignatureCache = new Map(); // کش signature عناصر
        
        // بهینه‌سازی: language detection cache
        this.languageCache = new Map();
        this.maxLanguageCacheSize = 200;
        
        // All timers are managed via this.timers Map
        
        // بهبود آمار برای debug
        this.stats = { 
            processedCount: 0, 
            inputCount: 0,
            errors: 0,
            heartbeatCount: 0,
            immediateProcessing: 0, // آمار پردازش فوری
            reprocessingCount: 0 // آمار پردازش مجدد
        };

        this.isAIStudio = this.detectAIStudio();
        this.isPerplexity = this.detectPerplexity();
        this.isChatGPT = this.detectChatGPT();
        this.currentDomain = this.getCurrentDomain();

        window.rtlAIStudioInitialized = true;
        this.lastUrl = location.href;

        this.startExtension();
        this.setupSpaUrlWatcher();
        this.startHeartbeat();
        this.startForceProcessing(); // شروع پردازش اجباری
        this.startGlobalComposerSweep(); // پوشش عمومی ادیتورها در همه سایت‌ها
        this.startEnableSitePolling(); // اطمینان از شروع در تب‌های جدید
    }

    getCurrentDomain() {
        try {
            return window.location.hostname;
        } catch (error) {
            return '';
        }
    }

    isSiteEnabled() {
        if (!this.currentDomain) return false;
        const sites = this.config && Array.isArray(this.config.enabledSites)
            ? this.config.enabledSites
            : [];
        return sites.includes(this.currentDomain);
    }

    detectAIStudio() {
        return /aistudio\.google\.com|makersuite\.google\.com/.test(window.location.hostname);
    }

    detectPerplexity() {
        return /perplexity\.ai/.test(window.location.hostname);
    }

    detectChatGPT() {
        try {
            return /chatgpt\.com|chat\.openai\.com/.test(window.location.hostname);
        } catch (_) {
            return false;
        }
    }

    // متد کمکی برای تشخیص سایت‌های چت ویژه
    isSpecialChatSite() {
        return this.isAIStudio || this.isPerplexity || this.isChatGPT;
    }

    startHeartbeat() {
        this.setTimer('heartbeat', () => {
            if (this.config.isEnabled && this.isSiteEnabled()) {
                try {
                    chrome.runtime.sendMessage({
                        action: 'heartbeat',
                        timestamp: Date.now(),
                        domain: this.currentDomain,
                        stats: this.getStats()
                    }).then(() => {
                        this.stats.heartbeatCount++;
                    }).catch((error) => {
                        console.log('Heartbeat failed (normal):', error.message);
                    });
                } catch (error) {
                    console.log('Heartbeat connection issue (normal):', error.message);
                }
            }
        }, 30000);
    }

    // متدهای جدید: مدیریت متمرکز timers
    setTimer(name, callback, interval) {
        this.clearTimer(name);
        const timerId = setInterval(callback, interval);
        this.timers.set(name, timerId);
        return timerId;
    }

    clearTimer(name) {
        if (this.timers.has(name)) {
            clearInterval(this.timers.get(name));
            this.timers.delete(name);
        }
    }

    clearAllTimers() {
        this.timers.forEach(timerId => clearInterval(timerId));
        this.timers.clear();
    }

    // اضافه کردن Force Processing برای اطمینان از عملکرد فوری - بهینه‌سازی شده
    startForceProcessing() {
        this.setTimer('forceProcessing', () => {
            if (this.config.isEnabled && this.isSiteEnabled()) {
                try {
                    if (typeof window.requestIdleCallback === 'function') {
                        window.requestIdleCallback(() => this.forceReprocessUnprocessedContent(), { timeout: 100 });
                    } else {
                        // استفاده از setTimeout برای defer processing
                        setTimeout(() => this.forceReprocessUnprocessedContent(), 0);
                    }
                } catch (_) {
                    this.forceReprocessUnprocessedContent();
                }
            }
        }, 2000);
    }

    // پردازش اجباری محتوای پردازش نشده - بهینه‌سازی شده با caching
    forceReprocessUnprocessedContent() {
        try {
            // استفاده از Intersection Observer برای عناصر viewport
            if (!this.intersectionObserver) {
                this.setupIntersectionObserver();
            }

            // پردازش سریع عناصر جدید با استفاده از cache
            this.processNewElementsWithCache();
            
            // فقط برای سایت‌های چت: پردازش محدود عناصر خارج از viewport
            if (this.isSpecialChatSite()) {
                this.processChatElementsOptimized();
            }
        } catch (error) {
            console.error('Force processing error:', error);
            this.stats.errors++;
        }
    }

    // روش جدید: پردازش با استفاده از cache signature
    processNewElementsWithCache() {
        const elements = this.getElementsForProcessing();
        const unprocessed = elements.filter(el => 
            this.isSafeElementForProcessing(el) && 
            !this.stableElements.has(el) &&
            !this.isElementProcessed(el)
        );

        // محدود کردن پردازش برای جلوگیری از blocking
        const batchSize = Math.min(unprocessed.length, 50);
        for (let i = 0; i < batchSize; i++) {
            const element = unprocessed[i];
            const signature = this.getElementSignature(element);
            
            if (!this.elementSignatureCache.has(signature)) {
                const text = this.getCleanText(element);
                if (text && this.hasAnyPersianChar(text)) {
                    this.processElement(element);
                    this.stableElements.add(element);
                    this.elementSignatureCache.set(signature, true);
                }
            }
        }
    }

    // بهینه‌سازی querySelector با استفاده از CSS selectors سریعتر
    getElementsForProcessing() {
        // Comprehensive tag list: includes a, button, label, option, figcaption, summary, em, strong, etc.
        const selectors = TEXT_TAGS_SELECTOR + ', [role="text"], [data-testid*="message"], .message';
        return Array.from(document.querySelectorAll(selectors))
            .filter(el => !el.hasAttribute('data-ai-rtl-persian-text') &&
                         !el.hasAttribute('data-ai-rtl-english-text'));
    }

    // ایجاد signature منحصر به فرد برای عناصر
    getElementSignature(element) {
        return `${element.tagName}_${element.textContent?.slice(0, 50)}_${element.className}`;
    }

    // بررسی آیا عنصر قبلاً پردازش شده
    isElementProcessed(element) {
        return element.hasAttribute('data-ai-rtl-persian-text') || 
               element.hasAttribute('data-ai-rtl-english-text') ||
               this.stableElements.has(element);
    }


    // پردازش بهینه عناصر چت با batch processing
    processChatElementsOptimized() {
        const chatSelectors = [
            '.prose', '.markdown', '.chat-message', '.message-content',
            '[data-testid="message-content"]', '.assistant-message', '.user-message'
        ];
        
        const elements = document.querySelectorAll(chatSelectors.join(', '));
        const unprocessed = Array.from(elements).filter(el => 
            this.isSafeElementForProcessing(el) && !this.isElementProcessed(el)
        );

        // پردازش در batch‌های کوچک
        const batchSize = 20;
        for (let i = 0; i < Math.min(unprocessed.length, batchSize); i++) {
            const element = unprocessed[i];
            const text = this.getCleanText(element);
            if (text && this.hasAnyPersianChar(text)) {
                this.processElement(element);
                this.stableElements.add(element);
            }
        }
    }

    // راه‌اندازی Intersection Observer برای عناصر viewport
    async startExtension() {
        try {
            await this.loadSettings();
            
            if (this.config.isEnabled && this.isSiteEnabled()) {
        
                
                this.injectPersianFonts();
                this.setupSmartObserver();
                
                // پردازش فوری و چندبار برای اطمینان
                await this.immediateProcessAllContent();
                
                this.startInputMonitoring();
                if (this.isAIStudio) {
                    this._setupSiteMonitoring('AIStudio', 'processAIStudioSpecialElements', 500, 3000);
                    this.setupAIStudioMutationObserver();
                }
                if (this.isPerplexity) this._setupSiteMonitoring('Perplexity', 'processPerplexitySpecialElements', 800, 5000, () => {
                    if (this.shouldPerformPerplexityFullScan()) {
                                setTimeout(() => this.performFullPageScan(), 500);
                    }
                });
                if (this.isChatGPT) this._setupSiteMonitoring('ChatGPT', 'processChatGPTSpecialElements', 1000, 8000);
                
                // پردازش اضافی برای اطمینان
                setTimeout(() => this.immediateProcessAllContent(), 500);
                setTimeout(() => this.immediateProcessAllContent(), 1500);
                setTimeout(() => this.immediateProcessAllContent(), 3000);
                this.hasInitialized = true;
            } else {
    
            }
        } catch (error) {
            console.error('RTL AI Studio: Start extension error:', error);
            this.stats.errors++;
        }
    }

    // پردازش فوری تمام محتوا - بهینه‌سازی شده
    async immediateProcessAllContent() {
        try {
            
            
            // استفاده از TEXT_TAGS_SELECTOR برای پوشش کامل تمام برچسبهای متنی
            const selectors = TEXT_TAGS_SELECTOR.split(',').map(t => t.trim() + ':not([data-ai-rtl-processed])').join(', ');
            
            const allTextElements = document.querySelectorAll(selectors);
            let processedCount = 0;
            
            // پردازش batch-based برای جلوگیری از blocking
            const batchSize = 100;
            const elementsArray = Array.from(allTextElements);
            for (let i = 0; i < elementsArray.length; i += batchSize) {
                const batch = elementsArray.slice(i, i + batchSize);
                batch.forEach(element => {
                    if (this.isSafeElementForProcessing(element) && !this.stableElements.has(element)) {
                        this.processElement(element);
                        if (this.processedElements.has(element)) {
                            this.stableElements.add(element);
                            element.setAttribute('data-ai-rtl-processed', 'true');
                            processedCount++;
                        }
                    }
                });
                
                // اجازه دهیم browser breath کند
                if (i + batchSize < allTextElements.length) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

            // پردازش inputs در batch جداگانه
            this.processInputs(document);

            // پردازش ویژه سایت - فقط اگر لازم باشد
            if (this.isAIStudio && this.shouldProcessSpecialElements()) {
                this.processAIStudioSpecialElements();
            }
            if (this.isPerplexity && this.shouldProcessSpecialElements()) {
                this.processPerplexitySpecialElements();
            }

            this.stats.immediateProcessing++;
            
            
        } catch (error) {
            console.error('Immediate processing error:', error);
            this.stats.errors++;
        }
    }

    // بررسی آیا باید عناصر ویژه را پردازش کنیم
    shouldProcessSpecialElements() {
        return this.isSiteEnabled() && this.config.isEnabled;
    }

    // پردازش بهینه inputs

    async loadSettings() {
        return new Promise(resolve => {
            chrome.storage.sync.get({
                isEnabled: true,
                selectedFont: 'vazir',
                fontSize: 'default',
                detectionMode: 'medium',
                enabledSites: []
            }, (result) => {
                this.config = result;
                resolve();
            });
        });
    }

    getFontFamily() {
        const fonts = {
            vazir: "'VazirAIStudio', 'Vazir', Tahoma, Arial, sans-serif",
            shabnam: "'ShabnamAIStudio', 'Shabnam', Tahoma, Arial, sans-serif",
            default: null
        };
        return fonts[this.config.selectedFont] || null;
    }

    getFontSize() {
        const sizes = {
            default: null,
            small: '12px',
            medium: '16px',
            large: '18px'
        };
        return sizes[this.config.fontSize] || null;
    }

    // بهبود CSS injection با بررسی موفقیت بارگذاری
    injectPersianFonts() {
        if (!this.isSiteEnabled()) return;
        
        const existingFont = document.getElementById('ai-rtl-fonts');
        if (existingFont) existingFont.remove();

        const vazirUrl = chrome.runtime.getURL('vazir.woff2');
        const shabnamUrl = chrome.runtime.getURL('shabnam.woff2');
        const fontStyle = document.createElement('style');
        fontStyle.id = 'ai-rtl-fonts';

        const fontFamily = this.getFontFamily();
        const fontSize = this.getFontSize();
        const fontFamilyCSS = fontFamily ? `font-family: ${fontFamily} !important;` : '';
        const fontSizeCSS = fontSize ? `font-size: ${fontSize} !important;` : '';

        // بررسی موفقیت بارگذاری فونت‌ها
        this.verifyFontLoading();

        fontStyle.textContent = this.generateOptimizedCSS(vazirUrl, shabnamUrl, fontFamilyCSS, fontSizeCSS);

        document.head.appendChild(fontStyle);
    }

    // تولید CSS بهینه‌شده
    generateOptimizedCSS(vazirUrl, shabnamUrl, fontFamilyCSS, fontSizeCSS) {
        const persianElements = [
            'p[data-ai-rtl-persian-text="true"]',
            'span[data-ai-rtl-persian-text="true"]',
            'h1[data-ai-rtl-persian-text="true"]',
            'h2[data-ai-rtl-persian-text="true"]',
            'h3[data-ai-rtl-persian-text="true"]',
            'h4[data-ai-rtl-persian-text="true"]',
            'h5[data-ai-rtl-persian-text="true"]',
            'h6[data-ai-rtl-persian-text="true"]',
            'li[data-ai-rtl-persian-text="true"]',
            'td[data-ai-rtl-persian-text="true"]',
            'th[data-ai-rtl-persian-text="true"]',
            'tr[data-ai-rtl-persian-text="true"]',
            'blockquote[data-ai-rtl-persian-text="true"]',
            'div[data-ai-rtl-persian-text="true"]',
            'a[data-ai-rtl-persian-text="true"]',
            'button[data-ai-rtl-persian-text="true"]',
            'label[data-ai-rtl-persian-text="true"]',
            'option[data-ai-rtl-persian-text="true"]',
            'optgroup[data-ai-rtl-persian-text="true"]',
            'legend[data-ai-rtl-persian-text="true"]',
            'figcaption[data-ai-rtl-persian-text="true"]',
            'caption[data-ai-rtl-persian-text="true"]',
            'summary[data-ai-rtl-persian-text="true"]',
            'details[data-ai-rtl-persian-text="true"]',
            'cite[data-ai-rtl-persian-text="true"]',
            'q[data-ai-rtl-persian-text="true"]',
            'em[data-ai-rtl-persian-text="true"]',
            'strong[data-ai-rtl-persian-text="true"]',
            'b[data-ai-rtl-persian-text="true"]',
            'i[data-ai-rtl-persian-text="true"]',
            'u[data-ai-rtl-persian-text="true"]',
            'mark[data-ai-rtl-persian-text="true"]',
            'small[data-ai-rtl-persian-text="true"]',
            'del[data-ai-rtl-persian-text="true"]',
            'ins[data-ai-rtl-persian-text="true"]',
            'sub[data-ai-rtl-persian-text="true"]',
            'sup[data-ai-rtl-persian-text="true"]',
            'time[data-ai-rtl-persian-text="true"]',
            'abbr[data-ai-rtl-persian-text="true"]',
            'dd[data-ai-rtl-persian-text="true"]',
            'dt[data-ai-rtl-persian-text="true"]',
            'address[data-ai-rtl-persian-text="true"]',
            'output[data-ai-rtl-persian-text="true"]',
            'thead[data-ai-rtl-persian-text="true"]',
            'tbody[data-ai-rtl-persian-text="true"]',
            'tfoot[data-ai-rtl-persian-text="true"]'
        ];

        const persianInputs = [
            'input[data-ai-rtl-persian-input="true"]',
            'textarea[data-ai-rtl-persian-input="true"]',
            '[contenteditable="true"][data-ai-rtl-persian-input="true"]',
            '[role="textbox"][data-ai-rtl-persian-input="true"]'
        ];

        const perplexitySpecialElements = [
            '.prose [data-ai-rtl-persian-text="true"]',
            '[data-testid="answer"] [data-ai-rtl-persian-text="true"]',
            '.answer [data-ai-rtl-persian-text="true"]',
            '[data-cplx-component="message-block-answer"] [data-ai-rtl-persian-text="true"]',
            '.max-w-threadContentWidth [data-ai-rtl-persian-text="true"]',
            '.group\\/query [data-ai-rtl-persian-text="true"]'
        ];

        return `
            /* Font Face Definitions */
            @font-face {
                font-family: 'VazirAIStudio';
                src: url('${vazirUrl}') format('woff2');
                font-display: swap;
                font-weight: normal;
                font-style: normal;
            }
            @font-face {
                font-family: 'ShabnamAIStudio';
                src: url('${shabnamUrl}') format('woff2');
                font-display: swap;
                font-weight: normal;
                font-style: normal;
            }
            
            /* Persian Text Elements */
            ${persianElements.join(',\n            ')} {
                direction: rtl !important;
                text-align: right !important;
                ${fontFamilyCSS}
                ${fontSizeCSS}
                unicode-bidi: isolate !important;
            }

            /* Persian List Containers - RTL-aware padding */
            [data-ai-rtl-persian-text="true"] ol,
            [data-ai-rtl-persian-text="true"] ul,
            [data-ai-rtl-persian-text="true"] [role="list"],
            [data-ai-rtl-persian-text="true"] [role="listbox"] {
                padding-inline-start: 1.5em !important;
                padding-inline-end: 0 !important;
            }
            

            

            /* Persian Text Children (excluding code elements) */
            [data-ai-rtl-persian-text="true"] *:not(code):not(pre):not([class*="language-"]) {
                ${fontFamilyCSS}
                ${fontSizeCSS}
            }
            
            /* Persian Input Elements */
            ${persianInputs.join(',\n            ')} {
                direction: rtl !important;
                text-align: right !important;
                ${fontFamilyCSS}
                ${fontSizeCSS}
                unicode-bidi: isolate !important;
            }
            
            /* Code Elements Always LTR */
            [data-ai-rtl-persian-text="true"] code,
            [data-ai-rtl-persian-text="true"] pre,
            [data-ai-rtl-persian-text="true"] .highlight,
            [data-ai-rtl-persian-text="true"] [class*="language-"] {
                direction: ltr !important;
                text-align: left !important;
                font-family: 'Consolas', 'Monaco', 'Courier New', monospace !important;
                unicode-bidi: normal !important;
            }
            
            /* Perplexity Special Elements */
            ${perplexitySpecialElements.join(',\n            ')} {
                direction: rtl !important;
                text-align: right !important;
                ${fontFamilyCSS}
                ${fontSizeCSS}
                unicode-bidi: isolate !important;
            }
        `;
    }

    // بررسی موفقیت بارگذاری فونت‌ها
    async verifyFontLoading() {
        try {
            const fonts = ['VazirAIStudio', 'ShabnamAIStudio'];
            const promises = fonts.map(fontName => {
                return document.fonts.load(`16px ${fontName}`).then(() => {
                    
                    return true;
                }).catch(() => {
                    console.warn(`RTL AI Studio: Font ${fontName} failed to load`);
                    return false;
                });
            });

            const results = await Promise.all(promises);
            const successCount = results.filter(Boolean).length;
            
            
            // اگر هیچ فونتی لود نشد، از فونت‌های پیش‌فرض استفاده کن
            if (successCount === 0) {
                this.applyFallbackFonts();
            }
        } catch (error) {
            console.warn('RTL AI Studio: Font verification failed:', error);
            this.applyFallbackFonts();
        }
    }

    processAIStudioSpecialElements() {
        const chatTargets = document.querySelectorAll(
            buildContainerSelector(['.conversation-container', '.chat-message', '.message-content', '.model-response']) +
            ', ms-textarea textarea, textarea[aria-label*="prompt" i]'
        );

        let processed = 0;
        chatTargets.forEach(msg => {
            if (msg.tagName === 'TEXTAREA') {
                this.setupSmartInputHandler(msg);
                this.stableElements.add(msg);
                processed++;
            } else {
                if (this.isSafeElementForProcessing(msg) && !this.stableElements.has(msg)) {
                    this.processElement(msg);
                    if (this.processedElements.has(msg)) {
                        this.stableElements.add(msg);
                        processed++;
                    }
                }
            }
        });

        if (processed > 0) {
            
        }

        this.processInputs(document);
    }

    processPerplexitySpecialElements() {
        // کاهش محدودیت برای پردازش بیشتر
        const perplexityTargets = document.querySelectorAll(
            buildContainerSelector(['.prose', '.answer', '[data-testid="answer"]', '[data-cplx-component="message-block-answer"]', '.max-w-threadContentWidth', '.group\\/query']) +
            ', textarea[aria-label*="Ask" i], textarea[aria-label*="type" i], [role="textbox"]'
        );

        let processed = 0;
        perplexityTargets.forEach(element => {
            if (element.tagName === 'TEXTAREA' || element.getAttribute('role') === 'textbox' || element.matches('[contenteditable="true"]')) {
                const leaf = this.findEditableLeaf(element);
                if (leaf && !this.stableElements.has(leaf)) {
                    this.setupSmartInputHandler(leaf);
                    this.stableElements.add(leaf);
                    processed++;
                }
            } else {
                if (this.isSafeElementForProcessing(element) && !this.stableElements.has(element)) {
                    this.processElement(element);
                    if (this.processedElements.has(element)) {
                        this.stableElements.add(element);
                        processed++;
                    }
                }
            }
        });

        if (processed > 0) {
            
        }

        this.processInputs(document);
    }

    // اعمال فونت‌های پیش‌فرض در صورت عدم موفقیت
    applyFallbackFonts() {
        const fallbackStyle = document.getElementById('ai-rtl-fallback-fonts');
        if (fallbackStyle) return; // قبلاً اضافه شده

        const style = document.createElement('style');
        style.id = 'ai-rtl-fallback-fonts';
        style.textContent = `
            [data-ai-rtl-persian-text="true"],
            [data-ai-rtl-persian-input="true"] {
                font-family: Tahoma, Arial, sans-serif !important;
            }
        `;
        document.head.appendChild(style);
        
    }

    getDetectionThreshold() {
        // درست کردن منطق threshold ها
        const thresholds = { 
            high: 0.25,   // حساسیت بالا: 25% فارسی کافی است
            medium: 0.4,  // حساسیت متوسط: 40% فارسی
            low: 0.6      // حساسیت پایین: 60% فارسی
        };
        return thresholds[this.config.detectionMode] || 0.4;
    }

    setupSmartObserver() {
        if (this.observer) this.observer.disconnect();
        
        this.observer = new MutationObserver((mutations) => {
            this.lastMutationTime = Date.now();
            
            const relevantMutations = mutations.filter(mutation => {
                if (mutation.type === 'childList') {
                    if (mutation.addedNodes.length === 0) return false;
                    // بهبود: اسکرول containers را در همه سایت‌ها در نظر بگیر
                    if (this.isScrollContainer(mutation.target) && !this.isSpecialChatSite()) return false;
                    return true;
                }
                // بهبود: تغییر متن موجود را در همه سایت‌های چت پردازش کن
                if (this.isSpecialChatSite() && mutation.type === 'characterData') {
                    const targetNode = mutation.target;
                    const el = targetNode.nodeType === Node.TEXT_NODE ? targetNode.parentElement : targetNode;
                    if (!el) return false;
                    const chatSelectors = [
                        // AI Studio
                        '.conversation-container', '.chat-message', '.model-response', '.message-content',
                        // Perplexity
                        '.prose', '.answer', '[data-testid="answer"]', '[data-cplx-component="message-block-answer"]',
                        '.max-w-threadContentWidth', '.group\\/query',
                        // ChatGPT
                        '[data-testid="conversation-turn"]', '[data-message-author-role]', '.markdown', '[data-testid="markdown"]',
                        // عمومی
                        '[role="main"]', 'main'
                    ];
                    const inChat = el.closest(chatSelectors.join(', '));
                    return !!inChat;
                }
                return false;
            });

            if (relevantMutations.length === 0) return;

            // پردازش فوری برای تغییرات جدید
            clearTimeout(this.mutationDebounceTimer);
            this.mutationDebounceTimer = setTimeout(() => {
                this.processMutationsInBatches(relevantMutations);
            }, 50); // کاهش delay برای پاسخ سریعتر
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: this.isSpecialChatSite()
        });

        // اضافه کردن scroll event listener برای محتوای lazy-loaded
        this.setupScrollHandler();
        
        // اضافه کردن IntersectionObserver برای تشخیص بهتر عناصر
        this.setupIntersectionObserver();
    }

    isScrollContainer(element) {
        if (!element || !element.style) return false;
        const style = getComputedStyle(element);
        const overflowY = style.overflowY;
        const overflowX = style.overflowX;
        return overflowY === 'scroll' || overflowY === 'auto' ||
               overflowX === 'scroll' || overflowX === 'auto' ||
               element.scrollHeight > element.clientHeight;
    }

    // مدیریت scroll events برای محتوای lazy-loaded
    setupScrollHandler() {
        if (this.scrollHandler) return; // قبلاً تنظیم شده

        let scrollTimeout;
        this.scrollHandler = () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                if (this.config.isEnabled && this.isSiteEnabled()) {
                    // پردازش محتوای جدید پس از اسکرول
                    this.processNewScrollContent();
                    
                    // برای سایت‌های چت: اسکن فوری اضافی
                    if (this.isSpecialChatSite()) {
                        setTimeout(() => {
                            this.aggressiveAIStudioRecheck();
                        }, 500);
                    }
                }
            }, 200);
        };

        // اضافه کردن listener به window و containers اصلی
        window.addEventListener('scroll', this.scrollHandler, { passive: true });
        
        // برای سایت‌های چت، containers خاص را هم monitor کن
        if (this.isSpecialChatSite()) {
            const chatContainers = document.querySelectorAll([
                '.conversation-container', // AI Studio
                '.max-w-threadContentWidth', // Perplexity
                '[data-testid="conversation-panel"]', // ChatGPT
                'main', '[role="main"]' // عمومی
            ].join(', '));

            chatContainers.forEach(container => {
                if (container && this.isScrollContainer(container)) {
                    container.addEventListener('scroll', this.scrollHandler, { passive: true });
                }
            });
        }
    }

    // پردازش محتوای جدید پس از اسکرول
    processNewScrollContent() {
        try {
            // یافتن عناصر جدید در viewport با margin بیشتر
            const viewportElements = this.getElementsInViewport(true);
            let processed = 0;

            viewportElements.forEach(element => {
                if (this.isSafeElementForProcessing(element) && !this.stableElements.has(element)) {
                    const text = this.getCleanText(element);
                    if (text && this.hasAnyPersianChar(text)) {
                        this.processElement(element);
                        this.stableElements.add(element);
                        processed++;
                    }
                }
            });

            // ویژه سایت‌های چت: بررسی مجدد عناصر بدون attribute
            if (this.isSpecialChatSite()) {
                viewportElements.forEach(element => {
                    if (!element.hasAttribute('data-ai-rtl-persian-text') && 
                        !element.hasAttribute('data-ai-rtl-english-text')) {
                        const text = this.getCleanText(element);
                        if (text && this.isElementAlreadyProcessed(element, text)) {
                            processed++;
                        }
                    }
                });
            }

            if (processed > 0) {
                
                this.stats.reprocessingCount++;
            }

            // برای چت‌های طولانی، گاهی اوقات اسکن کامل انجام بده
            this.scheduleFullPageScanIfNeeded();
            
        } catch (error) {
            console.error('Scroll content processing error:', error);
            this.stats.errors++;
        }
    }

    // برنامه‌ریزی اسکن کامل در صورت نیاز
    scheduleFullPageScanIfNeeded() {
        // اگر در سایت‌های چت هستیم و اسکرول زیاد شده
        if (!this.isSpecialChatSite()) return;
        
        const now = Date.now();
        const scrollHeight = document.body.scrollHeight || document.documentElement.scrollHeight;
        const viewportHeight = window.innerHeight;
        
        // اگر صفحه خیلی طولانی است (بیش از 3 برابر viewport)
        if (scrollHeight > viewportHeight * 3) {
            // اگر 15 ثانیه از آخرین اسکن کامل گذشته
            if (!this.lastFullScanTime || (now - this.lastFullScanTime) > 15000) {
                this.lastFullScanTime = now;
                
                
                // اسکن کامل را با تأخیر کمتر انجام بده
                setTimeout(() => {
                    this.performFullPageScan();
                }, 1000);
            }
        }
    }

    // یافتن عناصر در viewport با margin بیشتر برای چت‌های طولانی
    getElementsInViewport(expandedRange = false) {
        const elements = [];
        const viewportHeight = window.innerHeight;
        const scrollTop = window.scrollY;
        
        // برای چت‌های طولانی، margin بیشتری در نظر بگیر
        const margin = expandedRange ? 1000 : 400; // افزایش margin
        
        // Comprehensive text-bearing tags (a, button, label, figcaption, etc. included)
        const candidates = document.querySelectorAll(TEXT_TAGS_SELECTOR);
        
        candidates.forEach(element => {
            try {
                const rect = element.getBoundingClientRect();
                // عناصر در viewport یا نزدیک آن
                if (rect.top < viewportHeight + margin && rect.bottom > -margin) {
                    elements.push(element);
                }
            } catch (_) {}
        });

        return elements;
    }

    // تنظیم IntersectionObserver برای تشخیص عناصر وارد viewport
    setupIntersectionObserver() {
        if (!window.IntersectionObserver || this.intersectionObserver) return;

        try {
            this.intersectionObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const element = entry.target;
                        if (this.isSafeElementForProcessing(element) && !this.stableElements.has(element)) {
                            const text = this.getCleanText(element);
                            if (text && this.hasAnyPersianChar(text)) {
                                this.processElement(element);
                                this.stableElements.add(element);
                                // حذف از observer چون پردازش شده
                                this.intersectionObserver.unobserve(element);
                            }
                        }
                    }
                });
            }, {
                root: null,
                rootMargin: '200px', // margin برای تشخیص زودهنگام
                threshold: 0.1
            });

            // شروع observe کردن عناصر موجود
            this.observeExistingElements();
            
            // هر 10 ثانیه عناصر جدید را observe کن
            this.intersectionObserverTimer = setInterval(() => {
                this.observeExistingElements();
            }, 10000);

        } catch (error) {
            console.error('IntersectionObserver setup error:', error);
        }
    }

    // observe کردن عناصر موجود
    observeExistingElements() {
        if (!this.intersectionObserver) return;

        try {
            // Comprehensive tag list (excludes div which has a separate block-child guard)
            const _tagsObs = TEXT_TAGS_SELECTOR;
            const unprocessedElements = document.querySelectorAll(
                _tagsObs.split(',').map(t => t.trim() + ':not([data-ai-rtl-persian-text]):not([data-ai-rtl-english-text])').join(', ')
            );

            // محدود کردن تعداد عناصر observe شده
            let observeCount = 0;
            const maxObserve = 200;

            unprocessedElements.forEach(element => {
                if (observeCount >= maxObserve) return;
                if (this.isSafeElementForProcessing(element) && !this.stableElements.has(element)) {
                    const text = this.getCleanText(element);
                    if (text && this.hasAnyPersianChar(text)) {
                        this.intersectionObserver.observe(element);
                        observeCount++;
                    }
                }
            });

            if (observeCount > 0) {
                
            }
        } catch (error) {
            console.error('Error observing elements:', error);
        }
    }

    // اسکن کامل صفحه برای چت‌های طولانی
    performFullPageScan() {
        try {
            
            
            // Comprehensive tag list — picks up a, button, label, figcaption, summary, em, strong, etc.
            const _tagsFull = TEXT_TAGS_SELECTOR;
            const allElements = document.querySelectorAll(
                _tagsFull.split(',').map(t => t.trim() + ':not([data-ai-rtl-persian-text]):not([data-ai-rtl-english-text])').join(', ')
            );

            let processedCount = 0;
            const batchSize = 50; // پردازش در دسته‌های کوچک
            
            // پردازش در batch ها برای جلوگیری از blocking
            const processBatch = (startIndex) => {
                const endIndex = Math.min(startIndex + batchSize, allElements.length);
                
                for (let i = startIndex; i < endIndex; i++) {
                    const element = allElements[i];
                    if (this.isSafeElementForProcessing(element) && !this.stableElements.has(element)) {
                        const text = this.getCleanText(element);
                        if (text && this.hasAnyPersianChar(text)) {
                            this.processElement(element);
                            this.stableElements.add(element);
                            processedCount++;
                        }
                    }
                }

                // ادامه پردازش در batch بعدی
                if (endIndex < allElements.length) {
                    setTimeout(() => processBatch(endIndex), 10);
                } else {
                    
                    this.stats.reprocessingCount++;
                }
            };

            // شروع پردازش
            if (allElements.length > 0) {
                processBatch(0);
            }
            
        } catch (error) {
            console.error('Full page scan error:', error);
            this.stats.errors++;
        }
    }

    async processMutationsInBatches(mutations) {
        const elementsToProcess = new Set();
        
        mutations.forEach(mutation => {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE && this.isSafeElementForProcessing(node)) {
                        if (!this.stableElements.has(node)) {
                            elementsToProcess.add(node);
                            
                            // شامل همه فرزندان — comprehensive tag list
                            const children = node.querySelectorAll(TEXT_TAGS_SELECTOR);
                            children.forEach(child => {
                                if (this.isSafeElementForProcessing(child) && !this.stableElements.has(child)) {
                                    elementsToProcess.add(child);
                                }
                            });
                        }
                    }
                });
            } else if (this.isSpecialChatSite() && mutation.type === 'characterData') {
                // برای تغییرات متن موجود در سایت‌های چت
                const node = mutation.target;
                const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
                if (el && this.isSafeElementForProcessing(el) && !this.stableElements.has(el)) {
                    elementsToProcess.add(el);
                    // والد نزدیک پیام را هم در نظر بگیر
                    const parentMsg = el.closest('.chat-message, .model-response, .message-content, .prose, .answer, [data-testid="answer"]');
                    if (parentMsg && !this.stableElements.has(parentMsg)) {
                        elementsToProcess.add(parentMsg);
                    }
                }
            }
        });

        // پردازش فوری بدون delay
        elementsToProcess.forEach(element => {
            this.processElement(element);
            if (this.processedElements.has(element)) {
                this.stableElements.add(element);
            }
        });

        this.processInputs(document);
        
        // تریگر اسکن اضطراری در صورت وجود عناصر زیاد پردازش نشده
        this.triggerEmergencyScanIfNeeded(elementsToProcess.size);
    }

    // تریگر اسکن اضطراری
    triggerEmergencyScanIfNeeded(processedCount) {
        if (!this.isSpecialChatSite()) return;
        
        // اگر عناصر زیادی پردازش شدند، احتمالاً محتوای جدید زیادی اضافه شده
        if (processedCount > 10) {
            
            setTimeout(() => {
                this.performFullPageScan();
            }, 2000);
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    processInputs(root = document) {
        try {
        let inputSelector = 
            'input, textarea, [contenteditable="true"], [role="textbox"], .search-input, .search-box, textarea[placeholder], div[contenteditable="true"], ' +
            // Editors and chat composers (generic patterns)
            '[data-testid*="textbox" i], [data-testid*="editor" i], [data-testid*="composer" i], [data-testid*="query" i], ' +
            '[data-cplx-component*="composer" i], [data-cplx-component*="query" i], ' +
            '.mde-textarea, .ql-editor, .monaco-editor textarea, .ProseMirror, .lexical-editor';

        // ChatGPT specific selectors
        if (this.isChatGPT) {
            inputSelector += ', ' +
                // ChatGPT main input
                '[data-testid="chat-input"], [data-testid="prompt-textarea"], ' +
                '#prompt-textarea, [id*="prompt"], [placeholder*="Message"], ' +
                // ChatGPT composer variations
                '[class*="composer"], [class*="textarea"], [class*="input-area"], ' +
                // Generic ChatGPT patterns
                'div[contenteditable][role="textbox"], textarea[placeholder*="ChatGPT"], ' +
                'div[dir="auto"][contenteditable="true"], [data-id*="root"]';
        }

        const allInputs = root.querySelectorAll(inputSelector);
            
            allInputs.forEach(input => {
                const leaf = this.findEditableLeaf(input);
                if (!leaf) return;
                if (this.isSafeElementForProcessing(leaf) && !this.stableElements.has(leaf)) {
                    this.setupSmartInputHandler(leaf);
                    this.stableElements.add(leaf);
                }
            });
        } catch (error) {
            console.error('Error processing inputs:', error);
            this.stats.errors++;
        }
    }

    // پیدا کردن عنصر واقعی قابل ویرایش (برخی کامپوزرها wrapper دارند)
    findEditableLeaf(element) {
        try {
            if (!element) return null;
            if (element.nodeType !== 1) return null;
            if (element.matches && element.matches('textarea, input[type="text"], input[type="search"], [contenteditable="true"], [role="textbox"]')) return element;
            const inner = element.querySelector && element.querySelector('textarea, input[type="text"], input[type="search"], [contenteditable="true"], [role="textbox"]');
            if (inner) return inner;
            return null;
        } catch (_) { return null; }
    }

    // ============================================================
    // DRY refactoring: Consolidated monitoring and recheck methods
    // ============================================================

    _setupSiteMonitoring(siteName, processMethod, checkInterval, emergencyInterval, extrasCallback = null) {
        this.setTimer(siteName + 'Check', () => {
            this[processMethod]();
            this.processInputs(document);
            this._recheckElements(siteName);
            if (extrasCallback) extrasCallback();
        }, checkInterval);

        this.setTimer(siteName + 'Emergency', () => {
            if (this.config.isEnabled && this.isSiteEnabled()) {
                this.aggressiveAIStudioRecheck();
            }
        }, emergencyInterval);
    }

    // Consolidated recheck method (DRY: replaces 3 separate recheck methods)
    _recheckElements(siteName) {
        const configs = {
            'AIStudio': {
                selectors: TEXT_TAGS_SELECTOR,
                maxRecheck: 50,
                logName: 'Google AI Studio'
            },
            'Perplexity': {
                selectors: '.prose :not([data-ai-rtl-persian-text]):not([data-ai-rtl-english-text]), .answer :not([data-ai-rtl-persian-text]):not([data-ai-rtl-english-text]), ' +
                           '[data-testid="answer"] :not([data-ai-rtl-persian-text]):not([data-ai-rtl-english-text]), [data-cplx-component="message-block-answer"] :not([data-ai-rtl-persian-text]):not([data-ai-rtl-english-text]), ' +
                           '.max-w-threadContentWidth :not([data-ai-rtl-persian-text]):not([data-ai-rtl-english-text]), .group\\/query :not([data-ai-rtl-persian-text]):not([data-ai-rtl-english-text]), ' +
                           TEXT_TAGS_SELECTOR,
                maxRecheck: 60,
                logName: 'Perplexity'
            },
            'ChatGPT': {
                selectors: '[data-testid="conversation-turn"] :not([data-ai-rtl-persian-text]):not([data-ai-rtl-english-text]), ' +
                           '[data-message-author-role] :not([data-ai-rtl-persian-text]):not([data-ai-rtl-english-text]), ' +
                           '.markdown :not([data-ai-rtl-persian-text]):not([data-ai-rtl-english-text]), ' +
                           TEXT_TAGS_SELECTOR,
                maxRecheck: 70,
                logName: 'ChatGPT'
            }
        };

        const config = configs[siteName];
        if (!config) return;
        if (!this['is' + siteName]) return;

        try {
            const textElements = document.querySelectorAll(config.selectors);

            let recheckCount = 0;

            textElements.forEach(element => {
                if (recheckCount >= config.maxRecheck) return;

                const text = this.getCleanText(element);
                if (!text || text.length < 1) return;

                // Re-process elements that lost their attribute but still have Persian text
                if (!element.hasAttribute('data-ai-rtl-persian-text') &&
                    !element.hasAttribute('data-ai-rtl-english-text')) {

                    // Check cache for previous state
                    if (this.isElementAlreadyProcessed(element, text)) {
                        recheckCount++;
                        return;
                    }

                    // If has Persian text, process it
                    if (this.hasAnyPersianChar(text)) {
                        this.processElement(element);
                        recheckCount++;
                    }
                }
            });

            if (recheckCount > 0) {
                
            }
        } catch (error) {
            console.error('Error in _recheckElements for ' + config.logName + ':', error);
        }
    }

    // بررسی تهاجمی برای سایت‌های چت پس از اسکرول
    aggressiveAIStudioRecheck() {
        if (!this.isSpecialChatSite()) return;

        try {
            // Comprehensive list + chat-specific class hints
            const allTextElements = document.querySelectorAll(
                TEXT_TAGS_SELECTOR + ', div[class*="text"], div[class*="content"], div[class*="message"]'
            );

            let recheckCount = 0;
            const maxRecheck = 100; // افزایش محدودیت

            allTextElements.forEach(element => {
                if (recheckCount >= maxRecheck) return;

                // بررسی اینکه آیا عنصر در viewport است
                try {
                    const rect = element.getBoundingClientRect();
                    const isInViewport = rect.top < window.innerHeight + 500 && 
                                       rect.bottom > -500;
                    
                    if (!isInViewport) return;
                } catch (_) {
                    return;
                }

                const text = this.getCleanText(element);
                if (!text || text.length < 1) return;

                // اگر متن فارسی دارد اما attribute ندارد
                if (this.hasAnyPersianChar(text)) {
                    if (!element.hasAttribute('data-ai-rtl-persian-text')) {
                        // بررسی کش
                        if (this.isElementAlreadyProcessed(element, text)) {
                            recheckCount++;
                            return;
                        }

                        // پردازش مجدد
                        this.processElement(element);
                        recheckCount++;
                    }
                    // حتی اگر attribute دارد، style هایش را بررسی کن
                    else {
                        this.ensureProperStyling(element);
                        recheckCount++;
                    }
                }
            });

            if (recheckCount > 0) {
                const siteName = this.isAIStudio ? 'Google AI Studio' : 
                               this.isPerplexity ? 'Perplexity' : 
                               this.isChatGPT ? 'ChatGPT' : 'Chat Site';
                
            }
        } catch (error) {
            console.error('Error in aggressiveAIStudioRecheck:', error);
        }
    }

    // اطمینان از styling صحیح
    ensureProperStyling(element) {
        if (!element || !element.hasAttribute('data-ai-rtl-persian-text')) return;

        try {
            const computedStyle = getComputedStyle(element);
            
            // اگر direction درست نیست، اصلاح کن
            if (computedStyle.direction !== 'rtl') {
                element.style.setProperty('direction', 'rtl', 'important');
            }
            
            // اگر text-align درست نیست، اصلاح کن
            if (computedStyle.textAlign !== 'right') {
                element.style.setProperty('text-align', 'right', 'important');
            }

            // اگر unicode-bidi درست نیست، اصلاح کن
            if (computedStyle.unicodeBidi !== 'isolate') {
                element.style.setProperty('unicode-bidi', 'isolate', 'important');
            }

            // فونت را بررسی کن
            const expectedFont = this.getFontFamily();
            if (expectedFont && !computedStyle.fontFamily.includes('Vazir') && !computedStyle.fontFamily.includes('Shabnam')) {
                element.style.setProperty('font-family', expectedFont, 'important');
            }

            const expectedSize = this.getFontSize();
            if (expectedSize && computedStyle.fontSize !== expectedSize) {
                element.style.setProperty('font-size', expectedSize, 'important');
            }
        } catch (error) {
            console.error('Error ensuring proper styling:', error);
        }
    }

    // تشخیص نیاز به اسکن کامل در Perplexity
    shouldPerformPerplexityFullScan() {
        if (!this.isPerplexity) return false;
        
        const now = Date.now();
        const scrollHeight = document.body.scrollHeight || document.documentElement.scrollHeight;
        const viewportHeight = window.innerHeight;
        
        // اگر صفحه خیلی طولانی است و 20 ثانیه از آخرین اسکن گذشته
        return (scrollHeight > viewportHeight * 3) && 
               (!this.lastFullScanTime || (now - this.lastFullScanTime) > 20000);
    }

    // پردازش عناصر ویژه ChatGPT
    processChatGPTSpecialElements() {
        const chatTargets = document.querySelectorAll(
            buildContainerSelector(['[data-testid="conversation-turn"]:not([data-ai-rtl-processed])', '[data-message-author-role]:not([data-ai-rtl-processed])', '.markdown:not([data-ai-rtl-processed])'])
        );

        chatTargets.forEach(element => {
            const text = this.getCleanText(element);
            if (text && this.hasAnyPersianChar(text)) {
                this.processElement(element);
                const container = element.closest('[data-testid="conversation-turn"], [data-message-author-role], .markdown');
                if (container) container.setAttribute('data-ai-rtl-processed', 'true');
            }
        });

        // پردازش ویژه input های ChatGPT
        this.processInputs(document);
    }

    // پردازش ویژه input های ChatGPT

    // ناظر اختصاصی برای AI Studio جهت واکنش سریع به تغییرات متن/نود در ناحیه گفتگو
    setupAIStudioMutationObserver() {
        try {
            if (!this.isAIStudio) return;
            if (this.aiStudioMutationObserver) {
                this.aiStudioMutationObserver.disconnect();
                this.aiStudioMutationObserver = null;
            }
            const container = document.querySelector('.conversation-container') || document.body;
            this.aiStudioMutationObserver = new MutationObserver((mutations) => {
                // زمان‌بندی کوتاه برای ادغام چند تغییر پشت‌سرهم
                clearTimeout(this.mutationDebounceTimer);
                
                // بررسی فوری برای تغییرات مهم
                let hasImportantChanges = false;
                mutations.forEach(mutation => {
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        hasImportantChanges = true;
                    }
                });

                this.mutationDebounceTimer = setTimeout(() => {
                    try {
                        this.processAIStudioSpecialElements();
                        this.processInputs(document);
                        
                        // اگر تغییرات مهمی رخ داده، اسکن تهاجمی انجام بده
                        if (hasImportantChanges) {
                            setTimeout(() => {
                                this.aggressiveAIStudioRecheck();
                            }, 500);
                        }
                    } catch (_) {}
                }, 60);
            });
            this.aiStudioMutationObserver.observe(container, { 
                childList: true, 
                characterData: true, 
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'style', 'data-ai-rtl-persian-text', 'data-ai-rtl-english-text']
            });
        } catch (_) {}
    }

    // پوشش عمومی: هر چند ثانیه یک بار، تمام ادیتورهای احتمالی جدید را بررسی کن
    startGlobalComposerSweep() {
        try {
            this.setTimer('globalComposer', () => {
                try { this.processInputs(document); } catch (_) {}
            }, 3000);
        } catch (_) {}
    }

        // کاهش محدودیت برای پردازش بیشتر
    isSafeElementForProcessing(element) {
        if (!element || !element.tagName) return false;

        const dangerousTags = [
            'HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE', 'META',
            'LINK', 'TITLE', 'BASE', 'NOSCRIPT'
        ];
        
        if (dangerousTags.includes(element.tagName)) return false;
        if (element === document.documentElement || element === document.body || element === document.head) return false;
        if (this.processedElements.has(element)) return false;
        if (this.isCodeRelatedElement(element)) return false;

        // عناصر داخل ادیتورهای ورودی (composer) را پردازش نکن تا استایل Wrapper بر آنها غالب شود
        if (this.isInsideEditableComposer(element)) return false;

        // کاهش محدودیت layout container
        if (this.isLayoutContainer(element) && element.tagName !== 'DIV') return false;

        // فیلتر سایدبار، ناوبری، هدر و فوتر برای همه سایت‌ها - فقط پنجره اصلی چت پردازش شود
        const inSidebarOrNav = element.closest('aside, [data-testid="sidebar"], [class*="sidebar" i], [class*="side-panel" i], nav, header, footer, [role="navigation"], [role="banner"]');
        if (inSidebarOrNav) return false;

        // برای Perplexity محدود به بخش محتوای اصلی چت
        if (this.isPerplexity) {
            const inMain = element.closest(
                '.prose, .answer, [data-testid="answer"], [data-cplx-component="message-block-answer"], .markdown, .markdown-content, .group\\/query, .max-w-threadContentWidth'
            );
            if (!inMain) return false;
        }

        const text = this.getCleanText(element);
        if (!text || text.length < 1) return false; // کاهش حداقل طول به 1

        return true;
    }

    isInsideEditableComposer(element) {
        try {
            return !!element.closest('textarea, [contenteditable="true"], [role="textbox"], .ql-editor, .ProseMirror, .lexical-editor, [data-testid*="textbox" i], [data-testid*="editor" i], [data-testid*="composer" i]');
        } catch (_) {
            return false;
        }
    }

    isLayoutContainer(element) {
        // محدودیت کمتر برای DIV ها
        if (element.tagName === 'DIV') {
            if (element.offsetWidth > window.innerWidth * 0.9 || 
                element.offsetHeight > window.innerHeight * 0.7) {
                return true;
            }
            if (element.children && element.children.length > 15) {
                return true;
            }
        }

        // چک کردن کلاسهای layout
        const className = element.className?.toString().toLowerCase() || '';
        const layoutClasses = [
            'container', 'wrapper', 'layout', 'main-content', 'page-content', 'app',
            'header', 'footer', 'nav', 'sidebar', 'toolbar', 'menu'
        ];

        if (layoutClasses.some(cls => className.includes(cls))) {
            return true;
        }

        // چک کردن ID های layout
        const elementId = element.id?.toString().toLowerCase() || '';
        const layoutIds = ['root', 'app', 'main', 'wrapper'];
        if (layoutIds.some(id => elementId.includes(id))) {
            return true;
        }

        return false;
    }

    processElement(element) {
        if (!this.config.isEnabled || !this.isSafeElementForProcessing(element)) return;

        try {

            const text = this.getCleanText(element);
            if (!text || text.length < 1) return;

            // بررسی کش قبل از پردازش
            if (this.isElementAlreadyProcessed(element, text)) {
                return;
            }

            let language = this.detectLanguage(text);

            // در Perplexity اگر در محتوای اصلی و دارای حروف فارسی باشد، فارسی را بر انگلیسی/نامشخص ترجیح بده
            if (this.isPerplexity) {
                const inMainContent = element.closest('.prose, .answer, [data-testid="answer"]');
                const hasPersian = PERSIAN_REGEX.test(text);
                const tagOk = ['P', 'SPAN', 'DIV', 'LI', 'H1', 'H2', 'H3'].includes(element.tagName);
                if (inMainContent && hasPersian && tagOk) {
                    language = 'persian';
                }
            }

            if (language === 'persian') {
                // If this is a list item, also style its parent ol/ul for proper RTL bullet positioning
                if (element.tagName === 'LI') {
                    try {
                        // Find parent list container (native or custom role-based)
                        const parentList = element.closest('ol, ul, [role="list"], [role="listbox"]');
                        if (parentList && !this.stableElements.has(parentList)) {
                            parentList.style.setProperty('padding-inline-start', '1.5em', 'important');
                            parentList.style.setProperty('padding-left', '0', 'important');
                            parentList.style.setProperty('direction', 'rtl', 'important');
                            this.stableElements.add(parentList);
                        }
                        // Also set inline list-style on the li for max specificity
                        if (!this.isChatGPT) {
                            element.style.setProperty('list-style-position', 'inside', 'important');
                        }
                    } catch (_) {}
                }

                if (this.isAbsolutelySafeForRTL(element)) {
                    element.setAttribute('data-ai-rtl-persian-text', 'true');
                    element.removeAttribute('data-ai-rtl-english-text');
                    this.processedElements.set(element, { processed: true, language: 'persian' });
                    this.cacheProcessedElement(element, text, 'persian'); // ذخیره در کش
                    this.stats.processedCount++;
                    // For list items, add inline padding to ensure bullet area on right
                    if (element.tagName === 'LI') {
                        element.style.setProperty('padding-inline-start', '1.5em', 'important');
                    }
                    if (this.isPerplexity) {
                        try {
                            const fontFamily = this.getFontFamily();
                            const fontSize = this.getFontSize();
                            element.style.setProperty('direction', 'rtl', 'important');
                            element.style.setProperty('text-align', 'right', 'important');
                            element.style.setProperty('unicode-bidi', 'isolate', 'important');
                            if (fontFamily) element.style.setProperty('font-family', fontFamily, 'important');
                            if (fontSize) element.style.setProperty('font-size', fontSize, 'important');
                        } catch (_) {}
                    }
                }
            } else {
                element.removeAttribute('data-ai-rtl-persian-text');
                element.removeAttribute('data-ai-rtl-english-text');
            }
        } catch (error) {
            console.error('Error processing element:', error);
            this.stats.errors++;
        }
    }

    // بهبود RTL Safety با کاهش محدودیت‌ها
    isAbsolutelySafeForRTL(element) {
        const safeTags = ['P', 'SPAN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'DIV'];
        if (!safeTags.includes(element.tagName)) return false;

        // کاهش محدودیت برای DIV ها
        if (element.tagName === 'DIV') {
            // محدودیت نسبی بر اساس viewport برای جلوگیری از دستکاری باکس‌های بزرگ طرح‌بندی
            const vw = Math.max(1, window.innerWidth || 1200);
            const vh = Math.max(1, window.innerHeight || 800);
            if (element.offsetWidth > vw * 0.8 || element.offsetHeight > vh * 0.6) return false;
            if (element.children.length > 8) return false; // افزایش از 5 به 8
        }

        // محدودیت فرزندان - DIVها سختگیرانه، بقیه برچسبها آزادتر
        const children = element.children;
        if (element.tagName === 'DIV') {
            if (children.length > 8) return false;
        } else {
            // برچسبهای inline مثل P میتوانند فرزندان زیادی داشته باشند (code, strong, a, ...)
            if (children.length > 50) return false;
        }

        const blockChildren = Array.from(children).filter(child =>
            ['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(child.tagName)
        );

        if (blockChildren.length > 4) return false; // افزایش از 2 به 4

        if (this.isLayoutContainer(element)) return false;

        return true;
    }

    getCleanText(element) {
        try {
            if ('innerText' in element) return element.innerText.trim();

            let text = '';
            for (let node of element.childNodes) {
                if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
            }
            return text.trim();
        } catch (error) {
            return '';
        }
    }

    setupSmartInputHandler(input) {
        if (input.hasAttribute('data-rtl-handled-ai-studio')) return;
        input.setAttribute('data-rtl-handled-ai-studio', 'true');

        const handler = () => {
            try {
                // بهبود تشخیص متن برای ChatGPT
                let text = '';
                if (this.isChatGPT && input.contentEditable === 'true') {
                    // برای ChatGPT از innerText استفاده کن
                    text = (input.innerText || input.textContent || '').trim();
                } else {
                    text = (typeof input.value === 'string' ? input.value : (input.innerText ?? input.textContent ?? ''))?.trim();
                }

                let language = this.detectLanguage(text);
                // مسیر سریع برای ورودی‌ها: اگر حتی یک حرف فارسی هست، ترجیح RTL
                const hasPersian = PERSIAN_REGEX.test(text || '');
                const hasEnglish = /[A-Za-z]/.test(text || '');
                if (hasPersian && (!hasEnglish || language === 'unknown')) {
                    language = 'persian';
                }
                const fontSize = this.getFontSize();
                const fontFamily = this.getFontFamily();

                if (language === 'persian') {
                    input.setAttribute('data-ai-rtl-persian-input', 'true');
                    input.removeAttribute('data-ai-rtl-english-input');
                    input.style.setProperty('direction', 'rtl', 'important');
                    input.style.setProperty('text-align', 'right', 'important');
                    input.style.setProperty('unicode-bidi', 'isolate', 'important');

                    if (fontFamily) {
                        input.style.setProperty('font-family', fontFamily, 'important');
                    }
                    if (fontSize) {
                        input.style.setProperty('font-size', fontSize, 'important');
                    }

                    // ChatGPT specific fixes
                    if (this.isChatGPT) {
                        this.applyChatGPTInputFixes(input);
                    }
                } else {
                    input.removeAttribute('data-ai-rtl-persian-input');
                    input.removeAttribute('data-ai-rtl-english-input');
                    // برای متن غیر فارسی: استایل‌های سفارشی را حذف کن تا مرورگر پیش‌فرض را اعمال کند
                    if (hasPersian) {
                        input.style.setProperty('direction', 'rtl', 'important');
                        input.style.setProperty('text-align', 'right', 'important');
                    } else {
                        input.style.removeProperty('direction');
                        input.style.removeProperty('text-align');
                    }
                    input.style.setProperty('unicode-bidi', 'isolate', 'important');
                    input.style.removeProperty('font-family');
                    input.style.removeProperty('font-size');
                }

                // اعمال به wrapper نزدیک در صورت وجود (برای ادیتورهای پیچیده)
                try {
                    this.applyDirectionToComposerEnvironment(input, language, { hasPersian, fontFamily, fontSize });
                } catch (_) {}
            } catch (error) {
                console.warn('Input handler error:', error);
                this.stats.errors++;
            }
        };

        // فرکانس بالاتر event handling با AbortController برای جلوگیری از memory leak هنگام حذف input
        const events = ['input', 'keyup', 'keydown', 'paste', 'focus', 'blur', 'change', 'compositionstart', 'compositionupdate', 'compositionend'];
        const controller = this._attachAbortController(input, events, handler);

        // اگر input از DOM حذف شد، listenerها را پاک کن
        try {
            const removalObserver = new MutationObserver(() => {
                if (!input.isConnected) {
                    this._detachAbortController(input, controller);
                    removalObserver.disconnect();
                }
            });
            if (input.parentNode) {
                removalObserver.observe(input.parentNode, { childList: true });
            }
        } catch (_) {}

        handler();
        this.stats.inputCount++;
    }

    applyDirectionToComposerEnvironment(input, language, extras = {}) {
        try {
            const { hasPersian, fontFamily, fontSize } = extras || {};
            const containers = [];
            const push = (el) => { if (el && !containers.includes(el)) containers.push(el); };

            // نزدیک‌ترین لایه‌های رایج ادیتور
            push(input.closest('[role="textbox"]'));
            push(input.closest('.ql-editor, .ProseMirror, .lexical-editor'));
            push(input.closest('[contenteditable="true"]'));
            push(input.closest('[data-testid*="composer" i], [class*="composer" i], [class*="query-box" i], [data-cplx-component*="query-box" i], [data-testid*="query" i]'));
            // یک تا دو لایه بالاتر هم برای override نهایی
            if (containers[0] && containers[0].parentElement) push(containers[0].parentElement);
            if (containers[0] && containers[0].parentElement && containers[0].parentElement.parentElement) push(containers[0].parentElement.parentElement);

            containers.forEach((wrapper) => {
                try {
                    wrapper.removeAttribute('data-ai-rtl-persian-text');
                    wrapper.removeAttribute('data-ai-rtl-english-text');
                } catch (_) {}

                if (language === 'persian') {
                    wrapper.style.setProperty('direction', 'rtl', 'important');
                    wrapper.style.setProperty('text-align', 'right', 'important');
                    wrapper.style.setProperty('unicode-bidi', 'isolate', 'important');
                    if (fontFamily) wrapper.style.setProperty('font-family', fontFamily, 'important');
                    if (fontSize) wrapper.style.setProperty('font-size', fontSize, 'important');
                } else {
                    // برای متن غیر فارسی: استایل‌های سفارشی را حذف کن
                    if (hasPersian) {
                        wrapper.style.setProperty('direction', 'rtl', 'important');
                        wrapper.style.setProperty('text-align', 'right', 'important');
                    } else {
                        wrapper.style.removeProperty('direction');
                        wrapper.style.removeProperty('text-align');
                    }
                    wrapper.style.setProperty('unicode-bidi', 'isolate', 'important');
                }
            });
        } catch (_) {}
    }

    isCodeRelatedElement(element) {
        if (['CODE', 'PRE', 'SCRIPT', 'STYLE'].includes(element.tagName)) return true;
        if (element.closest('code, pre, script, style')) return true;

        const codeClasses = ['highlight', 'language-', 'hljs', 'prism', 'code-', 'monaco', 'syntax'];
        const elementClassName = (element.className || '').toString().toLowerCase();

        if (codeClasses.some(cls => elementClassName.includes(cls))) return true;
        if (element.querySelector && element.querySelector('button[title*="copy" i], button[aria-label*="copy" i], [class*="copy-button" i]')) return true;

        return false;
    }

    detectLanguage(text) {
        if (!text || text.length < 1) return 'unknown'; // کاهش حداقل طول به 1

        // بهینه‌سازی: استفاده از cache برای متون تکراری
        const textHash = this.hashText(text);
        if (this.languageCache.has(textHash)) {
            return this.languageCache.get(textHash);
        }

        const cleanText = text
            .normalize('NFKC')
            .replace(/[\p{Number}\p{White_Space}\p{Punctuation}\p{Symbol}]+/gu, '')
            .replace(/[\u200C\u200F\u202A-\u202E]/g, '');
        
        // اگر بعد از پاکسازی هیچ کاراکتری نمانده، بررسی اولیه انجام دهیم
        if (cleanText.length < 1) {
            // بررسی وجود کاراکترهای فارسی در متن اصلی
            const hasPersianInOriginal = PERSIAN_REGEX.test(text);
            const result = hasPersianInOriginal ? 'persian' : 'unknown';
            this.cacheLanguageResult(textHash, result);
            return result;
        }

        // محدوده‌های کامل‌تر برای کاراکترهای فارسی/عربی
        const persianChars = cleanText.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g);
        const persianCount = persianChars ? persianChars.length : 0;

        const englishChars = cleanText.match(/[a-zA-Z]/g);
        const englishCount = englishChars ? englishChars.length : 0;

        const totalChars = persianCount + englishCount;
        if (totalChars === 0) {
            // اگر هیچ کاراکتر شناخته‌شده‌ای نداشتیم، بررسی دوباره در متن اصلی
            const hasPersianInOriginal = PERSIAN_REGEX.test(text);
            const result = hasPersianInOriginal ? 'persian' : 'unknown';
            this.cacheLanguageResult(textHash, result);
            return result;
        }

        const persianRatio = persianCount / totalChars;
        const threshold = this.getDetectionThreshold();

        // بهبود منطق تشخیص
        if (persianRatio >= threshold) {
            this.cacheLanguageResult(textHash, 'persian');
            return 'persian';
        }
        else if (englishCount > 0 && persianRatio <= (1 - threshold)) {
            this.cacheLanguageResult(textHash, 'english');
            return 'english';
        }
        
        // برای متون کوتاه: اگر حتی یک کاراکتر فارسی داشت و انگلیسی کم بود
        if (text.length <= 10 && persianCount > 0 && englishCount <= persianCount) {
            this.cacheLanguageResult(textHash, 'persian');
            return 'persian';
        }

        // تشخیص بر اساس کلمات کلیدی فارسی برای متون کوتاه
        if (text.length <= 20 && this.hasPersianKeywords(text)) {
            this.cacheLanguageResult(textHash, 'persian');
            return 'persian';
        }

        // اگر هیچ کدام از شرایط بالا برقرار نبود اما کاراکتر فارسی دارد
        if (persianCount > 0 && englishCount === 0) {
            this.cacheLanguageResult(textHash, 'persian');
            return 'persian';
        }

        const result = 'unknown';
        this.cacheLanguageResult(textHash, result);
        return result;
    }

    // متد کمکی برای تشخیص سریع فارسی
    hasAnyPersianChar(text) {
        if (!text) return false;
        return PERSIAN_REGEX.test(text);
    }

    // ایجاد signature منحصر به فرد برای عنصر
    generateElementSignature(element, text) {
        if (!element || !text) return null;
        
        // ترکیب عوامل مختلف برای ایجاد signature منحصر به فرد
        const tagName = element.tagName || '';
        const className = element.className || '';
        const textLength = text.length;
        const textHash = this.simpleHash(text.substring(0, 50)); // اول 50 کاراکتر
        const parentTag = element.parentElement?.tagName || '';
        
        return `${tagName}_${className}_${parentTag}_${textLength}_${textHash}`;
    }

    // hash ساده برای متن
    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // تبدیل به 32-bit integer
        }
        return Math.abs(hash).toString(36);
    }

    // بررسی اینکه آیا عنصر قبلاً پردازش شده یا نه
    isElementAlreadyProcessed(element, text) {
        const signature = this.generateElementSignature(element, text);
        if (!signature) return false;

        // اگر signature در کش وجود دارد
        if (this.processedTextCache.has(signature)) {
            const cachedData = this.processedTextCache.get(signature);

            // اگر عنصر attribute ندارد اما در کش هست، دوباره اعمال کن
            if (!element.hasAttribute('data-ai-rtl-persian-text') &&
                !element.hasAttribute('data-ai-rtl-english-text')) {
                this.reapplyProcessedState(element, cachedData);
            }
            // Always mark as stable after a cache hit to prevent reprocessing
            this.stableElements.add(element);
            return true;
        }
        return false;
    }

    // اعمال مجدد حالت پردازش شده
    reapplyProcessedState(element, cachedData) {
        if (!element || !cachedData) return;

        try {
            // اعمال attribute و style های ذخیره شده
            if (cachedData.language === 'persian') {
                element.setAttribute('data-ai-rtl-persian-text', 'true');
                element.style.setProperty('direction', 'rtl', 'important');
                element.style.setProperty('text-align', 'right', 'important');
                element.style.setProperty('unicode-bidi', 'isolate', 'important');
                
                const fontFamily = this.getFontFamily();
                const fontSize = this.getFontSize();
                if (fontFamily) element.style.setProperty('font-family', fontFamily, 'important');
                if (fontSize) element.style.setProperty('font-size', fontSize, 'important');
            }

            
        } catch (error) {
            console.error('Error reapplying processed state:', error);
        }
    }

    // ذخیره حالت پردازش شده در کش
    cacheProcessedElement(element, text, language) {
        const signature = this.generateElementSignature(element, text);
        if (!signature) return;

        this.processedTextCache.set(signature, {
            language: language,
            timestamp: Date.now(),
            text: text.substring(0, 100) // ذخیره اول 100 کاراکتر برای debug
        });

        // محدود کردن اندازه کش (حداکثر 1000 آیتم)
        if (this.processedTextCache.size > 1000) {
            const oldestKey = this.processedTextCache.keys().next().value;
            this.processedTextCache.delete(oldestKey);
        }
    }

    // متد کمکی برای تشخیص کلمات کلیدی فارسی
    hasPersianKeywords(text) {
        if (!text) return false;
        const persianKeywords = [
            'است', 'می‌شود', 'می‌کند', 'می‌توان', 'باید', 'نباید', 'بود', 'بودن', 'کردن', 'شدن',
            'این', 'آن', 'که', 'را', 'به', 'از', 'در', 'با', 'برای', 'تا', 'و', 'یا',
            'من', 'تو', 'او', 'ما', 'شما', 'آنها', 'خود', 'خودش', 'خودم', 'خودت'
        ];
        return persianKeywords.some(keyword => text.includes(keyword));
    }

    // متدهای کمکی برای language detection cache
    hashText(text) {
        let hash = 0;
        const len = Math.min(text.length, 100); // محدود کردن طول برای performance
        for (let i = 0; i < len; i++) {
            hash = ((hash << 5) - hash + text.charCodeAt(i)) & 0xffffffff;
        }
        return hash.toString(36);
    }

    cacheLanguageResult(hash, result) {
        this.languageCache.set(hash, result);
        
        // محدود کردن اندازه cache
        if (this.languageCache.size > this.maxLanguageCacheSize) {
            const firstKey = this.languageCache.keys().next().value;
            this.languageCache.delete(firstKey);
        }
    }

    // اعمال تنظیمات ویژه ChatGPT برای input
    applyChatGPTInputFixes(input) {
        try {
            // اطمینان از dir attribute
            input.setAttribute('dir', 'rtl');
            
            // اگر parent container وجود دارد، آن را نیز تنظیم کن
            const parentContainer = input.closest('[class*="composer"], [class*="textarea"], [class*="input"]');
            if (parentContainer) {
                parentContainer.style.setProperty('direction', 'rtl', 'important');
            }

            // placeholder alignment برای ChatGPT
            if (input.placeholder) {
                input.style.setProperty('text-align', 'right', 'important');
            }

            // برای contenteditable elements در ChatGPT
            if (input.contentEditable === 'true') {
                input.style.setProperty('writing-mode', 'horizontal-tb', 'important');
                
                // اضافه کردن event listener برای کیبورد
                if (!input.hasAttribute('data-chatgpt-keyboard-handled')) {
                    input.setAttribute('data-chatgpt-keyboard-handled', 'true');
                    
                    input.addEventListener('keydown', (e) => {
                        // تنظیم مجدد direction در صورت لزوم
                        setTimeout(() => {
                            if (input.style.direction !== 'rtl') {
                                input.style.setProperty('direction', 'rtl', 'important');
                                input.style.setProperty('text-align', 'right', 'important');
                            }
                        }, 10);
                    });
                }
            }

            
        } catch (error) {
            console.error('Error applying ChatGPT input fixes:', error);
        }
    }

    startInputMonitoring() {
        if (this.inputCheckTimer) clearInterval(this.inputCheckTimer);

        // فرکانس بالاتر برای سایت‌های چت
        const checkInterval = this.isAIStudio ? 600 : 
                             this.isChatGPT ? 700 : 
                             this.isPerplexity ? 800 : 1000;
        this.inputCheckTimer = setInterval(() => {
            this.processInputs(document);
        }, checkInterval);
    }

    async updateSettings(newConfig) {
        try {
            const oldEnabled = this.config.isEnabled;
            const oldSites = this.config.enabledSites;
            const prevSites = Array.isArray(oldSites) ? oldSites : [];

            this.config = { ...this.config, ...newConfig };

    

            if (newConfig.enabledSites && Array.isArray(newConfig.enabledSites) && JSON.stringify(prevSites) !== JSON.stringify(newConfig.enabledSites)) {
                const wasEnabled = prevSites.includes(this.currentDomain);
                const isEnabledNow = this.isSiteEnabled();
                if (isEnabledNow && !wasEnabled) {

                    await this.fullReload();
                } else if (!isEnabledNow && wasEnabled) {

                    this.cleanup();
                    return;
                }
            }

            if (!this.isSiteEnabled()) return;

            if (newConfig.selectedFont || newConfig.fontSize) {
                this.injectPersianFonts();
                setTimeout(() => this.updateExistingFontStyles(), 50);
            }

            if (newConfig.hasOwnProperty('isEnabled')) {
                if (newConfig.isEnabled && !oldEnabled) {

                    await this.fullReload();
                } else if (!newConfig.isEnabled && oldEnabled) {

                    this.cleanup();
                    return;
                }
            }

            if (newConfig.detectionMode) {

                await this.instantReprocessAllContent();
            }
        } catch (error) {
            console.error('Error updating settings:', error);
            this.stats.errors++;
        }
    }

    updateExistingFontStyles() {
        const fontSize = this.getFontSize();
        const fontFamily = this.getFontFamily();

        const apply = (el) => {
            if (fontSize) {
                el.style.setProperty('font-size', fontSize, 'important');
            } else {
                el.style.removeProperty('font-size');
            }
            
            if (fontFamily) {
                el.style.setProperty('font-family', fontFamily, 'important');
            } else {
                el.style.removeProperty('font-family');
            }
        };

        // اعمال به عناصر متنی فارسی
        document.querySelectorAll('[data-ai-rtl-persian-text="true"]').forEach(apply);
        
        // اعمال به فیلدهای ورودی فارسی
        document.querySelectorAll('[data-ai-rtl-persian-input="true"]').forEach(apply);
        
        // اعمال به فرزندان عناصر فارسی (به جز کدها)
        document.querySelectorAll('[data-ai-rtl-persian-text="true"] *:not(code):not(pre):not([class*="language-"])').forEach(apply);

        
    }

    // پردازش فوری بدون delay
    async instantReprocessAllContent() {

        
        // حذف همه attributes
        document.querySelectorAll('[data-ai-rtl-persian-text], [data-ai-rtl-english-text]').forEach(el => {
            el.removeAttribute('data-ai-rtl-persian-text');
            el.removeAttribute('data-ai-rtl-english-text');
            this.stableElements.delete(el);
        });

        document.querySelectorAll('[data-ai-rtl-persian-input], [data-ai-rtl-english-input]').forEach(el => {
            el.removeAttribute('data-ai-rtl-persian-input');
            el.removeAttribute('data-ai-rtl-english-input');
            el.removeAttribute('data-rtl-handled-ai-studio');
            ['direction', 'text-align', 'font-family', 'font-size'].forEach(prop => {
                el.style.removeProperty(prop);
            });
            this.stableElements.delete(el);
        });

        this.processedElements = new WeakMap();
        
        // پردازش فوری
        await this.immediateProcessAllContent();
        
        // پردازش اضافی برای اطمینان
        setTimeout(() => this.immediateProcessAllContent(), 100);
        setTimeout(() => this.immediateProcessAllContent(), 500);
    }

    async smoothReprocess(newDetectionMode) {
        this.config.detectionMode = newDetectionMode;
        await this.instantReprocessAllContent();
    }

    async fullReload() {

        
        this.cleanup();
        this.removeAllRTLAttributes();
        this.injectPersianFonts();
        
        if (this.config.isEnabled && this.isSiteEnabled()) {
            this.setupSmartObserver();
            await this.immediateProcessAllContent();
            
            this.startInputMonitoring();
            if (this.isAIStudio) {
                this._setupSiteMonitoring('AIStudio', 'processAIStudioSpecialElements', 500, 3000);
                this.setupAIStudioMutationObserver();
            }
            if (this.isPerplexity) this._setupSiteMonitoring('Perplexity', 'processPerplexitySpecialElements', 800, 5000, () => {
                if (this.shouldPerformPerplexityFullScan()) {

                    setTimeout(() => this.performFullPageScan(), 500);
                }
            });
            if (this.isChatGPT) this._setupSiteMonitoring('ChatGPT', 'processChatGPTSpecialElements', 1000, 8000);
            
            // پردازش چندباره برای اطمینان
            setTimeout(() => this.immediateProcessAllContent(), 200);
            setTimeout(() => this.immediateProcessAllContent(), 1000);
            setTimeout(() => this.immediateProcessAllContent(), 2000);
        }
    }

    removeAllRTLAttributes() {
        const attributes = [
            'data-ai-rtl-persian-text',
            'data-ai-rtl-english-text',
            'data-ai-rtl-persian-input',
            'data-ai-rtl-english-input',
            'data-rtl-handled-ai-studio'
        ];

        attributes.forEach(attr => {
            document.querySelectorAll(`[${attr}]`).forEach(el => {
                el.removeAttribute(attr);
                ['direction', 'text-align', 'font-family', 'font-size'].forEach(prop => {
                    el.style.removeProperty(prop);
                });
            });
        });

        this.stableElements = new WeakSet();
    }

    cleanup() {
        if (this.observer) { this.observer.disconnect(); this.observer = null; }
        if (this.inputCheckTimer) { clearInterval(this.inputCheckTimer); this.inputCheckTimer = null; }
        if (this.mutationDebounceTimer) { clearTimeout(this.mutationDebounceTimer); this.mutationDebounceTimer = null; }
        if (this.intersectionObserverTimer) { clearInterval(this.intersectionObserverTimer); this.intersectionObserverTimer = null; }
        
        // Clear all timers managed by the timers Map (consolidated via DRY refactor)
        this.clearAllTimers();
        
        // پاک کردن aiStudioMutationObserver
        if (this.aiStudioMutationObserver) {
            this.aiStudioMutationObserver.disconnect();
            this.aiStudioMutationObserver = null;
        }
        
        // پاک کردن SPA event listeners
        if (this._spaOnPopState) {
            window.removeEventListener('popstate', this._spaOnPopState);
            window.removeEventListener('hashchange', this._spaOnHashChange);
        }
        if (this._spaOnUrlChanged) {
            window.removeEventListener('urlchange', this._spaOnUrlChanged);
        }

        // حذف IntersectionObserver
        if (this.intersectionObserver) {
            this.intersectionObserver.disconnect();
            this.intersectionObserver = null;
        }

        // پاک کردن کش‌ها
        if (this.processedTextCache) {
            this.processedTextCache.clear();
        }
        if (this.elementSignatureCache) {
            this.elementSignatureCache.clear();
        }
        if (this.languageCache) {
            this.languageCache.clear();
        }

        // حذف scroll handlers
        if (this.scrollHandler) {
            window.removeEventListener('scroll', this.scrollHandler);
            // حذف از containers
            const chatContainers = document.querySelectorAll([
                '.conversation-container',
                '.max-w-threadContentWidth',
                '[data-testid="conversation-panel"]',
                'main', '[role="main"]'
            ].join(', '));
            chatContainers.forEach(container => {
                if (container) {
                    container.removeEventListener('scroll', this.scrollHandler);
                }
            });
            this.scrollHandler = null;
        }

        this.removeAllRTLAttributes();
        this.removeFontStyles();
        this.processedElements = new WeakMap();
        this.stableElements = new WeakSet();
        this.stats = { 
            processedCount: 0, 
            inputCount: 0, 
            errors: 0, 
            heartbeatCount: 0,
            immediateProcessing: 0,
            reprocessingCount: 0
        };
    }

    // حذف استایل‌های فونت
    removeFontStyles() {
        const fontStyles = document.querySelectorAll('#ai-rtl-fonts, #ai-rtl-fallback-fonts');
        fontStyles.forEach(style => style.remove());
    }

    // Attach event listeners using AbortController so they can be detached in bulk when
    // the input is removed from the DOM. Returns the controller for later detachment.
    _attachAbortController(input, events, handler) {
        try {
            const controller = new AbortController();
            const signal = controller.signal;
            for (const evt of events) {
                input.addEventListener(evt, handler, { signal, passive: evt === 'input' || evt === 'keyup' || evt === 'keydown' });
            }
            return controller;
        } catch (e) {
            // Fallback: plain addEventListener (older browsers, no AbortController support)
            for (const evt of events) {
                input.addEventListener(evt, handler);
            }
            return null;
        }
    }

    _detachAbortController(input, controller) {
        try {
            if (controller && typeof controller.abort === 'function') {
                controller.abort();
            }
        } catch (_) {}
    }

    // Attach event listeners using AbortController so they can be detached in bulk when
    // the input is removed from the DOM. Returns the controller for later detachment.
    _attachAbortController(input, events, handler) {
        try {
            const controller = new AbortController();
            const signal = controller.signal;
            for (const evt of events) {
                input.addEventListener(evt, handler, { signal, passive: evt === 'input' || evt === 'keyup' || evt === 'keydown' });
            }
            return controller;
        } catch (e) {
            // Fallback: plain addEventListener (older browsers, no AbortController support)
            for (const evt of events) {
                input.addEventListener(evt, handler);
            }
            return null;
        }
    }

    _detachAbortController(input, controller) {
        try {
            if (controller && typeof controller.abort === 'function') {
                controller.abort();
            }
        } catch (_) {}
    }

    getStats() {
        return {
            processedElements: this.stats.processedCount,
            inputElements: this.stats.inputCount,
            errors: this.stats.errors,
            heartbeatCount: this.stats.heartbeatCount,
            immediateProcessing: this.stats.immediateProcessing,
            reprocessingCount: this.stats.reprocessingCount,
            isActive: !!this.observer,
            isAIStudio: this.isAIStudio,
            isPerplexity: this.isPerplexity,
                isChatGPT: this.isChatGPT,
            currentDomain: this.currentDomain,
            isSiteEnabled: this.isSiteEnabled(),
            config: this.config
        };
    }

    setupSpaUrlWatcher() {
        // Event-driven hooks
        try {
            if (!window.__rtlHistoryPatched) {
                const dispatchUrlChange = () => {
                    try { window.dispatchEvent(new Event('urlchange')); } catch (_) {}
                };
                const origPush = history.pushState;
                const origReplace = history.replaceState;
                history.pushState = function(...args) {
                    const ret = origPush.apply(this, args);
                    dispatchUrlChange();
                    return ret;
                };
                history.replaceState = function(...args) {
                    const ret = origReplace.apply(this, args);
                    dispatchUrlChange();
                    return ret;
                };
                window.addEventListener('popstate', this._spaOnPopState = dispatchUrlChange);
                window.addEventListener('hashchange', this._spaOnHashChange = dispatchUrlChange);
                window.__rtlHistoryPatched = true;
            }

            this._spaOnUrlChanged = () => {
                if (location.href !== this.lastUrl) {
                    this.lastUrl = location.href;
                    
                    try { this.fullReload(); } catch (_) { setTimeout(() => this.fullReload(), 150); }
                }
            };
            window.addEventListener('urlchange', this._spaOnUrlChanged);
        } catch (_) {}

        // Polling fallback
        this.spaPollTimer = setInterval(() => {
            if (location.href !== this.lastUrl) {
                
                this.lastUrl = location.href;
                try { this.fullReload(); } catch (_) { setTimeout(() => this.fullReload(), 150); }
            }
        }, 500); // فرکانس بالاتر
    }

    // بررسی دوره‌ای برای زمانی که تب جدیدی باز می‌شود و site-enabled از قبل ست شده اما تب هنوز شروع نشده
    startEnableSitePolling() {
        // Re-load settings shortly after startup in case the tab was opened before sync storage was available,
        // and ensure extension is started if the current site is enabled.
        const pollId = setInterval(() => {
            try {
                if (this.hasInitialized) {
                    clearInterval(pollId);
                    return;
                }
                if (this.config && this.config.isEnabled && this.isSiteEnabled()) {
                    this.startExtension();
                }
            } catch (_) {}
        }, 1500);
        // Stop polling after 30 seconds regardless
        setTimeout(() => clearInterval(pollId), 30000);
    }
}

// Message Handler - بدون تغییر
class MessageHandlerAIStudio {
    constructor(rtlManager) {
        this.rtlManager = rtlManager;
        this.setupMessageListener();
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            try {
                switch (message.action) {
                    case 'ping':
                        sendResponse({ success: true, stats: this.rtlManager.getStats() });
                        break;
                    case 'toggleRTL':
                        this.rtlManager.updateSettings({ isEnabled: message.isEnabled });
                        sendResponse({ success: true });
                        break;
                    case 'updateSettings':
                        this.rtlManager.updateSettings(message.settings || message);
                        sendResponse({ success: true });
                        break;
                    case 'smoothReprocess':
                        this.rtlManager.smoothReprocess(message.settings?.detectionMode || 'medium');
                        sendResponse({ success: true });
                        break;
                    case 'fullReload':
                        try {
                            const incoming = message.settings || { ...message };
                            delete incoming.action;
                            this.rtlManager.config = { ...this.rtlManager.config, ...incoming };
                        } catch (_) {}
                        this.rtlManager.fullReload();
                        // اسکن کامل برای چت‌های طولانی
                        setTimeout(() => {
                            this.rtlManager.performFullPageScan();
                        }, 1000);
                        sendResponse({ success: true });
                        break;
                    case 'getStats':
                        sendResponse(this.rtlManager.getStats());
                        break;
                    case 'exportPdf':
                        this.exportPageAsPdf().then(() => sendResponse({ success: true })).catch(err => {
                            sendResponse({ success: false, error: err?.message || String(err) });
                        });
                        break;
                    case 'nativePrint':
                        try {
                            const history = getConversationHistory();
                            const firstMessage = history[0]?.content.substring(0,50) || 'Chat Conversation';
                            const title = `${firstMessage} - ${new Date().toLocaleDateString()}`;
                            
                            document.title = title;
                            const originalBody = document.body.innerHTML;
const printContainer = document.createElement('div');
printContainer.className = 'print-optimized';
chrome.storage.sync.get(['textOnlyMode', 'includeNotes'], function(result) {
const clonedContent = document.querySelector('.main-content').cloneNode(true);

if(result.textOnlyMode) {
  clonedContent.querySelectorAll('img, video, iframe').forEach(el => el.remove());
}

if(!result.includeNotes) {
  clonedContent.querySelectorAll('.note-section').forEach(el => el.remove());
}

// Remove interactive elements
clonedContent.querySelectorAll('button, input, .interactive').forEach(el => el.remove());

// Add print-specific styling
const style = document.createElement('style');
style.textContent = `
.print-optimized {
    max-width: 100%!important;
    padding: 20px!important;
}
.print-optimized img {
    max-width: 100%!important;
    height: auto!important;
}
`;

document.head.appendChild(style);
printContainer.appendChild(clonedContent);
document.body.innerHTML = '';
document.body.appendChild(printContainer);

window.print();

// Restore original content
document.body.innerHTML = originalBody;
document.head.removeChild(style);
})
                        } catch(error) {
                            chrome.runtime.sendMessage({
                                type: 'showNotification',
                                message: `Print Error: ${error.message}`
                            });
                        }
                        sendResponse({ success: true });
                        break;
                    default:
                        sendResponse({ success: false, error: 'Unknown action' });
                }
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
            return true;
        });
    }

    async exportPageAsPdf() {
        // Scroll through the page to force lazy-loaded content to render, then print
        const scroller = document.scrollingElement || document.documentElement;
        const totalHeight = scroller.scrollHeight;
        const viewportHeight = window.innerHeight;
        const step = Math.max(viewportHeight - 100, 300);

        // Scroll down in steps to trigger lazy-loading
        for (let y = 0; y < totalHeight; y += step) {
            scroller.scrollTop = y;
            await new Promise(r => setTimeout(r, 150));
        }

        // Scroll to bottom to ensure everything is loaded
        scroller.scrollTop = totalHeight;
        await new Promise(r => setTimeout(r, 300));

        // Scroll back to top for a clean print start
        scroller.scrollTop = 0;
        await new Promise(r => setTimeout(r, 200));

        // Now print — all content should be in the DOM
        window.print();
    }



    escapeHtml(unsafe) {
        try {
            return String(unsafe || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        } catch (_) {
            return '';
        }
    }


    clickExpandButtons(root) {
        try {
            const expanderTexts = /(show more|read more|expand|continue|view more|see more|نمایش بیشتر|ادامه|بیشتر|مشاهده بیشتر)/i;
            const buttons = root.querySelectorAll('button, a, [role="button"], .cursor-pointer');
            buttons.forEach(btn => {
                const t = (btn.innerText || btn.textContent || '').trim();
                if (expanderTexts.test(t)) {
                    try { btn.click(); } catch (_) {}
                }
            });
        } catch (_) {}
    }


}

// Initialize
if (!window.rtlAIStudioInstantApply) {
    window.rtlAIStudioInstantApply = true;

    function initializeAIStudio() {
        try {
            document.querySelectorAll('#ai-rtl-fonts').forEach(el => el.remove());
            if (window.rtlManagerAIStudio) window.rtlManagerAIStudio.cleanup();

            window.rtlManagerAIStudio = new RTLAIStudioManager();
            window.messageHandlerAIStudio = new MessageHandlerAIStudio(window.rtlManagerAIStudio);


        } catch (error) {
            console.error('❌ RTL AI Studio initialization error:', error);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeAIStudio);
    } else {
        initializeAIStudio();
    }

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'sync' && window.rtlManagerAIStudio) {
            const updates = {};
            Object.keys(changes).forEach(key => {
                if (key !== '_triggerReprocess') {
                    updates[key] = changes[key].newValue;
                }
            });

            if (changes._triggerReprocess) {
                window.rtlManagerAIStudio.smoothReprocess(updates.detectionMode || 'medium');
            } else if (Object.keys(updates).length > 0) {
                // اگر enabledSites تغییر کرد و این دامنه در لیست جدید نیست → cleanup
                if (Object.prototype.hasOwnProperty.call(updates, 'enabledSites')) {
                    try {
                        const enabled = Array.isArray(updates.enabledSites) && updates.enabledSites.includes(window.rtlManagerAIStudio.currentDomain);
                        if (!enabled) {
                            window.rtlManagerAIStudio.cleanup();
                            return;
                        }
                    } catch (_) {}
                }
                window.rtlManagerAIStudio.updateSettings(updates);
            }
        }
    });

    window.addEventListener('beforeunload', () => {
        if (window.rtlManagerAIStudio) window.rtlManagerAIStudio.cleanup();
    });
}
}
