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

const sst = await import('../src/scene-source-trace.js');
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
} = sst;
// v3 architecture export smoke (claim 4 regression)
assert.equal(typeof sst.recordWorldInfoScanDone, 'function');
assert.equal(typeof sst.recordWorldInfoEntriesLoaded, 'function');
assert.equal(typeof sst.explainWhyNot, 'function');
assert.equal(typeof sst.applyScanDecisions, 'function');
assert.equal(typeof sst.inferTriggersForEntry, 'function');
assert.equal(typeof sst.normalizeScanDepth, 'function');
const {
    formatLoreChipLabel,
    formatTraceEntryTitle,
    formatTraceEntryKeyLine,
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
assert.equal(buildWiScanBuffer([{ mes: 'SecretKey' }], 0), '');

{
    const { capturePreGenScanContext } = await import('../src/scene-source-trace/scan-context.js');
    const empty = capturePreGenScanContext([{ mes: 'SecretKey in chat' }], { depth: 0 });
    assert.equal(empty.depth, 0);
    assert.equal(empty.buffer, '');
    assert.deepEqual(empty.messages, []);
    assert.deepEqual(empty.messageIds, []);
}

{
    _resetSceneSourceTraceForTests();
    startSceneSourceTrace(
        { chatKey: 'c', targetMessageId: 1, swipeId: 0 },
        { enabled: true, chat: [{ mes: 'SecretKey in chat' }], depth: 0 },
    );
    recordWorldInfoActivation([{ world: 'W', uid: 1, comment: 'E', key: ['SecretKey'], content: 'x' }]);
    const d0 = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
    assert.deepEqual(d0.lorebook.entries[0].matchedKeys, []);
    assert.equal(d0.lorebook.entries[0].matchKind, 'none');
    assert.equal(d0.settings.scanDepth, 0);
}

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

const withContent = normalizeWorldInfoEvent({
    world: 'Chaldea',
    uid: 1,
    comment: 'Mash',
    keys: ['Mash'],
    content: 'x'.repeat(40),
});
assert.equal(withContent[0].tokens, 10); // 40/4

const finished = applyMatchedKeysToEntries(
    [{ world: 'W', uid: '1', title: 'T', keys: ['hero'], constant: false, tokens: 10 }],
    'hero appears',
)[0];
assert.equal(finished.tokens, 10);

_resetSceneSourceTraceForTests();
const owner = { chatKey: 'chat-a', targetMessageId: 3, swipeId: 0 };
startSceneSourceTrace(owner, { enabled: true });
for (let i = 0; i < 25; i++) {
    recordWorldInfoActivation({ world: 'Book', uid: i, key: 'k' + i, content: 'entry ' + i });
}
const trace = finishSceneSourceTrace(owner, { forceEmpty: true });
assert.equal(trace.v, 3);
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
assert.ok(new TextEncoder().encode(JSON.stringify(trimLorebookForStorage(fat))).byteLength <= MAX_LOREBOOK_JSON_BYTES);

// Causal inversion fix: key only in post-gen assistant reply must not match
{
    _resetSceneSourceTraceForTests();
    const chatBefore = [{ mes: 'hello there' }];
    startSceneSourceTrace(
        { chatKey: 'c', targetMessageId: 1, swipeId: 0 },
        { enabled: true, chat: chatBefore, depth: 10 },
    );
    recordWorldInfoActivation([{ world: 'W', uid: 1, comment: 'E', key: ['SecretKey'], content: 'x' }]);
    globalThis.SillyTavern.getContext = () => ({
        chat: [{ mes: 'hello there' }, { mes: 'SecretKey in assistant reply' }],
        power_user: { world_info_depth: 10 },
    });
    const causal = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
    assert.deepEqual(causal.lorebook.entries[0].matchedKeys, []);
    assert.equal(causal.lorebook.entries[0].matchKind, 'none');
}

// Regen: live chat rewritten at same messageId must not invent keys / override buffer match
{
    _resetSceneSourceTraceForTests();
    startSceneSourceTrace(
        { chatKey: 'c', targetMessageId: 1, swipeId: 1 },
        {
            enabled: true,
            chat: [
                { mes: 'user said hello' },
                { mes: 'old assistant without the key' },
            ],
            depth: 10,
        },
    );
    recordWorldInfoActivation([{ world: 'W', uid: 2, comment: 'E', key: ['SecretKey'], content: 'x' }]);
    globalThis.SillyTavern.getContext = () => ({
        chat: [
            { mes: 'user said hello' },
            { mes: 'SecretKey appears only after regen' },
        ],
        power_user: { world_info_depth: 10 },
    });
    const regen = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 1 });
    assert.deepEqual(regen.lorebook.entries[0].matchedKeys, []);
    assert.equal(regen.lorebook.entries[0].matchKind, 'none');
    assert.ok(!(regen.lorebook.entries[0].triggers || []).some(t => t.matchedText === 'SecretKey'));
}

