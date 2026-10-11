import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const coreSource = await readFile(new URL('../lib/core.js', import.meta.url), 'utf8');
const contentSource = await readFile(new URL('../content.js', import.meta.url), 'utf8');

async function grokFixture(selectedFont, pathname = '/i/grok', fontSize = 'default') {
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
            sync: { get() { return Promise.resolve({ settings: { selectedFont, fontSize, enabledSites: ['x.com'] } }); } },
            onChanged: { addListener() {} }
        }
    };
    class MutationObserver {
        observe(_root, options) { this.options = options; }
        disconnect() {}
    }
    const Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
    const context = vm.createContext({ URL, Node, document, chrome, MutationObserver,
        location: { hostname: 'x.com', pathname } });
    context.globalThis = context;
    vm.runInContext(coreSource, context);
    vm.runInContext(contentSource, context);
    for (let i = 0; i < 10 && inserted.length === 0; i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(inserted.length, 1, 'Grok runtime must insert its stylesheet');
    return { css: inserted[0].textContent, runtime: context.__RTL_FIXANCER_RUNTIME_V4__, context };
}

async function grokStyles(selectedFont) {
    return (await grokFixture(selectedFont)).css;
}

test('Grok applies selected font to nested text without losing heading weights', async () => {
    const css = await grokStyles('vazir');
    assert.match(css, /\[data-rtl-fixancer="rtl"\] :is\(span, a, strong, b, em/);
    // X's LTR page wrapper must not disable font styling in marked RTL text.
    assert.match(css, /:not\(pre, \[data-rtl-fixancer="rtl"\] pre \*/);
    assert.match(css, /\[dir="ltr"\], \[data-rtl-fixancer="rtl"\] \[dir="ltr"\] \*/);
    assert.doesNotMatch(css, /:not\(pre, pre \*/);
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

test('standalone native Grok RTL spans are processed without a markdown ancestor', async () => {
    const { runtime } = await grokFixture('vazir');
    const standalone = {
        matches(selector) {
            return selector.includes('span[style*="direction: rtl" i]');
        },
        closest(selector) {
            return selector === 'main, [role="main"]' ? {} : null;
        }
    };
    assert.equal(runtime.isGrokTextRoot(standalone), true);
    assert.equal(runtime.isInContentArea(standalone), true);
    assert.ok(runtime.candidateSelector().includes('span[style*="direction: rtl" i]'));

    // The same span outside main, or on non-Grok X pages, is untouched.
    const outsideMain = { ...standalone, closest() { return null; } };
    assert.equal(runtime.isInContentArea(outsideMain), false);
    const ordinaryX = await grokFixture('vazir', '/home');
    assert.equal(ordinaryX.runtime.isGrokTextRoot(standalone), false);
});

test('Grok font CSS excludes local LTR regions, not page-wide LTR ancestors', async () => {
    const css = await grokStyles('shabnam');
    assert.ok(css.includes('[data-rtl-fixancer="rtl"] [dir="ltr"] *'));
    assert.ok(css.includes('[data-rtl-fixancer-list="rtl"] > li [dir="ltr"] *'));
    assert.ok(!css.includes(', [dir="ltr"] *,'));
    assert.match(css, /font-family: 'RTLFixancerShabnam'/);
});

test('relative font size applies once on a marked RTL ancestor, not on each nested span', async () => {
    const { css } = await grokFixture('vazir', '/i/grok', 'small');
    assert.match(css, /\[data-rtl-fixancer="rtl"\]:not\(\[data-rtl-fixancer="rtl"\] \[data-rtl-fixancer="rtl"\]\)/);
    assert.equal(css.match(/font-size: 0\.9em !important;/g)?.length, 1);
    const base = css.match(/\[data-rtl-fixancer="rtl"\], \[data-rtl-fixancer-input="rtl"\] \{([^}]+)\}/);
    assert.ok(base);
    assert.doesNotMatch(base[1], /font-size:/);
});

test('Grok observes native style/dir changes without observing every X page', async () => {
    const grok = await grokFixture('vazir');
    const home = await grokFixture('vazir', '/home');
    assert.ok(grok.runtime.observer.options.attributeFilter.includes('style'));
    assert.ok(grok.runtime.observer.options.attributeFilter.includes('dir'));
    assert.ok(!home.runtime.observer.options.attributeFilter.includes('style'));
    assert.ok(!home.runtime.observer.options.attributeFilter.includes('dir'));
    home.context.location.pathname = '/i/grok';
    home.runtime.onMutation([]);
    assert.ok(home.runtime.observer.options.attributeFilter.includes('style'));
    home.context.location.pathname = '/home';
    home.runtime.onMutation([]);
    assert.ok(!home.runtime.observer.options.attributeFilter.includes('style'));
});

test('extension-owned dir=rtl does not promote nested spans to native Grok roots', async () => {
    const { runtime } = await grokFixture('vazir');
    const span = { matches(selector) { return selector.includes('span[dir="rtl"]'); } };
    assert.equal(runtime.isGrokTextRoot(span), true);
    runtime.originalState.set(span, { dir: { present: false, value: null } });
    assert.equal(runtime.isGrokTextRoot(span), false);
});

test('unchanged text re-applies overwritten dir and restores the latest host value', async () => {
    const { runtime } = await grokFixture('vazir');
    const attrs = new Map([['dir', 'auto']]);
    const el = {
        isConnected: true,
        hasAttribute(name) { return attrs.has(name); },
        getAttribute(name) { return attrs.get(name) ?? null; },
        setAttribute(name, value) { attrs.set(name, value); },
        removeAttribute(name) { attrs.delete(name); },
        closest() { return null; },
        matches() { return false; }
    };
    runtime.shouldSkip = () => false;
    runtime.getText = () => 'سلام این یک متن فارسی است';
    runtime.rtlBlockAncestor = () => null;
    runtime.isInlineElement = () => false;
    runtime.processElement(el);
    assert.equal(el.getAttribute('dir'), 'rtl');
    el.setAttribute('dir', 'ltr');
    runtime.processElement(el);
    assert.equal(el.getAttribute('dir'), 'rtl');
    runtime.restoreElement(el);
    assert.equal(el.getAttribute('dir'), 'ltr');
    assert.equal(el.hasAttribute('data-rtl-fixancer'), false);
});
