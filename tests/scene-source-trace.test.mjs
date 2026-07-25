import assert from 'node:assert/strict';

function el(tag) {
    const node = {
        tagName: String(tag).toUpperCase(),
        className: '',
        innerHTML: '',
        textContent: '',
        hidden: false,
        type: '',
        title: '',
        children: [],
        attributes: {},
        classList: {
            _s: new Set(),
            add(c) { this._s.add(c); node.className = [...this._s].join(' '); },
            remove(c) { this._s.delete(c); node.className = [...this._s].join(' '); },
            contains(c) { return this._s.has(c); },
        },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return this.attributes[name]; },
        appendChild(child) {
            this.children.push(child);
            child.parentNode = this;
            return child;
        },
        insertBefore(child, ref) {
            const i = this.children.indexOf(ref);
            if (i < 0) this.children.push(child);
            else this.children.splice(i, 0, child);
            child.parentNode = this;
            return child;
        },
        addEventListener(type, fn) {
            this._listeners = this._listeners || {};
            (this._listeners[type] = this._listeners[type] || []).push(fn);
        },
        click() {
            for (const fn of this._listeners?.click || []) fn({ stopPropagation() {}, preventDefault() {} });
        },
        querySelector(sel) {
            if (sel === '.sp-gen-footer') return this.children.find(c => c.className === 'sp-gen-footer') || null;
            if (sel === '.sp-gen-lore') {
                for (const c of this.children) {
                    if (c.className === 'sp-gen-lore') return c;
                    for (const k of c.children || []) if (k.className === 'sp-gen-lore') return k;
                }
                return null;
            }
            if (sel === '.sp-source-trace-drawer') return this.children.find(c => c.className === 'sp-source-trace-drawer') || null;
            return null;
        },
    };
    return node;
}

globalThis.document = {
    createElement: el,
    body: el('body'),
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
};
globalThis.window = { addEventListener() {}, innerWidth: 1280, innerHeight: 720 };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.SillyTavern = {
    getContext: () => ({
        extensionSettings: { scenepulse: {} },
        chatMetadata: {},
        chat: [{ mes: 'She met Artoria Pendragon Lancer at the gate.' }],
    }),
};

const {
    normalizeWorldInfoEvent,
    startSceneSourceTrace,
    recordWorldInfoActivation,
    finishSceneSourceTrace,
    rebindSceneSourceTraceOwner,
    cancelSceneSourceTrace,
    _resetSceneSourceTraceForTests,
    matchEntryKeys,
    parseWiRegexKey,
    buildWiScanBuffer,
    applyMatchedKeysToEntries,
    trimLorebookForStorage,
    MAX_LOREBOOK_JSON_BYTES,
} = await import('../src/scene-source-trace.js');
const {
    formatLoreChipLabel,
    formatTraceEntryLine,
    buildTraceDrawerModel,
    mountSceneSourceTrace,
} = await import('../src/ui/scene-source-trace-ui.js');

const buf = 'She met Artoria Pendragon Lancer at the gate.';
assert.deepEqual(
    matchEntryKeys({ keys: ['Artoria Pendragon Lancer'], constant: false }, buf).matchedKeys,
    ['Artoria Pendragon Lancer'],
);
const rx = '/(?:artoria pendragon lancer|lion king)/i';
const m = matchEntryKeys({ keys: [rx], constant: false }, buf);
assert.equal(m.matchedKeys.length, 1);
assert.match(m.matchedKeys[0], /artoria pendragon lancer/i);
assert.ok(!m.matchedKeys[0].includes('(?:'));
assert.equal(parseWiRegexKey('/(/'), null);
assert.deepEqual(matchEntryKeys({ keys: ['/(/'], constant: false }, buf).matchedKeys, []);
assert.equal(matchEntryKeys({ keys: [], constant: true }, buf).matchKind, 'constant');
assert.equal(buildWiScanBuffer([{ mes: 'a' }, { mes: 'b' }, { mes: 'c' }], 2), 'b\nc');

const event = {
    world: 'Chaldea',
    entries: [
        { uid: 7, comment: 'Mash profile', keys: ['Mash', 'Kyriel'], content: 'x'.repeat(50) },
        { uid: 7, comment: 'Mash profile', keys: ['Mash', 'Kyriel'], content: 'duplicate' },
    ],
};
const normalized = normalizeWorldInfoEvent(event);
assert.equal(normalized.length, 1);
assert.equal(normalized[0].uid, '7');

_resetSceneSourceTraceForTests();
const owner = { chatKey: 'chat-a', targetMessageId: 3, swipeId: 0 };
startSceneSourceTrace(owner, { enabled: true });
for (let i = 0; i < 25; i++) {
    recordWorldInfoActivation({ world: 'Book', uid: i, key: 'k' + i, content: 'entry ' + i });
}
const trace = finishSceneSourceTrace(owner, { forceEmpty: true });
assert.equal(trace.v, 2);
assert.equal(trace.lorebook.count, 25);

const fat = {
    totalEvents: 1,
    entries: Array.from({ length: 800 }, (_, i) => ({
        world: 'W'.repeat(80),
        uid: String(i),
        title: 'T'.repeat(80),
        matchedKeys: ['M'.repeat(80), 'N'.repeat(80)],
        matchKind: 'keys',
    })),
};
assert.ok(trimLorebookForStorage(fat).omitted > 0);
assert.ok(JSON.stringify(trimLorebookForStorage(fat)).length <= MAX_LOREBOOK_JSON_BYTES);

