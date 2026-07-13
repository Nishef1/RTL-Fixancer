import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');
const manifest = JSON.parse(await read('manifest.json'));

assert.equal(manifest.manifest_version, 3, 'Manifest V3 is required.');
assert.equal(manifest.version, '4.1.0');
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

const core = await read('lib/core.js');
assert(core.includes('`http://${host}/*`'), 'Runtime host requests must use the declared HTTP scheme.');
assert(core.includes('`https://${host}/*`'), 'Runtime host requests must use the declared HTTPS scheme.');
assert(!core.includes('`*://${host}/*`'), 'Wildcard-scheme permission requests are not manifest-compatible.');

const content = await read('content.js');
assert(content.includes('MutationObserver'), 'The content runtime must be event driven.');
assert(content.includes("attributeFilter: ['class', 'role', 'aria-hidden', 'contenteditable']"), 'Relevant host UI attribute changes must be observed.');
assert(!content.includes('setInterval('), 'The content runtime must not use polling intervals.');
assert(content.includes('restoreAll()'), 'DOM mutations must be reversible.');

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

console.log('Validation passed: manifest, permissions, runtime, popup design, and source safety checks are valid.');
