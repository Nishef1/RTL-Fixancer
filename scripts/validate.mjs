import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');
const manifest = JSON.parse(await read('manifest.json'));

assert.equal(manifest.manifest_version, 3, 'Manifest V3 is required.');
assert.equal(manifest.version, '4.0.0');
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

const content = await read('content.js');
assert(content.includes('MutationObserver'), 'The content runtime must be event driven.');
assert(content.includes("attributeFilter: ['class', 'role', 'aria-hidden', 'contenteditable']"), 'Relevant host UI attribute changes must be observed.');
assert(!content.includes('setInterval('), 'The content runtime must not use polling intervals.');
assert(content.includes('restoreAll()'), 'DOM mutations must be reversible.');

console.log('Validation passed: manifest, permissions, runtime architecture, and source safety checks are valid.');