_resetSceneSourceTraceForTests();
const owner0 = { chatKey: 'chat-b', targetMessageId: 5, swipeId: 0 };
const owner1 = { chatKey: 'chat-b', targetMessageId: 5, swipeId: 1 };
startSceneSourceTrace(owner0, { enabled: true });
recordWorldInfoActivation({ world: 'SwipeBook', uid: 42, key: 'hero', content: 'kept across rebind' });
assert.equal(rebindSceneSourceTraceOwner(owner1), true);
assert.equal(finishSceneSourceTrace(owner1, { forceEmpty: true }).lorebook.count, 1);

_resetSceneSourceTraceForTests();
const ownerC = { chatKey: 'chat-c', targetMessageId: 1, swipeId: 0 };
startSceneSourceTrace(ownerC, { enabled: true });
recordWorldInfoActivation({ world: 'Book', uid: 1, key: 'a', content: 'x' });
cancelSceneSourceTrace();
assert.equal(finishSceneSourceTrace(ownerC, { forceEmpty: true }).lorebook.count, 0);

_resetSceneSourceTraceForTests();
const ownerD = { chatKey: 'chat-d', targetMessageId: 2, swipeId: 0 };
startSceneSourceTrace(ownerD, { enabled: true });
recordWorldInfoActivation({ world: 'Book', uid: 9, key: 'hero', content: 'kept after defer' });
assert.equal(finishSceneSourceTrace(ownerD, { forceEmpty: true }).lorebook.entries[0].uid, '9');

_resetSceneSourceTraceForTests();
const ownerE0 = { chatKey: 'chat-e', targetMessageId: 3, swipeId: 0 };
const ownerE1 = { chatKey: 'chat-e', targetMessageId: 3, swipeId: 9 };
startSceneSourceTrace(ownerE0, { enabled: true });
recordWorldInfoActivation({ world: 'Book', uid: 3, key: 'k', content: 'lost on mismatch' });
assert.equal(finishSceneSourceTrace(ownerE1, { forceEmpty: true }).lorebook.count, 0);

assert.deepEqual(
    applyMatchedKeysToEntries(
        [{ world: 'fate_lorebook', uid: '1', title: 'Lancer-class Servant', keys: ['Artoria Pendragon Lancer'], constant: false }],
        buf,
    )[0].matchedKeys,
    ['Artoria Pendragon Lancer'],
);

assert.equal(formatLoreChipLabel({ settings: { sceneSourceTrace: false }, meta: {}, trace: null }), null);
assert.equal(formatLoreChipLabel({ settings: { sceneSourceTrace: true }, meta: { injectionMethod: 'separate' }, trace: null }), 'Lore —');
assert.equal(formatLoreChipLabel({ settings: { sceneSourceTrace: true }, meta: { injectionMethod: 'inline' }, trace: { lorebook: { count: 0, entries: [] } } }), 'Lore 0');
assert.equal(formatLoreChipLabel({ settings: { sceneSourceTrace: true }, meta: { injectionMethod: 'inline' }, trace: { lorebook: { count: 2, entries: [{}, {}] } } }), 'Lore 2');

const line = formatTraceEntryLine({
    world: 'fate_lorebook',
    title: 'Lancer-class Servant',
    matchedKeys: ['Artoria Pendragon', 'Артория Пендрагон Лансер'],
    matchKind: 'keys',
});
assert.equal(line, 'fate_lorebook — Lancer-class Servant — Artoria Pendragon — Артория Пендрагон Лансер');
assert.ok(!line.includes('(?:'));
assert.equal(buildTraceDrawerModel({
    settings: { sceneSourceTrace: true },
    meta: { injectionMethod: 'inline' },
    trace: { lorebook: { count: 1, entries: [{ world: 'A', title: 'B', matchedKeys: ['C'], matchKind: 'keys' }] } },
}).groups[0].items[0].line, 'A — B — C');

const bodyOff = el('div');
assert.equal(mountSceneSourceTrace(bodyOff, { settings: { sceneSourceTrace: false }, snapshot: {} }), null);
assert.equal(bodyOff.querySelector('.sp-gen-lore'), null);

const sampleRx = '/(?:artoria pendragon lancer|lion king)/i';
const bodyOn = el('div');
const footer = el('div');
footer.className = 'sp-gen-footer';
bodyOn.appendChild(footer);
const mounted = mountSceneSourceTrace(bodyOn, {
    settings: { sceneSourceTrace: true },
    snapshot: {
        _spMeta: {
            injectionMethod: 'inline',
            source: 'auto:together',
            sceneSourceTrace: {
                v: 2,
                capturedAt: '2026-07-25T00:00:00.000Z',
                lorebook: {
                    count: 1,
                    entries: [{
                        world: 'fate_lorebook',
                        uid: '9',
                        title: 'Lancer-class Servant',
                        matchedKeys: ['Artoria Pendragon'],
                        matchKind: 'keys',
                    }],
                },
            },
        },
    },
    footer,
});
assert.ok(mounted);
assert.equal(mounted.chip.textContent, 'Lore 1');
assert.ok(mounted.drawer.hidden);
// Drawer must sit immediately before footer (visible above margin-top:auto footer)
const kids = bodyOn.children;
const di = kids.indexOf(mounted.drawer);
const fi = kids.indexOf(footer);
assert.ok(di >= 0 && fi >= 0);
assert.equal(di, fi - 1);
mounted.chip.click();
assert.equal(mounted.drawer.hidden, false);
assert.match(mounted.drawer.innerHTML, /fate_lorebook/);
assert.match(mounted.drawer.innerHTML, /Artoria Pendragon/);
assert.ok(!mounted.drawer.innerHTML.includes(sampleRx));
assert.ok(!mounted.drawer.innerHTML.includes('(?:'));

console.log('scene-source-trace.test.mjs: all tests passed');