// Artoria compound regex fixture
{
    const fixture = (await import('./fixtures/wi-artoria-regex.json', { with: { type: 'json' } })).default;
    const { matchedKeys } = matchEntryKeys({ keys: [fixture.key] }, 'She saw Арторией Пендрагон yesterday');
    assert.ok(matchedKeys.some(k => /пендрагон/i.test(k)));
}

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

assert.equal(
    formatTraceEntryTitle({ world: 'fate_lorebook', title: 'Lancer-class Servant', matchedKeys: ['Artoria Pendragon'], matchKind: 'keys' }),
    'Lancer-class Servant',
);
assert.equal(
    formatTraceEntryKeyLine({ matchedKeys: ['Artoria Pendragon', 'Артория Пендрагон Лансер'], matchKind: 'keys' }),
    'key - { Artoria Pendragon, Артория Пендрагон Лансер }',
);
assert.equal(formatTraceEntryKeyLine({ matchKind: 'constant', matchedKeys: [] }), 'key - { constant }');
assert.equal(formatTraceEntryKeyLine({ matchKind: 'none', matchedKeys: [] }), 'key - { — }');
// Never dump configured entry.keys when matchedKeys is empty
assert.equal(
    formatTraceEntryKeyLine({ matchKind: 'none', matchedKeys: [], keys: ['Alpha', 'Beta'] }),
    'key - { — }',
);
const line = formatTraceEntryLine({
    world: 'fate_lorebook',
    title: 'Lancer-class Servant',
    matchedKeys: ['Artoria Pendragon', 'Артория Пендрагон Лансер'],
    matchKind: 'keys',
});
assert.equal(line, 'Lancer-class Servant\nkey - { Artoria Pendragon, Артория Пендрагон Лансер }');
assert.ok(!line.includes('(?:'));
const modelKeys = buildTraceDrawerModel({
    settings: { sceneSourceTrace: true },
    meta: { injectionMethod: 'inline' },
    trace: { lorebook: { count: 1, entries: [{ world: 'A', title: 'B', matchedKeys: ['C'], matchKind: 'keys' }] } },
});
assert.equal(modelKeys.groups[0].items[0].title, 'B');
assert.match(modelKeys.groups[0].items[0].keyLine, /\{ C \}/);
assert.ok(modelKeys.groups[0].items[0].keyLine.includes('Inferred key') || modelKeys.groups[0].items[0].keyLine.startsWith('key'));
assert.ok(modelKeys.groups[0].items[0].tokens == null || modelKeys.groups[0].items[0].tokens === 0);
assert.deepEqual(modelKeys.groups[0].items[0].matchedKeys, ['C']);
assert.equal(modelKeys.groups[0].items[0].matchKind, 'keys');

const modelConst = buildTraceDrawerModel({
    settings: { sceneSourceTrace: true },
    meta: { injectionMethod: 'inline' },
    trace: {
        lorebook: {
            count: 1,
            entries: [{ world: 'A', title: 'Hub', matchedKeys: [], matchKind: 'constant', uid: '0' }],
        },
    },
});
assert.deepEqual(modelConst.groups[0].items[0].matchedKeys, []);
assert.equal(modelConst.groups[0].items[0].matchKind, 'constant');

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
                        tokens: 12,
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
assert.match(mounted.drawer.innerHTML, /sp-source-trace-entry-title/);
assert.match(mounted.drawer.innerHTML, /Lancer-class Servant/);
assert.match(mounted.drawer.innerHTML, /(?:key|Inferred key) - \{ Artoria Pendragon \}/);
assert.ok(!mounted.drawer.innerHTML.includes('fate_lorebook —'));
assert.match(mounted.drawer.innerHTML, /fate_lorebook/);
assert.match(mounted.drawer.innerHTML, /Artoria Pendragon/);
assert.match(mounted.drawer.innerHTML, /~12/);
assert.match(mounted.drawer.innerHTML, /Tokens/);
assert.match(mounted.drawer.innerHTML, /data-matched-keys="\[&quot;Artoria Pendragon&quot;\]"/);
assert.match(mounted.drawer.innerHTML, /data-match-kind="keys"/);
assert.ok(!mounted.drawer.innerHTML.includes(sampleRx));
assert.ok(!mounted.drawer.innerHTML.includes('(?:'));

const bodyConst = el('div');
const footerConst = el('div');
footerConst.className = 'sp-gen-footer';
bodyConst.appendChild(footerConst);
const mountedConst = mountSceneSourceTrace(bodyConst, {
    settings: { sceneSourceTrace: true },
    snapshot: {
        _spMeta: {
            injectionMethod: 'inline',
            sceneSourceTrace: {
                v: 2,
                capturedAt: '2026-07-25T00:00:00.000Z',
                lorebook: {
                    count: 1,
                    entries: [{
                        world: 'Book',
                        uid: '0',
                        title: 'Always on',
                        matchedKeys: [],
                        matchKind: 'constant',
                    }],
                },
            },
        },
    },
    footer: footerConst,
});
assert.ok(mountedConst);
assert.match(mountedConst.drawer.innerHTML, /data-matched-keys="\[\]"/);
assert.match(mountedConst.drawer.innerHTML, /data-match-kind="constant"/);

console.log('scene-source-trace.test.mjs: all tests passed');
