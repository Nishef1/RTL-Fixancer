import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');
const manifest = JSON.parse(await read('manifest.json'));

assert.equal(manifest.manifest_version, 3, 'Manifest V3 is required.');
assert.equal(manifest.version, '4.1.4');
assert.equal(manifest.background?.service_worker, 'background.js');
assert.equal(manifest.content_scripts, undefined, 'Static all-site content scripts are forbidden.');
assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*']);
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
assert(background.includes('chrome.permissions.onRemoved'), 'Permission changes must resynchronize dynamic registrations.');
assert(background.includes("case 'runtime:state'"), 'Tab icon state must be driven without the broad tabs permission.');
assert(background.includes('settingsMutationQueue'), 'Settings mutations must be serialized to prevent lost updates.');
assert(background.includes('siteOperationQueue'), 'Site enable/disable operations must be serialized end to end.');
assert(background.includes('ping.version === expectedVersion'), 'Existing tabs must upgrade stale injected runtimes.');
assert(background.includes("type: 'runtime:cleanup', hostname: host"), 'Permission cleanup must be host-scoped.');
assert(background.includes('chrome.tabs.onUpdated'), 'Per-tab icon state must reset when navigation begins.');
assert(!background.includes('syncRegistrations(Core.normalizeSettings'), 'Registration sync must read the latest stored settings.');

const core = await read('lib/core.js');
assert(core.includes('`http://${host}/*`'), 'Runtime host requests must use the declared HTTP scheme.');
assert(core.includes('`https://${host}/*`'), 'Runtime host requests must use the declared HTTPS scheme.');
assert(!core.includes('`*://${host}/*`'), 'Wildcard-scheme permission requests are not manifest-compatible.');

const content = await read('content.js');
assert(content.includes('MutationObserver'), 'The content runtime must be event driven.');
assert(content.includes("'class', 'role', 'aria-hidden', 'contenteditable'"), 'Relevant host UI attribute changes must be observed.');
assert(content.includes("observedAttributes: ['data-message-author-role', 'data-testid']"), 'ChatGPT runtime identity changes must be observed.');
assert(!content.includes('setInterval('), 'The content runtime must not use polling intervals.');
assert(content.includes('restoreAll()'), 'DOM mutations must be reversible.');
assert(!content.includes('unicode-bidi: plaintext'), 'RTL paragraphs must not derive their base direction from a leading Latin token.');
assert(content.includes('unicode-bidi: isolate !important;'), 'Mixed-direction text must use an isolated forced RTL base direction.');
assert(content.includes("const LIST_ATTR = 'data-rtl-fixancer-list';"), 'RTL list containers require reversible runtime state.');
assert(content.includes('list-style-position: outside !important;'), 'Ordered-list markers must stay outside RTL content.');
assert(content.includes('> li::marker'), 'RTL list markers require dedicated bidi styling.');
assert(content.includes("const LTR_ATTR = 'data-rtl-fixancer-ltr';"), 'Short Latin inline tokens inside RTL blocks must be isolated.');
assert(content.includes('enqueueCandidateAndBlock'), 'Streaming inline changes must also reclassify their parent text block.');
assert(content.includes('[data-testid*="conversation-turn" i]'), 'ChatGPT turn selectors must support generated test IDs.');
assert(content.includes("'.markdown'"), 'ChatGPT markdown output must remain inside the processing boundary.');
assert(content.includes("'.prose'"), 'ChatGPT prose output must remain inside the processing boundary.');
assert(content.includes('messageRootFor'), 'Live chat mutations must resolve their enclosing message root.');
assert(content.includes('markMessageDirty'), 'Live message roots must be queued for reprocessing.');
assert(content.includes('this.dirtyRoots = new Set()'), 'Message-root reprocessing must be deduplicated.');
assert(content.includes('this.dirtyRoots.clear()'), 'Message-root work must be cancelled during cleanup.');
assert(content.includes("name: 'x'"), 'X/Twitter requires a dedicated content boundary.');
assert(content.includes('[data-testid="tweetText"]'), 'X/Twitter tweet blocks must be processed as block candidates.');
assert(content.includes('this.appliedState = new WeakMap()'), 'DOM restoration must track extension-owned attribute values.');
assert(content.includes('setOwnedAttribute'), 'DOM writes must record extension ownership before cleanup.');
assert(content.includes('async applySettings(nextSettings)'), 'Storage changes should avoid unnecessary full runtime restarts.');
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
assert(popupJs.includes('createTrashIcon'), 'Dynamic site actions must use the shared SVG icon builder.');

console.log('Validation passed: permissions, X/Twitter blocks, reversible DOM ownership, serialized settings, live chat streaming, RTL lists, popup design, and source safety checks are valid.');
