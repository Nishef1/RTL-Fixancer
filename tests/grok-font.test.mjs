import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const coreSource = await readFile(new URL('../lib/core.js', import.meta.url), 'utf8');
const contentSource = await readFile(new URL('../content.js', import.meta.url), 'utf8');

async function grokStyles(selectedFont) {
    const inserted = [];
    const documentElement = {
        appendChild(node) { inserted.push(node); node.isConnected = true; },
        querySelectorAll() { return []; }
    };
    const document = {
        head: documentElement,
        documentElement,
        createElement() { return { id: '', textContent: '', remove() {} }; },
        querySelectorAll() { return []; },
        addEventListener() {},
        removeEventListener() {}
    };
    const chrome = {
        runtime: {
            getURL(path) { return 'chrome-extension://test/' + path; },
            sendMessage() { return Promise.resolve({ ok: true }); },
            onMessage: { addListener() {} }
        },
        storage: {
            sync: { get() { return Promise.resolve({ settings: { selectedFont, enabledSites: ['x.com'] } }); } },
            onChanged: { addListener() {} }
        }
    };
    class MutationObserver { observe() {} disconnect() {} }
    const context = vm.createContext({ URL, document, chrome, MutationObserver,
        location: { hostname: 'x.com', pathname: '/i/grok' } });
    context.globalThis = context;
    vm.runInContext(coreSource, context);
    vm.runInContext(contentSource, context);
    for (let i = 0; i < 10 && inserted.length === 0; i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(inserted.length, 1, 'Grok runtime must insert its stylesheet');
    return inserted[0].textContent;
}

test('Grok applies selected font to nested text without losing heading weights', async () => {
    const css = await grokStyles('vazir');
    assert.match(css, /\[data-rtl-fixancer="rtl"\] :is\(span, a, strong, b, em/);
    assert.match(css, /:not\(pre, pre \*, code, code \*/);
    assert.match(css, /\[dir="ltr"\], \[dir="ltr"\] \*/);
    assert.match(css, /font-family: 'RTLFixancerVazir'/);
    assert.doesNotMatch(css, /font-family: revert !important;/);
    assert.doesNotMatch(css, /font-weight: inherit !important/);
});

test('Grok respects the native font selection', async () => {
    const css = await grokStyles('default');
    assert.doesNotMatch(css, /font-family: 'RTLFixancerVazir' !important/);
    assert.doesNotMatch(css, /font-family: 'RTLFixancerShabnam' !important/);
    assert.doesNotMatch(css, /font-family: revert !important;/);
});
