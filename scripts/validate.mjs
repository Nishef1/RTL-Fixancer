import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');
const manifest = JSON.parse(await read('manifest.json'));

assert.equal(manifest.manifest_version, 3, 'Manifest V3 is required.');
assert.equal(manifest.version, '4.2.4');
assert.equal(manifest.background?.service_worker, 'background.js');
assert.equal(manifest.content_scripts, undefined, 'Static all-site content scripts are forbidden.');
assert.deepEqual(manifest.host_permissions, ['http://*/*', 'https://*/*']);
assert.equal(manifest.optional_host_permissions, undefined, 'No per-site permission prompts.');
assert(!manifest.permissions.includes('tabs'), 'The broad tabs permission must not be requested.');
assert(!manifest.permissions.includes('webNavigation'), 'webNavigation is not needed.');

const requiredFiles = [
    'background.js', 'content.js', 'lib/core.js', 'popup.html', 'popup.css', 'popup.js',
    'vazir.woff2', 'shabnam.woff2'
];
for (const file of requiredFiles) await access(path.join(root, file));

const javascriptFiles = ['background.js', 'content.js', 'lib/core.js', 'popup.js'];
for (const file of javascriptFiles) {
    const source = await read(file);
    assert(!/\beval\s*\(/.test(source), `${file} must not use eval().`);
    assert(!/new\s+Function\s*\(/.test(source), `${file} must not use new Function().`);
    assert(!/https?:\/\/[^'"\s]+\.js\b/.test(source), `${file} must not load remote JavaScript.`);
}

const background = await read('background.js');
assert(background.includes("runAt: 'document_idle'"), 'Dynamic scripts should run at document_idle.');
assert(background.includes('registerContentScripts'), 'Dynamic content-script registration is required.');
assert(background.includes('cleanupOpenTabs'), 'Disabling a site must clean already-open matching tabs.');
assert(background.includes('chrome.permissions.onRemoved'), 'Chrome site access changes must resynchronize registrations.');
assert(!background.includes('chrome.permissions.request('), 'Background must not request site permissions.');
assert(!background.includes('chrome.permissions.remove('), 'Disabling a site must not revoke host access.');
assert(background.includes('hasPermissionForHost(host)'), 'Respect Chrome site-access restrictions.');
assert(background.includes("case 'runtime:state'"), 'Tab icon state must be driven without the broad tabs permission.');
assert(background.includes('settingsMutationQueue'), 'Settings mutations must be serialized to prevent lost updates.');
assert(background.includes('siteOperationQueue'), 'Site enable/disable operations must be serialized end to end.');
assert(!background.includes('enabledSites.filter(hostname => !removedSet.has(hostname))'), 'Chrome site-access changes must preserve user preferences.');
assert(background.includes('contextMenuSyncQueue'), 'Context-menu synchronization must be serialized.');
assert(background.includes('chrome.contextMenus.update(id, properties, done)'), 'Context menus must update existing IDs idempotently.');
assert(background.includes('chrome.contextMenus.create(entry, done)'), 'Context-menu creation errors must be observed through callbacks.');
assert(!background.includes('chrome.contextMenus.removeAll()'), 'Context menus must not rely on the Chrome 123+ removeAll Promise.');
assert(background.includes('ping.version === expectedVersion'), 'Existing tabs must upgrade stale injected runtimes.');
assert(background.includes('refreshOpenEnabledTabs'), 'Extension updates must refresh runtimes in already-open enabled tabs.');
assert(background.includes('await updateIcon(tabId, hostname, currentSettings)'), 'Open enabled tabs must restore their active toolbar icon.');
assert(background.includes('await refreshOpenEnabledTabs();'), 'Startup and update flows must restore open-tab runtime and icon state.');
assert(background.includes('await updateIcon(message.tabId, message.hostname, status.settings)'), 'Reading current-site status must self-heal the toolbar icon.');
assert(background.includes("type: 'runtime:cleanup', hostname: host"), 'Permission cleanup must be host-scoped.');
assert(background.includes('chrome.tabs.onUpdated'), 'Per-tab icon state must refresh during navigation.');
assert(background.includes('chrome.tabs.onActivated'), 'Switching tabs must recheck the persisted icon state.');
assert(!background.includes("if (changeInfo.status !== 'loading') return;"), 'Navigation must not blindly reset enabled icons.');
assert(background.includes('await refreshTabIcon(tabId)'), 'Runtime messages must not overwrite stored enabled state with stale active flags.');
assert(!background.includes('syncRegistrations(Core.normalizeSettings'), 'Registration sync must read the latest stored settings.');

const core = await read('lib/core.js');
assert(core.includes('`http://${host}/*`'), 'Runtime host requests must use the declared HTTP scheme.');
assert(core.includes('`https://${host}/*`'), 'Runtime host requests must use the declared HTTPS scheme.');
assert(!core.includes('`*://${host}/*`'), 'Wildcard-scheme permission requests are not manifest-compatible.');

const content = await read('content.js');
assert(background.includes('tabStillOpen'), 'Closed tabs must not fail persisted site activation.');
assert(background.includes('.then(() => refreshOpenEnabledTabs())'), 'Restored permission must refresh already open enabled tabs.');
assert(content.includes('MutationObserver'), 'The content runtime must be event driven.');
assert(!content.includes('setInterval('), 'The content runtime must not use polling intervals.');
assert(content.includes("attributeFilter: ['dir']"), 'Only host dir rewrites may be observed; page-wide class/style observation lags busy SPAs.');
assert(!/attributeFilter[^\n]*'(class|style)'/.test(content), 'class/style attribute observation is forbidden for performance.');
assert(!content.includes('.innerText'), 'innerText forces synchronous layout; use textContent.');
assert(content.includes('requestIdleCallback'), 'DOM work must run in idle callbacks.');
assert(content.includes('FRAME_BUDGET_MS'), 'Idle work must be time-budgeted.');
assert(!/SITE_ADAPTERS|location\.hostname ===|isGrokRoute|tweetText|data-message-author-role|prompt-textarea/.test(content), 'The content engine must stay site-agnostic; host selectors break on redesigns.');
assert(content.includes('NESTED_BLOCK_SELECTOR'), 'Layout containers must never be marked as text blocks.');
assert(content.includes('LIST_ITEM_CONTAINER_SELECTOR'), 'Message containers rendered as <li> must not become RTL list items.');
assert(content.includes('ownedAttributesMatch'), 'Text signatures must not conceal host direction rewrites.');
assert(content.includes('restoreAll()'), 'DOM mutations must be reversible.');
assert(content.includes('this.appliedState = new WeakMap()'), 'DOM restoration must track extension-owned attribute values.');
assert(content.includes('setOwnedAttribute'), 'DOM writes must record extension ownership before cleanup.');
assert(!content.includes('unicode-bidi: plaintext'), 'RTL paragraphs must not derive their base direction from a leading Latin token.');
assert(content.includes('unicode-bidi: isolate !important;'), 'Mixed-direction text must use an isolated forced RTL base direction.');
assert(content.includes("const LIST_ATTR = 'data-rtl-fixancer-list';"), 'RTL list containers require reversible runtime state.');
assert(content.includes('list-style-position: outside !important;'), 'Ordered-list markers must stay outside RTL content.');
assert(content.includes('> li::marker'), 'RTL list markers require dedicated bidi styling.');
assert(content.includes("const LTR_ATTR = 'data-rtl-fixancer-ltr';"), 'Short Latin inline tokens inside RTL blocks must be isolated.');
assert(content.includes('nestedTextFontRule'), 'RTL text descendants need explicit font styling to override host fonts.');
assert(content.includes('protectedRegion') && content.includes('unprotected'), 'Code and explicit LTR segments must be excluded from font overrides.');
assert(content.includes('${scope} ${protectedRegion}'), 'LTR/code exclusions must be scoped within a marked RTL block.');
assert(content.includes('SCROLL_BUDGET_MS') && content.includes("addEventListener('scroll', this.onScroll, { capture: true, passive: true })"), 'Idle work must yield while the user scrolls.');
assert(content.includes('LTR_ISOLATION_SELECTOR') && !content.includes("LTR_ISOLATION_SELECTOR = 'span"), 'Per-word <span> wrappers must not be rescanned for LTR isolation.');
assert(!/['"`]\[class\*=/.test(content), 'Substring class selectors match Tailwind variants (Grok) and are slow on per-word spans.');
assert(content.includes('TEXT_BLOCK_TAGS'), 'Paragraphs with embedded widgets (citation chips) must stay text blocks.');
assert(content.includes('SINGLE_WORD_RE'), 'Per-word spans must not be isolated one by one.');
assert(content.includes('adoptedStyleSheets'), 'Open shadow roots must receive the RTL rules.');
assert(content.includes('async applySettings(nextSettings)'), 'Storage changes should avoid unnecessary full runtime restarts.');
assert(content.includes('const keep = editor.getAttribute(INPUT_ATTR)'), 'Composers need direction hysteresis to avoid caret jumps.');
assert(content.includes('mirrorsFor(editor)'), 'Auto-grow textarea mirrors must match the composer direction.');
assert(content.includes('editorHostFor(element)'), 'Nested editor events must resolve to their editable host.');
assert(content.includes('[${INPUT_ATTR}="rtl"] > p, [${INPUT_ATTR}="rtl"] > div'), 'Rich-text editor child blocks must inherit forced RTL alignment.');
assert(content.includes('existingRuntime.version === RUNTIME_VERSION'), 'Injected runtime replacement must be version aware.');
assert(content.includes('version: this.version'), 'Runtime ping must report its implementation version.');
assert(content.includes('requestedHost'), 'Cleanup messages must be scoped to the requested host.');

const popupHtml = await read('popup.html');
const popupCss = await read('popup.css');
const popupJs = await read('popup.js');
assert(popupHtml.includes('id="languageToggle"'), 'The compact header language switch is required.');
assert(!popupHtml.includes('id="languageSelect"'), 'The old footer language select must not return.');
assert(popupHtml.includes('class="section-icon'), 'Popup sections must use a consistent SVG icon system.');
assert(!/[🌐⚙️📋🗑️]/u.test(popupHtml), 'Decorative emoji icons are not allowed in the popup.');
assert(popupCss.includes('RTLFixancerShabnamUI'), 'The bundled Persian UI font must be declared.');
assert(popupCss.includes('grid-template-columns: repeat(3, minmax(0, 1fr))'), 'Settings must remain in a compact three-column layout.');
assert(!popupJs.includes('innerHTML'), 'Popup DOM must not be assembled with innerHTML.');
assert(!popupJs.includes('chrome.permissions.request('), 'Popup must not display per-site Allow dialogs.');
assert(!popupJs.includes('requestCurrentSitePermission'), 'Remove per-site permission request workflow.');
assert(!popupJs.includes('chrome.permissions.contains('), 'Only background should check granted host access.');
assert(popupJs.includes('createTrashIcon'), 'Dynamic site actions must use the shared SVG icon builder.');
assert(popupJs.includes("type: 'site:status'") && popupJs.includes('tabId: state.tab?.id ?? null'), 'Popup status refresh must identify the current tab so its icon can be synchronized.');

console.log('Validation passed: one-time host access, per-site opt-in without Allow prompts, reversible site-agnostic RTL, popup, and source safety.');
