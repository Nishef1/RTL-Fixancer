class PopupManagerInstantTrigger {
    constructor() {
        this.currentTab = null;
        this.elements = {};
        this.currentDomain = '';
        this.enabledSites = new Set();
        
        this.connectionRetries = 0;
        this.maxRetries = 5;
        this.isContentScriptActive = false;
        this.connectionCheckInterval = null;
        this.retryTimer = null;
        
        this.settingsUpdateInProgress = false;
        this.lastSettings = null;
        
        this.errors = [];
        this.maxErrors = 20;
        
        this.initialize();
    }

    async initialize() {
        try {
            this.logInfo('Initializing popup manager...');
            
            await this.getCurrentTab();
            this.getElements();
            await this.loadSettings();
            this.setupEventListeners();
            
            // Check for policy restrictions on current tab
            if (this.currentTab && this.currentTab.url) {
                await this.checkPolicyRestrictions();
            }
            
            this.startConnectionMonitoring();
            
            this.logInfo('Popup manager initialized successfully');
        } catch (error) {
            this.logError('Initialization failed', error);
            this.showErrorMessage('خطا در راهاندازی: ' + error.message);
        }
    }

    async getCurrentTab() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) {
                throw new Error('No active tab found');
            }
            
            this.currentTab = tab;
            
            if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
                const url = new URL(tab.url);
                this.currentDomain = url.hostname;
                this.logInfo(`Current domain: ${this.currentDomain}`);
            } else {
                this.currentDomain = '';
                this.logInfo('Invalid or restricted tab URL');
            }
            
            this.updateCurrentSiteDisplay();
            
        } catch (error) {
            this.logError('Error getting current tab', error);
            this.currentDomain = '';
            this.updateCurrentSiteDisplay();
            throw error;
        }
    }

    async checkPolicyRestrictions() {
        try {
            // Try to inject a minimal script to check for policy restrictions
            await chrome.scripting.executeScript({
                target: { tabId: this.currentTab.id },
                func: () => {
                    return { success: true, policy: 'allowed' };
                }
            });
            this.logInfo('Policy check passed - no restrictions detected');
            return false;
        } catch (error) {
            if (error.message && error.message.includes('ExtensionsSettings policy')) {
                this.logError('ExtensionsSettings policy restriction detected', error);
                this.updateConnectionStatus('محدود شده توسط سیاست مرورگر');
                this.showErrorMessage('مرورگر این صفحه را محدود کرده است. این خطا به دلیل سیاستهای امنیتی مرورگر رخ داده است.');
                return true;
            } else if (error.message && error.message.includes('Cannot access contents of url')) {
                this.logError('Protected page restriction detected', error);
                this.updateConnectionStatus('صفحه محافظت شده');
                this.showErrorMessage('این صفحه توسط مرورگر محافظت شده و افزونهها نمیتوانند به آن دسترسی داشته باشند.');
                return true;
            }
            return false;
        }
    }

    getElements() {
         const elementIds = [
            'settingsPanel', 'fontSelect', 'fontSizeSelect',
            'detectionMode', 'status', 'currentSiteUrl',
            'currentSiteToggle', 'currentSiteControls', 'btnReapply',
            'sitesList', 'sitesCount', 'btnExportPdf', 'btnGithub', 'btnDonate'
        ];

        this.elements = {};
        
        elementIds.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                this.elements[id] = element;
            } else {
                this.logError(`Missing DOM element: ${id}`, new Error(`Element ${id} not found`));
                this.elements[id] = this.createFallbackElement(id);
            }
        });

        this.ensureMessageContainers();
    }

    createFallbackElement(id) {
        const fallback = document.createElement('div');
        fallback.id = id + '-fallback';
        fallback.style.display = 'none';
        fallback.addEventListener = () => {};
        fallback.removeEventListener = () => {};
        return fallback;
    }

    ensureMessageContainers() {
        if (!document.querySelector('.error-container')) {
            const errorContainer = document.createElement('div');
            errorContainer.className = 'message-container error-container';
            errorContainer.style.cssText = `
                position: fixed; top: 10px; left: 10px; right: 10px;
                background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb;
                padding: 8px; border-radius: 5px; font-size: 11px; text-align: center;
                z-index: 1000; display: none;
            `;
            document.body.appendChild(errorContainer);
        }

        if (!document.querySelector('.success-container')) {
            const successContainer = document.createElement('div');
            successContainer.className = 'message-container success-container';
            successContainer.style.cssText = `
                position: fixed; top: 10px; left: 10px; right: 10px;
                background: #d4edda; color: #155724; border: 1px solid #c3e6cb;
                padding: 8px; border-radius: 5px; font-size: 11px; text-align: center;
                z-index: 1000; display: none;
            `;
            document.body.appendChild(successContainer);
        }
    }

    async loadSettings() {
        try {
            this.logInfo('Loading settings...');
            
            const settings = await this.chromeStorageGet({
                isEnabled: true,
                selectedFont: 'vazir',
                fontSize: 'default',
                detectionMode: 'medium',
                enabledSites: [],

            });

            this.enabledSites = new Set(settings.enabledSites || []);
            this.lastSettings = { ...settings };
            
            this.safeSetElementProperty('mainToggle', 'checked', settings.isEnabled);
            this.safeSetElementProperty('fontSelect', 'value', settings.selectedFont);
            this.safeSetElementProperty('fontSizeSelect', 'value', settings.fontSize);
            this.safeSetElementProperty('detectionMode', 'value', settings.detectionMode);


            this.updateUI(settings.isEnabled);
            this.updateCurrentSiteDisplay();
            this.updateSitesList();
            
            this.logInfo('Settings loaded successfully', settings);
            
        } catch (error) {
            this.logError('Error loading settings', error);
            this.showErrorMessage('خطا در بارگذاری تنظیمات');
            
            this.enabledSites = new Set();
            this.lastSettings = {
                isEnabled: true,
                selectedFont: 'vazir',
                fontSize: 'default',
                detectionMode: 'medium',
                enabledSites: []
            };
        }
    }

    chromeStorageGet(defaults, timeout = 8000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('Storage get timeout'));
            }, timeout);

            try {
                chrome.storage.sync.get(defaults, (result) => {
                    clearTimeout(timer);
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(result);
                    }
                });
            } catch (error) {
                clearTimeout(timer);
                reject(error);
            }
        });
    }

    chromeStorageSet(items, timeout = 8000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('Storage set timeout'));
            }, timeout);

            try {
                chrome.storage.sync.set(items, () => {
                    clearTimeout(timer);
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve();
                    }
                });
            } catch (error) {
                clearTimeout(timer);
                reject(error);
            }
        });
    }

    safeSetElementProperty(elementId, property, value) {
        try {
            const element = this.elements[elementId];
            if (element && element !== element.constructor.prototype && property in element) {
                element[property] = value;
                return true;
            }
            return false;
        } catch (error) {
            this.logError(`Error setting ${property} on ${elementId}`, error);
            return false;
        }
    }

    safeSetElementText(elementId, text) {
        try {
            const element = this.elements[elementId];
            if (element && typeof element.textContent !== 'undefined') {
                element.textContent = String(text || '');
                return true;
            }
            return false;
        } catch (error) {
            this.logError(`Error setting text on ${elementId}`, error);
            return false;
        }
    }

    updateCurrentSiteDisplay() {
        try {
            if (!this.currentDomain) {
                this.safeSetElementText('currentSiteUrl', 'سایت محدود یا نامعلوم');
                
                const controlsElement = this.elements.currentSiteControls;
                if (controlsElement) {
                    controlsElement.style.display = 'none';
                }
                return;
            }

            this.safeSetElementText('currentSiteUrl', this.currentDomain);
            const isEnabled = this.enabledSites.has(this.currentDomain);
            
            this.safeSetElementProperty('currentSiteToggle', 'checked', isEnabled);
            
            const controlsElement = this.elements.currentSiteControls;
            if (controlsElement) {
                controlsElement.style.display = 'flex';
            }

        } catch (error) {
            this.logError('Error updating current site display', error);
        }
    }

    updateSitesList() {
        try {
            const sitesArray = Array.from(this.enabledSites).sort();
            this.safeSetElementText('sitesCount', sitesArray.length.toString());

            const sitesListElement = this.elements.sitesList;
            if (!sitesListElement) return;

            if (sitesArray.length === 0) {
                sitesListElement.innerHTML = `
                    <div class="empty-sites" style="text-align: center; padding: 15px; color: #6c757d; font-size: 11px;">
                        هیچ سایتی اضافه نشده
                    </div>
                `;
                return;
            }

            const sitesHTML = sitesArray.map(site => {
                const isDefault = ['aistudio.google.com', 'makersuite.google.com', 'perplexity.ai']
                    .some(defaultSite => site.includes(defaultSite));
                const checked = this.enabledSites.has(site) ? 'checked' : '';
                return `
                    <div class="site-item" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; border-bottom: 1px solid #e9ecef; font-size: 11px;">
                        <span style="flex: 1; word-break: break-all; color: #495057; ${isDefault ? 'font-weight: bold; color: #007bff;' : ''}">${this.escapeHtml(site)}</span>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <button class="delete-btn" data-site="${this.escapeHtml(site)}" title="حذف ${this.escapeHtml(site)}" aria-label="حذف ${this.escapeHtml(site)}">
                                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M3 6h18" stroke="white" stroke-width="2" stroke-linecap="round"/>
                                    <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" stroke="white" stroke-width="2" stroke-linecap="round"/>
                                    <path d="M6 6l1 14a2 2 0 002 2h6a2 2 0 002-2l1-14" stroke="white" stroke-width="2"/>
                                    <path d="M10 11v6M14 11v6" stroke="white" stroke-width="2" stroke-linecap="round"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');

            sitesListElement.innerHTML = sitesHTML;

            sitesListElement.querySelectorAll('.delete-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const button = e.currentTarget || e.target.closest('.delete-btn');
                    const site = button?.dataset?.site;
                    if (site) {
                        await this.removeSite(site);
                    }
                });
            });

            // removed per-site toggle per request

        } catch (error) {
            this.logError('Error updating sites list', error);
        }
    }

    escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return '';
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    setupEventListeners() {
        try {
            // حذف سوئیچ فعال/غیرفعال سراسری

            this.addSafeEventListener('fontSelect', 'change', async (e) => {
                await this.updateSetting('selectedFont', e.target.value);
                await this.triggerImmediateApply();
                this.showSuccessMessage('فونت تغییر کرد');
            });

            this.addSafeEventListener('fontSizeSelect', 'change', async (e) => {
                await this.updateSetting('fontSize', e.target.value);
                await this.triggerImmediateApply();
                this.showSuccessMessage('سایز فونت تغییر کرد');
            });

            this.addSafeEventListener('textOnlyMode', 'change', async (e) => {
                await this.updateSetting('textOnlyMode', e.target.checked);
                await this.triggerImmediateApply();
            });

            this.addSafeEventListener('includeNotes', 'change', async (e) => {
                await this.updateSetting('includeNotes', e.target.checked);
                await this.triggerImmediateApply();
            });

            this.addSafeEventListener('detectionMode', 'change', async (e) => {
                await this.updateSetting('detectionMode', e.target.value);
                await this.triggerImmediateReprocess();
                this.showSuccessMessage('حساسیت تشخیص تغییر کرد');
            });

            this.addSafeEventListener('currentSiteToggle', 'change', async (e) => {
                const shouldEnable = e.target.checked;
                if (!this.currentDomain) return;
                // فقط وضعیت دامنه را toggle می‌کنیم؛ از لیست حذف نمی‌کنیم
                try {
                    if (shouldEnable) this.enabledSites.add(this.currentDomain);
                    else this.enabledSites.delete(this.currentDomain);
                    await this.updateSetting('enabledSites', Array.from(this.enabledSites));
                    // بدون رفرش: اعمال فوری
                    await this.triggerFullReload();
                    this.updateSitesList();
                } catch (err) {
                    this.showErrorMessage('خطا در به‌روزرسانی وضعیت سایت');
                }
            });

            // حذف دکمه حذف از سایت فعلی (غیرفعال)

            // export PDF
            this.addSafeEventListener('btnExportPdf', 'click', async () => {
                try {
                    const btn = this.elements.btnExportPdf;
                    if (btn) btn.classList.add('loading');
                    
                    // Try multiple fallback methods for PDF export
                    try {
                        await this.sendMessageToContent('exportPdf', {}, 5000);
                        this.showSuccessMessage('در حال ساخت PDF...');
                        return;
                    } catch (error) {
                        const msg = (error && error.message) || '';
                        const policyError = /ExtensionsSettings policy|Cannot access contents|This page cannot be scripted/i.test(msg);
                        
                        if (policyError) {
                            this.logInfo('Policy restriction detected, using native print fallback');
                        }
                        
                        // Try native print fallback
                        try {
                            await chrome.scripting.executeScript({
                                target: { tabId: this.currentTab.id },
                                func: () => window.print()
                            });
                            this.showSuccessMessage('پنجره پرینت باز شد...');
                            return;
                        } catch (printError) {
                            // Final fallback: open new tab with print dialog
                            try {
                                await chrome.tabs.create({
                                    url: 'javascript:window.print()',
                                    active: true
                                });
                                this.showSuccessMessage('پنجره پرینت باز شد...');
                                return;
                            } catch (finalError) {
                                this.showErrorMessage('امکان پرینت در این صفحه وجود ندارد');
                            }
                        }
                    }
                } catch (e) {
                    this.showErrorMessage('خطا در ساخت PDF: محدودیت مرورگر');
                } finally {
                    const btn = this.elements.btnExportPdf;
                    if (btn) setTimeout(() => btn.classList.remove('loading'), 1200);
                }
            });

            // Open GitHub page
            this.addSafeEventListener('btnGithub', 'click', async () => {
                try {
                    const repoUrl = 'https://github.com/Nishef1/RTL-Fixancer';
                    await chrome.tabs.create({ url: repoUrl, active: true });
                } catch (e) {
                    window.open('https://github.com/Nishef1/RTL-Fixancer', '_blank', 'noopener');
                }
            });

            // Open Donate (README anchor placeholder)
            this.addSafeEventListener('btnDonate', 'click', async () => {
                const donateUrl = 'https://github.com/Nishef1/RTL-Fixancer#donate';
                try {
                    await chrome.tabs.create({ url: donateUrl, active: true });
                } catch (e) {
                    window.open(donateUrl, '_blank', 'noopener');
                }
                // Pleasant micro-interaction: hearts burst
                try {
                    const hearts = document.getElementById('hearts');
                    if (hearts) {
                        for (let i = 0; i < 6; i++) {
                            const h = document.createElement('div');
                            h.className = 'heart ' + (i % 3 === 0 ? 'p2' : (i % 2 === 0 ? 'p3' : ''));
                            const x = 180 + (Math.random() * 60 - 30);
                            const y = 42 + (Math.random() * 8 - 4);
                            const dx = (Math.random() * 80 - 40) + 'px';
                            h.style.setProperty('--x', x + 'px');
                            h.style.setProperty('--y', y + 'px');
                            h.style.setProperty('--dx', dx);
                            hearts.appendChild(h);
                            setTimeout(() => h.remove(), 900);
                        }
                        const donateBtn = this.elements.btnDonate;
                        if (donateBtn) {
                            donateBtn.classList.add('pulse');
                            setTimeout(() => donateBtn.classList.remove('pulse'), 650);
                        }
                    }
                } catch (_) {}
            });

            // Re-apply button: triggers full reload in current tab
            this.addSafeEventListener('btnReapply', 'click', async () => {
                try {
                    await this.triggerFullReload();
                    this.showSuccessMessage('اعمال مجدد انجام شد');
                } catch (_) {}
            });

        } catch (error) {
            this.logError('Error setting up event listeners', error);
        }
    }

    addSafeEventListener(elementId, event, handler) {
        try {
            const element = this.elements[elementId];
            if (element && typeof element.addEventListener === 'function') {
                element.addEventListener(event, async (e) => {
                    try {
                        await handler(e);
                    } catch (error) {
                        this.logError(`Event handler error for ${elementId}.${event}`, error);
                        this.showErrorMessage('خطا در پردازش: ' + error.message);
                    }
                });
                return true;
            }
            return false;
        } catch (error) {
            this.logError(`Error adding event listener to ${elementId}`, error);
            return false;
        }
    }

    async updateSetting(key, value) {
        if (this.settingsUpdateInProgress) {
            this.logInfo(`Settings update in progress, queuing ${key}`);
            await new Promise(resolve => setTimeout(resolve, 200));
            return this.updateSetting(key, value);
        }

        this.settingsUpdateInProgress = true;
        
        try {
            await this.chromeStorageSet({ [key]: value });
            
            if (this.lastSettings) {
                this.lastSettings[key] = value;
            }
            
            this.logInfo(`Setting ${key} updated successfully`);
            
        } catch (error) {
            this.logError(`Error updating setting ${key}`, error);
            this.showErrorMessage('خطا در ذخیره تنظیمات');
            throw error;
        } finally {
            this.settingsUpdateInProgress = false;
        }
    }

    // تریگر فوری اعمال تغییرات
    async triggerImmediateApply() {
        try {
            const settings = await this.getAllSettings();
            await this.sendMessageToContent('updateSettings', settings, 10000);
        } catch (error) {
            this.logError('Error triggering immediate apply', error);
        }
    }

    // تریگر فوری پردازش مجدد
    async triggerImmediateReprocess() {
        try {
            const settings = await this.getAllSettings();
            await this.sendMessageToContent('smoothReprocess', { settings: { detectionMode: settings.detectionMode } }, 10000);
        } catch (error) {
            this.logError('Error triggering immediate reprocess', error);
        }
    }

    // تریگر بارگذاری کامل
    async triggerFullReload() {
        try {
            const settings = await this.getAllSettings();
            await this.sendMessageToContent('fullReload', settings, 15000);
        } catch (error) {
            this.logError('Error triggering full reload', error);
        }
    }

    async getAllSettings() {
        try {
            return await this.chromeStorageGet({
                isEnabled: true,
                selectedFont: 'vazir',
                fontSize: 'default',
                detectionMode: 'medium',
                enabledSites: Array.from(this.enabledSites)
            });
        } catch (error) {
            this.logError('Error getting all settings', error);
            return this.lastSettings || {
                isEnabled: true,
                selectedFont: 'vazir',
                fontSize: 'default',
                detectionMode: 'medium',
                enabledSites: Array.from(this.enabledSites)
            };
        }
    }

    async addCurrentSite() {
        if (!this.currentDomain) {
            this.showErrorMessage('دامنه سایت فعلی قابل شناسایی نیست');
            return;
        }

        try {
            this.enabledSites.add(this.currentDomain);
            await this.updateSetting('enabledSites', Array.from(this.enabledSites));
            
            // تزریق و فعالسازی فوری
            await this.injectContentScript();
            await this.triggerFullReload();
            
            this.updateCurrentSiteDisplay();
            this.updateSitesList();
            
            this.showSuccessMessage(`سایت ${this.currentDomain} اضافه و فعال شد`);
            
        } catch (error) {
            this.enabledSites.delete(this.currentDomain);
            this.logError('Error adding site', error);
            this.showErrorMessage('خطا در افزودن سایت: ' + error.message);
        }
    }

    async removeCurrentSite() {
        if (!this.currentDomain) return;
        await this.removeSite(this.currentDomain);
    }

    async removeSite(domain) {
        try {
            this.enabledSites.delete(domain);
            await this.updateSetting('enabledSites', Array.from(this.enabledSites));
            
            this.updateCurrentSiteDisplay();
            this.updateSitesList();
            
            this.showSuccessMessage(`سایت ${domain} حذف شد`);
            
        } catch (error) {
            this.enabledSites.add(domain);
            this.logError('Error removing site', error);
            this.showErrorMessage('خطا در حذف سایت: ' + error.message);
        }
    }

    async injectContentScript() {
        if (!this.currentTab) return;
        
        try {
            await chrome.scripting.executeScript({
                target: { tabId: this.currentTab.id },
                files: ['content.js']
            });
            
            await this.delay(1000);
            
            this.logInfo('Content script injected successfully');
            
        } catch (error) {
            this.logError('Error injecting content script', error);
            
            // Check for ExtensionsSettings policy error
            if (error.message && error.message.includes('ExtensionsSettings policy')) {
                this.showErrorMessage('مرورگر این صفحه را محدود کرده است. این خطا به دلیل سیاستهای امنیتی مرورگر رخ داده است.');
                this.updateConnectionStatus('محدود شده توسط سیاست مرورگر');
            } else if (error.message && error.message.includes('Cannot access contents of url')) {
                this.showErrorMessage('این صفحه توسط مرورگر محافظت شده و افزونهها نمیتوانند به آن دسترسی داشته باشند.');
                this.updateConnectionStatus('صفحه محافظت شده');
            } else {
                this.showErrorMessage('خطا در تزریق اسکریپت. صفحه را بارگذاری مجدد کنید.');
            }
        }
    }

    startConnectionMonitoring() {
        this.logInfo('Starting connection monitoring...');
        
        setTimeout(() => this.checkConnectionStatus(), 1000);
        
        this.connectionCheckInterval = setInterval(() => {
            this.checkConnectionStatus();
        }, 3000);
    }

    async checkConnectionStatus() {
        const maxRetries = 4;
        let attempt = 0;
        
        this.logInfo('Connection check:', {
            currentDomain: this.currentDomain,
            enabledSites: Array.from(this.enabledSites),
            currentTab: this.currentTab?.id,
            url: this.currentTab?.url
        });
        
        if (!this.currentDomain) {
            this.updateConnectionStatus('قطع - دامنه نامشخص');
            return;
        }
        
        if (!this.enabledSites.has(this.currentDomain)) {
            this.updateConnectionStatus('قطع - سایت غیرفعال');
            return;
        }
        
        while (attempt < maxRetries) {
            try {
                const response = await this.sendMessageToContent('ping', {}, 6000);
                
                if (response && response.success) {
                    this.isContentScriptActive = true;
                    this.connectionRetries = 0;
                    this.updateConnectionStatus('متصل ✓');
                    
                    if (response.stats) {
                        this.displayStats(response.stats);
                    }
                    return;
                } else {
                    throw new Error('No valid response');
                }
            } catch (error) {
                attempt++;
                this.logError(`Connection attempt ${attempt}`, error);
                
                // Check for policy restrictions
                const msg = (error && error.message) || '';
                const policyError = /ExtensionsSettings policy|Cannot access contents of url|This page cannot be scripted/i.test(msg);
                
                if (policyError) {
                    this.updateConnectionStatus('محدود شده توسط سیاست مرورگر');
                    this.showErrorMessage('این صفحه توسط سیاستهای امنیتی مرورگر محدود شده است');
                    return;
                }
                
                if (attempt === 1) {
                    try {
                        await this.injectContentScript();
                        await this.delay(2500);
                    } catch (injectionError) {
                        this.logError('Auto injection failed', injectionError);
                    }
                }
                
                if (attempt < maxRetries) {
                    await this.delay(1200 * attempt);
                }
            }
        }
        
        this.isContentScriptActive = false;
        this.updateConnectionStatus(`قطع - خطای اتصال`);
        
        if (this.connectionRetries < 3) {
            this.connectionRetries++;
            setTimeout(() => this.checkConnectionStatus(), 5000);
        }
    }

    updateConnectionStatus(status) {
        try {
            this.safeSetElementText('status', `وضعیت: ${status}`);
            
            const statusElement = this.elements.status;
            if (statusElement) {
                statusElement.className = `status ${status.includes('متصل') ? 'connected' : 'disconnected'}`;
            }
        } catch (error) {
            this.logError('Error updating connection status', error);
        }
    }

    displayStats(stats) {
        try {
            const statsInfo = `
                عناصر پردازش شده: ${stats.processedElements || 0}
                ورودیها: ${stats.inputElements || 0}
                خطاها: ${stats.errors || 0}
                پردازش فوری: ${stats.immediateProcessing || 0}
                پردازش مجدد: ${stats.reprocessingCount || 0}
                حالت فعال: ${stats.isActive ? 'بله' : 'خیر'}
            `.trim();
            
            const statusElement = this.elements.status;
            if (statusElement) {
                statusElement.title = statsInfo;
            }
        } catch (error) {
            this.logError('Error displaying stats', error);
        }
    }

    updateUI(isEnabled) {
        try {
            const settingsPanel = this.elements.settingsPanel;
            if (settingsPanel) {
                if (isEnabled) {
                    settingsPanel.classList.remove('disabled-overlay');
                } else {
                    settingsPanel.classList.add('disabled-overlay');
                }
            }
        } catch (error) {
            this.logError('Error updating UI', error);
        }
    }

    async sendMessageToContent(action, data = {}, timeout = 8000) {
        if (!this.currentTab) {
            throw new Error('No current tab available');
        }

        const attemptSend = () => new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Message timeout after ${timeout}ms`)), timeout);
            try {
                chrome.tabs.sendMessage(this.currentTab.id, { action, ...data }, { frameId: 0 }, (response) => {
                    clearTimeout(timer);
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(response);
                    }
                });
            } catch (error) {
                clearTimeout(timer);
                reject(error);
            }
        });

        try {
            return await attemptSend();
        } catch (err) {
            const msg = (err && err.message) || '';
            const needInject = /Receiving end does not exist|Could not establish connection/i.test(msg);
            const policyError = /ExtensionsSettings policy|Cannot access contents of url|This page cannot be scripted/i.test(msg);
            const domainEnabled = !!this.currentDomain && this.enabledSites.has(this.currentDomain);
            
            if (policyError) {
                this.logError('Policy restriction detected', err);
                this.updateConnectionStatus('محدود شده توسط سیاست مرورگر');
                throw new Error('این صفحه توسط سیاستهای امنیتی مرورگر محدود شده است');
            }
            
            if (needInject && domainEnabled) {
                try {
                    await this.ensureContentScriptReady();
                    return await attemptSend();
                } catch (e2) {
                    throw e2;
                }
            }
            throw err;
        }
    }

    async ensureContentScriptReady(maxWaitMs = 5000) {
        try {
            if (!this.currentTab || !this.currentDomain || !this.enabledSites.has(this.currentDomain)) return false;

            // quick ping
            try {
                const res = await new Promise((resolve, reject) => {
                    try {
                        chrome.tabs.sendMessage(this.currentTab.id, { action: 'ping' }, { frameId: 0 }, (response) => {
                            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve(response);
                        });
                    } catch (e) { reject(e); }
                });
                if (res && res.success) {
                    this.isContentScriptActive = true;
                    return true;
                }
            } catch (_) {
                // not ready -> inject
            }

            await this.injectContentScript();
            const start = Date.now();
            while (Date.now() - start < maxWaitMs) {
                try {
                    const res = await new Promise((resolve, reject) => {
                        try {
                            chrome.tabs.sendMessage(this.currentTab.id, { action: 'ping' }, { frameId: 0 }, (response) => {
                                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve(response);
                            });
                        } catch (e) { reject(e); }
                    });
                    if (res && res.success) {
                        this.isContentScriptActive = true;
                        return true;
                    }
                } catch (_) {}
                await this.delay(500);
            }
        } catch (error) {
            this.logError('ensureContentScriptReady error', error);
        }
        this.isContentScriptActive = false;
        return false;
    }

    showErrorMessage(message) {
        try {
            const container = document.querySelector('.error-container');
            if (container) {
                container.textContent = message;
                container.style.display = 'block';
                setTimeout(() => {
                    container.style.display = 'none';
                }, 5000);
            }
        } catch (error) {
            console.error('Error showing error message:', error);
        }
    }

    showSuccessMessage(message) {
        try {
            const container = document.querySelector('.success-container');
            if (container) {
                container.textContent = message;
                container.style.display = 'block';
                setTimeout(() => {
                    container.style.display = 'none';
                }, 3000);
            }
        } catch (error) {
            console.error('Error showing success message:', error);
        }
    }

    logInfo(message, data = null) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level: 'INFO',
            message,
            data
        };
        console.log(`[PopupManager] ${message}`, data || '');
        this.addToErrorLog(logEntry);
    }

    logError(context, error) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level: 'ERROR',
            context,
            message: error.message,
            stack: error.stack
        };

        console.error(`[PopupManager] ${context}:`, error);
        this.addToErrorLog(logEntry);
    }

    addToErrorLog(logEntry) {
        this.errors.push(logEntry);
        
        if (this.errors.length > this.maxErrors) {
            this.errors = this.errors.slice(-this.maxErrors);
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    cleanup() {
        try {
            if (this.retryTimer) {
                clearTimeout(this.retryTimer);
                this.retryTimer = null;
            }

            if (this.connectionCheckInterval) {
                clearInterval(this.connectionCheckInterval);
                this.connectionCheckInterval = null;
            }

            this.logInfo('Popup manager cleanup completed');
        } catch (error) {
            this.logError('Error during cleanup', error);
        }
    }

    getErrorLog() {
        return this.errors;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        window.popupManager = new PopupManagerInstantTrigger();
    } catch (error) {
        console.error('خطا در راهاندازی popup:', error);
        
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            background: #ff4444; 
            color: white; 
            padding: 15px; 
            margin: 10px; 
            border-radius: 8px;
            font-size: 12px;
            text-align: center;
        `;
        errorDiv.textContent = 'خطا در راهاندازی: ' + error.message;
        document.body.insertBefore(errorDiv, document.body.firstChild);
    }
});

window.addEventListener('beforeunload', () => {
    if (window.popupManager) {
        window.popupManager.cleanup();
    }
});
