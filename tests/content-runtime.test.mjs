import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const coreSource = await readFile(new URL('../lib/core.js', import.meta.url), 'utf8');
const contentSource = await readFile(new URL('../content.js', import.meta.url), 'utf8');

async function runtimeFixture({ selectedFont = 'vazir', fontSize = 'default' } = {}) {
    const inserted = [];
    const documentElement = {
        appendChild(node) { inserted.push(node); node.isConnected = true; },
        querySelectorAll() { return []; }
    };
    const document = {
        head: documentElement,
        documentElement,
        createElement() { return { id: '', textContent: '', remove() {} }; },
        createTreeWalker() { return { nextNode() { return null; } }; },
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
            sync: { get() { return Promise.resolve({ settings: { selectedFont, fontSize, enabledSites: ['example.com'] } }); } },
            onChanged: { addListener() {} }
        }
    };
    class MutationObserver {
        observe(_root, options) { this.options = options; }
        disconnect() {}
    }
    const context = vm.createContext({
        URL, document, chrome, MutationObserver, performance,
        Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
        NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 },
        requestIdleCallback() { return 1; },
        cancelIdleCallback() {},
        location: { hostname: 'example.com' }
    });
    context.globalThis = context;
    vm.runInContext(coreSource, context);
    vm.runInContext(contentSource, context);
    for (let i = 0; i < 10 && inserted.length === 0; i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(inserted.length, 1, 'runtime must insert its stylesheet');
    return { css: inserted[0].textContent, runtime: context.__RTL_FIXANCER_RUNTIME_V4__ };
}

function fakeElement(localName, attributes = {}) {
    const attrs = new Map(Object.entries(attributes));
    return {
        localName,
        isConnected: true,
        parentElement: null,
        hasAttribute(name) { return attrs.has(name); },
        getAttribute(name) { return attrs.get(name) ?? null; },
        setAttribute(name, value) { attrs.set(name, String(value)); },
        removeAttribute(name) { attrs.delete(name); },
        closest() { return null; },
        matches() { return false; },
        querySelector() { return null; },
        querySelectorAll() { return []; }
    };
}

test('observes only dir attributes, never page-wide class or style churn', async () => {
    const { runtime } = await runtimeFixture();
    const options = runtime.observer.options;
    assert.deepEqual([...options.attributeFilter], ['dir']);
    assert.equal(options.childList, true);
    assert.equal(options.characterData, true);
});

test('applies the selected font to nested text without letting a page-wide LTR wrapper disable it', async () => {
    const { css } = await runtimeFixture();
    // Exclusions are simple selectors on the span itself...
    assert.ok(css.includes('[data-rtl-fixancer="rtl"] span:where(:not([dir="ltr"]):not([data-rtl-fixancer-ltr="true"])'));
    // ...and only regions INSIDE the marked block pass their font down.
    assert.ok(css.includes('[data-rtl-fixancer="rtl"] :is(pre, code, kbd, samp, [dir="ltr"]'));
    assert.ok(css.includes('[data-rtl-fixancer-list="rtl"] > li :is(pre, code, kbd, samp, [dir="ltr"]'));
    assert.doesNotMatch(css, /:not\([^)]*\s\*/, 'no descendant combinators inside :not()');
    // Every selector ends in a tag/attribute, never an :is() list, so the
    // style engine can index it instead of testing every element.
    for (const selector of css.split('{').map(part => part.split('}').pop()).join(',').split(',')) {
        assert.doesNotMatch(selector.trim(), /:is\([^)]*\)$/, `selector ends in :is(): ${selector.trim()}`);
    }
    assert.doesNotMatch(css, /class\*=/);
    assert.match(css, /font-family: 'RTLFixancerVazir'/);
});

