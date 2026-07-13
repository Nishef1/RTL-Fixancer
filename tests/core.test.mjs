import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../lib/core.js', import.meta.url), 'utf8');
const context = vm.createContext({ URL, globalThis: {} });
context.globalThis = context;
vm.runInContext(source, context, { filename: 'lib/core.js' });
const Core = context.RTLFixancerCore;

test('normalizes hostnames and rejects invalid values', () => {
    assert.equal(Core.normalizeHostname('..ChatGPT.COM.'), 'chatgpt.com');
    assert.equal(Core.normalizeHostname(null), '');
    assert.equal(Core.normalizeHostname('example.com/path'), '');
    assert.equal(Core.normalizeHostname('*.example.com'), '');
});

test('builds an exact-host match pattern', () => {
    assert.deepEqual([...Core.matchPatternsForHost('example.com')], ['*://example.com/*']);
    assert.deepEqual([...Core.matchPatternsForHost('localhost')], ['*://localhost/*']);
    assert.deepEqual([...Core.matchPatternsForHost('127.0.0.1')], ['*://127.0.0.1/*']);
});

test('matches only the exact enabled hostname', () => {
    assert.equal(Core.siteMatches(['example.com'], 'example.com'), true);
    assert.equal(Core.siteMatches(['example.com'], 'chat.example.com'), false);
    assert.equal(Core.siteMatches(['example.com'], 'notexample.com'), false);
    assert.equal(Core.findMatchingSite(['example.com', 'chat.example.com'], 'chat.example.com'), 'chat.example.com');
});

test('normalizes settings to supported values', () => {
    const settings = Core.normalizeSettings({
        selectedFont: 'unknown',
        fontSize: 'large',
        detectionMode: 'relaxed',
        uiLanguage: 'fa',
        enabledSites: ['EXAMPLE.com', 'example.com', 'chat.example.com', '', null]
    });
    assert.equal(settings.selectedFont, 'vazir');
    assert.equal(settings.fontSize, 'large');
    assert.equal(settings.detectionMode, 'relaxed');
    assert.equal(settings.uiLanguage, 'fa');
    assert.deepEqual([...settings.enabledSites], ['chat.example.com', 'example.com']);
});

test('detects Persian, Arabic, and Hebrew text', () => {
    assert.equal(Core.classifyText('سلام، حالت چطوره؟').language, 'fa');
    assert.equal(Core.classifyText('مرحبا كيف حالك').language, 'ar');
    assert.equal(Core.classifyText('שלום עולם').language, 'he');
});

test('keeps English text LTR and supports sensitivity thresholds', () => {
    assert.equal(Core.classifyText('Hello world').direction, 'ltr');
    assert.equal(Core.classifyText('x ا', 'strict').direction, 'ltr');
    assert.equal(Core.classifyText('x ا', 'relaxed').direction, 'rtl');
});

test('generates stable, host-specific registration IDs', () => {
    const first = Core.registrationId('example.com');
    assert.equal(first, Core.registrationId('EXAMPLE.COM'));
    assert.notEqual(first, Core.registrationId('example.org'));
    assert.match(first, /^rtl-fixancer-[a-z0-9]+$/);
});
