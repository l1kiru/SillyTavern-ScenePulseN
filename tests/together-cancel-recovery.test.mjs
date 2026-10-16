import assert from 'node:assert/strict';

let requests = 0;
const ctx = {
    characterId: 1, chatId: 'cancel-recovery', name1: 'User', name2: 'Mira',
    chat: [{ is_user: true, mes: 'Continue' }, { is_user: false, mes: 'Narrative. '.repeat(300), swipe_id: 0 }],
    chatMetadata: { scenepulse: { snapshots: {} } },
    extensionSettings: { scenepulse: { enabled: true, injectionMethod: 'inline', autoGenerate: true,
        fallbackEnabled: true, maxRetries: 0, showThoughts: false } },
    saveMetadata() {}, saveSettingsDebounced() {}, saveChat: async () => {},
    generateRawData: async () => { requests++; return '{}'; },
};
globalThis.SillyTavern = { getContext: () => ctx };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.toastr = { error() {}, warning() {}, info() {}, success() {} };
const element = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false },
    querySelector: () => null, querySelectorAll: () => [], getAttribute: () => '1', setAttribute() {}, removeAttribute() {},
    appendChild() {}, addEventListener() {} });
globalThis.document = { createElement: element, body: element(), addEventListener() {},
    querySelector: selector => selector.startsWith('.mes[mesid=') ? element() : null,
    querySelectorAll: () => [], getElementById: () => null };
globalThis.window = { addEventListener() {}, innerWidth: 1280, innerHeight: 720 };
globalThis.getComputedStyle = () => ({ display: 'none', visibility: 'hidden' });

const state = await import('../src/state.js');
const ctrl = await import('../src/generation/scene-build-controller.js');
const { currentChatKey } = await import('../src/message-fingerprint.js');
const { onCharMsg } = await import('../src/ui/message.js');
function begin() {
    state.setCancelRequested(false);
    state.setGenerating(false);
    state.setInlineExtractionDone(false);
    state.setInlineGenStartMs(Date.now());
    const op = ctrl.startSceneBuild({ messageId: 1, swipeId: 0, source: 'auto:together', chatKey: currentChatKey() });
    state.setInlineGenerationContext({ mesIdx: 1, swipeId: 0, chatKey: currentChatKey(), sceneBuildOperationId: op.operationId });
    return op;
}

// Stop only the ScenePulse operation, as the native loader does. The main reply
// can still finish; its rendered event must not launch a new provider request.
const cancelled = begin();
ctrl.cancelSceneBuild(cancelled.operationId, 'user');
await onCharMsg(1);
assert.equal(requests, 0, 'cancelled Together must not start fallback');
assert.deepEqual(ctx.chatMetadata.scenepulse.snapshots, {});

// Removing a terminal UI stub must not lose the cancellation decision.
const pruned = begin();
ctrl.cancelSceneBuild(pruned.operationId, 'user');
ctrl.dismissSceneBuild(pruned.operationId);
await onCharMsg(1);
assert.equal(requests, 0, 'dismissed cancelled operation must not recover');

// Stop during Tier 1 must abort that request and prevent Tier 2, even though
// continuation cleanup resets the legacy global cancellation flag.
ctx.chat[1].mes = 'Narrative. '.repeat(70);
let entered;
const dispatched = new Promise(resolve => { entered = resolve; });
ctx.generateRawData = async () => { requests++; entered(); return new Promise(() => {}); };
const continuation = begin();
const pending = onCharMsg(1);
await dispatched;
const failureBefore = state.getLastExtractionFailure();
ctrl.cancelSceneBuild(continuation.operationId, 'user');
await Promise.race([pending, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('continuation did not abort')), 1000);
    timer.unref();
})]);
assert.equal(requests, 1, 'cancelled continuation must not start full fallback');
assert.equal(state.getLastExtractionFailure(), failureBefore);
assert.equal(state.generating, false);

// Cancellation belongs to the old turn, not a subsequent generation.
ctx.chat[1].mes = 'Narrative. '.repeat(300);
ctx.generateRawData = async () => { requests++; return '{}'; };
begin();
await onCharMsg(1);
assert.equal(requests, 2, 'new active Together turn can still recover');
ctrl._resetSceneBuildRegistryForTests();
console.log('together-cancel-recovery: passed');