test('uses a Hebrew fallback stack for Hebrew blocks', async () => {
    const { css } = await runtimeFixture();
    assert.match(css, /\[data-rtl-fixancer-language="he"\][^{]*\{\s*font-family: 'RTLFixancerVazir', 'Noto Sans Hebrew'/);
});

test('respects the native font selection', async () => {
    const { css } = await runtimeFixture({ selectedFont: 'default' });
    assert.doesNotMatch(css, /RTLFixancerVazir' !important|RTLFixancerVazir', 'Noto/);
    assert.doesNotMatch(css, /font-family: 'RTLFixancerShabnam'.*!important/);
});

test('relative font size applies once on the outermost marked block', async () => {
    const { css } = await runtimeFixture({ fontSize: 'small' });
    assert.match(css, /\[data-rtl-fixancer="rtl"\]:not\(\[data-rtl-fixancer="rtl"\] \[data-rtl-fixancer="rtl"\]\)/);
    assert.equal(css.match(/font-size: 0\.9em !important;/g)?.length, 1);
});

test('a paragraph stays a text block even with a nested widget', async () => {
    const { runtime } = await runtimeFixture();
    const paragraph = fakeElement('p');
    paragraph.querySelector = () => ({});
    paragraph.querySelectorAll = () => [{}];
    assert.equal(runtime.isTextBlock(paragraph), true);
});

test('a Tailwind code-block variant class on an ancestor does not skip the text', async () => {
    const { runtime } = await runtimeFixture();
    const block = fakeElement('div');
    block.className = 'space-y-4 [&_[data-streamdown=code-block]]:border-0 group-data-[sidebar=open]:px-2';
    block.closest = selector => (selector.includes('code-block') ? {} : null);
    assert.equal(runtime.isTextBlock(block), true);
    block.className = 'app-sidebar';
    assert.equal(runtime.isTextBlock(block), false);
});

test('a chat message rendered as <li> is a container, not an RTL list item', async () => {
    const { runtime } = await runtimeFixture();
    const message = fakeElement('li');
    message.querySelector = selector => (selector.includes('h4') ? {} : null);
    assert.equal(runtime.isListItemBlock(message), false);

    const item = fakeElement('li');
    const paragraph = { closest: () => item };
    item.querySelectorAll = () => [paragraph];
    assert.equal(runtime.isListItemBlock(item), true);

    const loose = fakeElement('li');
    loose.querySelectorAll = () => Array.from({ length: 6 }, () => ({ closest: () => loose }));
    assert.equal(runtime.isListItemBlock(loose), false);
});

test('unchanged text re-applies an overwritten dir and restores the latest host value', async () => {
    const { runtime } = await runtimeFixture();
    const block = fakeElement('div', { dir: 'auto' });
    runtime.isTextBlock = () => true;
    runtime.blockText = () => 'سلام این یک متن فارسی است';
    runtime.processBlock(block);
    assert.equal(block.getAttribute('dir'), 'rtl');
    assert.equal(block.getAttribute('data-rtl-fixancer'), 'rtl');

    block.setAttribute('dir', 'ltr');
    runtime.processBlock(block);
    assert.equal(block.getAttribute('dir'), 'rtl');

    runtime.restoreBlock(block);
    assert.equal(block.getAttribute('dir'), 'ltr');
    assert.equal(block.hasAttribute('data-rtl-fixancer'), false);
});

test('a block that becomes English is restored exactly', async () => {
    const { runtime } = await runtimeFixture();
    const block = fakeElement('p');
    let text = 'این پاراگراف فارسی است';
    runtime.isTextBlock = () => true;
    runtime.blockText = () => text;
    runtime.processBlock(block);
    assert.equal(block.getAttribute('dir'), 'rtl');
    text = 'This paragraph is now English';
    runtime.processBlock(block);
    assert.equal(block.hasAttribute('dir'), false);
    assert.equal(block.hasAttribute('data-rtl-fixancer'), false);
});

test('a composer stays RTL while mixed text is typed and keeps its host font size', async () => {
    const { runtime, css } = await runtimeFixture({ fontSize: 'large' });
    const editor = fakeElement('textarea');
    editor.value = 'سلام دوست من';
    editor.closest = selector => (selector.includes('textarea') ? editor : null);
    runtime.processEditor(editor);
    assert.equal(editor.getAttribute('dir'), 'rtl');
    editor.value = 'سلام please check this English sentence for me';
    runtime.processEditor(editor);
    assert.equal(editor.getAttribute('dir'), 'rtl', 'must not flip back mid-typing');
    editor.value = 'only English now';
    runtime.processEditor(editor);
    assert.equal(editor.hasAttribute('dir'), false);
    assert.doesNotMatch(css, /\[data-rtl-fixancer-input="rtl"\]:not\(/, 'editors must not be resized');
});

test('a bullet row with its own RTL text and a nested sub-row is a text block', async () => {
    const { runtime } = await runtimeFixture();
    const row = fakeElement('div');
    row.firstChild = { nodeType: 3, data: '• گزینه دوم', nextSibling: null };
    runtime.hasNestedBlock = () => true;
    assert.equal(runtime.isTextBlock(row), true);
    row.firstChild = { nodeType: 3, data: '   ', nextSibling: null };
    assert.equal(runtime.isTextBlock(row), false);
});

test('an auto-grow mirror beside a textarea gets the same RTL state and is never a text block', async () => {
    const { runtime } = await runtimeFixture();
    const parent = fakeElement('div');
    const editor = fakeElement('textarea');
    const mirror = fakeElement('div');
    mirror.childElementCount = 0;
    editor.value = 'سلام دوست من';
    editor.parentElement = parent;
    mirror.parentElement = parent;
    parent.children = [editor, mirror];
    parent.querySelector = selector => (selector.includes('textarea') ? editor : null);
    editor.closest = selector => (selector.includes('textarea') ? editor : null);
    runtime.processEditor(editor);
    assert.equal(mirror.getAttribute('dir'), 'rtl');
    assert.equal(mirror.getAttribute('data-rtl-fixancer-input'), 'rtl');
    assert.equal(runtime.isTextBlock(mirror), false);
    runtime.processBlock(mirror);
    assert.equal(mirror.getAttribute('dir'), 'rtl', 'block pass must not undo the mirror');
    editor.value = 'English';
    runtime.processEditor(editor);
    assert.equal(mirror.hasAttribute('dir'), false);
});
