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

assert.equal(_renderSceneSourceTrace({ _spMeta: {} }, { sceneSourceTrace: false }), null);
const unavailable = _renderSceneSourceTrace({ _spMeta: { injectionMethod: 'separate', source: 'auto:separate' } }, { sceneSourceTrace: true });
assert.equal(unavailable.className, 'sp-source-trace');
assert.match(unavailable.children[0].innerHTML, /Together mode/);
const visible = _renderSceneSourceTrace({ _spMeta: { injectionMethod: 'inline', source: 'auto:together', sceneSourceTrace: trace } }, { sceneSourceTrace: true });
assert.match(visible.innerHTML, /Scene Source Trace/);
assert.equal(visible.children[0].children[0].children.length, 1);

console.log('scene-source-trace.test.mjs: all tests passed');
