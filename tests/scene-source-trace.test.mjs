import assert from 'node:assert/strict';

globalThis.document = {
    createElement(tag) {
        return {
            tagName: tag.toUpperCase(),
            className: '',
            innerHTML: '',
            children: [],
            attributes: {},
            setAttribute(name, value) { this.attributes[name] = value; },
            appendChild(child) { this.children.push(child); return child; },
        };
    },
    body: { dataset: {}, classList: { add() {}, remove() {} }, addEventListener() {} },
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
};
globalThis.window = { addEventListener() {}, innerWidth: 1280, innerHeight: 720 };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.SillyTavern = { getContext: () => ({ extensionSettings: { scenepulse: {} }, chatMetadata: {} }) };

const {
    normalizeWorldInfoEvent,
    startSceneSourceTrace,
    recordWorldInfoActivation,
    finishSceneSourceTrace,
    rebindSceneSourceTraceOwner,
    cancelSceneSourceTrace,
    _resetSceneSourceTraceForTests,
} = await import('../src/scene-source-trace.js');
const { _renderSceneSourceTrace } = await import('../src/ui/update-panel.js');

const event = {
    world: 'Chaldea',
    entries: [
        { uid: 7, comment: 'Mash profile', keys: ['Mash', 'Kyrie'], content: 'A'.repeat(500) },
        { uid: 7, comment: 'Mash profile', keys: ['Mash', 'Kyrie'], content: 'duplicate' },
    ],
};

const normalized = normalizeWorldInfoEvent(event);
assert.equal(normalized.length, 1);
assert.equal(normalized[0].world, 'Chaldea');
assert.equal(normalized[0].uid, '7');
assert.deepEqual(normalized[0].keys, ['Mash', 'Kyrie']);
assert.ok(normalized[0].excerpt.length <= 300);

_resetSceneSourceTraceForTests();
const owner = { chatKey: 'chat-a', targetMessageId: 3, swipeId: 0 };
startSceneSourceTrace(owner, { enabled: true });
for (let i = 0; i < 25; i++) {
    recordWorldInfoActivation({ world: 'Book', uid: i, key: `k${i}`, content: `entry ${i}` });
}
const trace = finishSceneSourceTrace(owner, { forceEmpty: true });
assert.equal(trace.v, 1);
assert.equal(trace.mode, 'inline');
assert.equal(trace.lorebook.count, 20);
assert.equal(trace.lorebook.entries.at(-1).uid, '19');

_resetSceneSourceTraceForTests();
const owner0 = { chatKey: 'chat-b', targetMessageId: 5, swipeId: 0 };
const owner1 = { chatKey: 'chat-b', targetMessageId: 5, swipeId: 1 };
startSceneSourceTrace(owner0, { enabled: true });
recordWorldInfoActivation({ world: 'SwipeBook', uid: 42, key: 'hero', content: 'kept across rebind' });
assert.equal(rebindSceneSourceTraceOwner(owner1), true);
const rebound = finishSceneSourceTrace(owner1, { forceEmpty: true });
assert.equal(rebound.lorebook.count, 1);
assert.equal(rebound.lorebook.entries[0].uid, '42');
assert.equal(rebound.lorebook.entries[0].world, 'SwipeBook');

const disabled = _renderSceneSourceTrace({ _spMeta: {} }, { sceneSourceTrace: false });
assert.equal(disabled.className, 'sp-source-trace');
assert.match(disabled.children[0].innerHTML, /disabled/);
const unavailable = _renderSceneSourceTrace({ _spMeta: { injectionMethod: 'separate', source: 'auto:separate' } }, { sceneSourceTrace: true });
assert.equal(unavailable.className, 'sp-source-trace');
assert.match(unavailable.children[0].innerHTML, /Together mode/);
const visible = _renderSceneSourceTrace({ _spMeta: { injectionMethod: 'inline', source: 'auto:together', sceneSourceTrace: trace } }, { sceneSourceTrace: true });
assert.match(visible.innerHTML, /Scene Source Trace/);
assert.equal(visible.children[0].children[0].children.length, 1);

// cancel then finish(forceEmpty) must not resurrect entries
_resetSceneSourceTraceForTests();
const ownerC = { chatKey: 'chat-c', targetMessageId: 1, swipeId: 0 };
startSceneSourceTrace(ownerC, { enabled: true });
recordWorldInfoActivation({ world: 'Book', uid: 1, key: 'a', content: 'x' });
cancelSceneSourceTrace();
const afterCancel = finishSceneSourceTrace(ownerC, { forceEmpty: true });
assert.equal(afterCancel.lorebook.count, 0);

// defer simulation: NO cancel — finish preserves entries
_resetSceneSourceTraceForTests();
const ownerD = { chatKey: 'chat-d', targetMessageId: 2, swipeId: 0 };
startSceneSourceTrace(ownerD, { enabled: true });
recordWorldInfoActivation({ world: 'Book', uid: 9, key: 'hero', content: 'kept after defer' });
const deferred = finishSceneSourceTrace(ownerD, { forceEmpty: true });
assert.equal(deferred.lorebook.count, 1);
assert.equal(deferred.lorebook.entries[0].uid, '9');

// owner mismatch without rebind + forceEmpty → empty provenance
_resetSceneSourceTraceForTests();
const ownerE0 = { chatKey: 'chat-e', targetMessageId: 3, swipeId: 0 };
const ownerE1 = { chatKey: 'chat-e', targetMessageId: 3, swipeId: 9 };
startSceneSourceTrace(ownerE0, { enabled: true });
recordWorldInfoActivation({ world: 'Book', uid: 3, key: 'k', content: 'lost on mismatch' });
const mismatched = finishSceneSourceTrace(ownerE1, { forceEmpty: true });
assert.equal(mismatched.lorebook.count, 0);

console.log('scene-source-trace.test.mjs: all tests passed');