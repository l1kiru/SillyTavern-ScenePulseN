// Swipe browse must cancel mid-flight scene creation (not rebind as +1).
import assert from 'node:assert/strict';

const ctx = {
    name1: 'User', name2: 'Alice', groupId: null, characterId: 1, chatId: 'swipe-cancel',
    groups: [], characters: [],
    chat: [
        { is_user: true, mes: 'Hi' },
        { is_user: false, mes: 'A', swipe_id: 0, swipes: ['A', 'B', 'C'] },
    ],
    chatMetadata: { scenepulse: { snapshots: {} } },
    extensionSettings: { scenepulse: {} },
    saveMetadata() {}, saveSettingsDebounced() {},
};
globalThis.SillyTavern = { getContext: () => ctx };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.toastr = { error() {}, warning() {}, info() {}, success() {} };
globalThis.document = {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, contains() { return false; } }, setAttribute() {}, removeAttribute() {} }),
    body: { dataset: {}, appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {} } },
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
};
globalThis.window = { addEventListener() {}, innerWidth: 1280, innerHeight: 720 };

const state = await import('../src/state.js');
const ctrl = await import('../src/generation/scene-build-controller.js');
const { currentChatKey, currentChatFingerprint, captureOperationOwner } = await import('../src/message-fingerprint.js');
const {
    handleTogetherSwipeChange, discardTogetherSceneBuild, unlockAfterSwipeCancel,
} = await import('../src/generation/together-scene-build.js');
const { requestTracker } = await import('../src/generation/request.js');

ctrl._resetSceneBuildRegistryForTests();
state.setInlineGenerationContext(null);
state.setInlineGenStartMs(0);
state.setGenerating(false);
state.setGenerationTargetMesIdx(null);

const chatKey = currentChatKey();
const parentFp = currentChatFingerprint(0);

function makeCtx(overrides = {}) {
    const swipeId = overrides.swipeId ?? 0;
    const op = ctrl.startSceneBuild({
        messageId: 1,
        swipeId,
        source: 'auto:together',
        chatKey,
    });
    ctrl.updateSceneBuild(op.operationId, { status: 'generating' });
    return {
        mesIdx: 1,
        swipeId,
        generationType: 'normal',
        chatKey,
        parentFingerprint: parentFp,
        owner: captureOperationOwner(1, swipeId, { trackSource: false }),
        sceneBuildOperationId: op.operationId,
        ...overrides,
        sceneBuildOperationId: overrides.sceneBuildOperationId ?? op.operationId,
    };
}

console.log('\n── swipe cancels Together scene ──');

{
    const inline = makeCtx({ swipeId: 0, generationType: 'normal' });
    state.setInlineGenerationContext(inline);
    state.setInlineGenStartMs(Date.now());
    ctx.chat[1].swipe_id = 1;
    const result = handleTogetherSwipeChange(1, 1);
    assert.equal(result, 'aborted');
    assert.equal(ctrl.getSceneBuild(inline.sceneBuildOperationId)?.status, 'cancelled');
    assert.equal(state.inlineGenerationContext, null);
    assert.equal(state.inlineGenStartMs, 0);
}

ctrl._resetSceneBuildRegistryForTests();

{
    // Expected swipe-generation +1 rebinds instead of abort
    const op = ctrl.startSceneBuild({ messageId: 1, swipeId: 0, source: 'auto:together:swipe', chatKey });
    ctrl.updateSceneBuild(op.operationId, { status: 'generating' });
    const inline = {
        mesIdx: 1,
        swipeId: 0,
        generationType: 'swipe',
        chatKey,
        parentFingerprint: parentFp,
        owner: captureOperationOwner(1, 0, { trackSource: false }),
        sceneBuildOperationId: op.operationId,
    };
    state.setInlineGenerationContext(inline);
    state.setInlineGenStartMs(Date.now());
    ctx.chat[1].swipe_id = 1;
    ctx.chat[1].mes = 'B';
    const result = handleTogetherSwipeChange(1, 1);
    assert.equal(result, 'rebound');
    assert.equal(state.inlineGenerationContext?.swipeId, 1);
    assert.equal(ctrl.getSceneBuild(op.operationId)?.status, 'generating');
    assert.equal(ctrl.getSceneBuild(op.operationId)?.swipeId, 1);
}

ctrl._resetSceneBuildRegistryForTests();

{
    // Registry supersede for other swipe
    const s0 = ctrl.startSceneBuild({ messageId: 1, swipeId: 0, source: 'manual', chatKey });
    ctrl.updateSceneBuild(s0.operationId, { status: 'generating' });
    const n = ctrl.supersedeSceneBuildsForMessageExceptSwipe(1, 1, chatKey);
    assert.ok(n >= 1);
    assert.equal(ctrl.getSceneBuild(s0.operationId)?.status, 'superseded');
}

console.log('\n── scoped unlockAfterSwipeCancel ──');
{
    // Foreign swipe must NOT unlock bare generateTracker busy flag
    state.setGenerating(true);
    state.setGenerationTargetMesIdx(10);
    unlockAfterSwipeCancel({ messageId: 5, supersededCount: 0, togetherResult: 'noop' });
    assert.equal(state.generating, true);
    assert.equal(state.getGenerationTargetMesIdx(), 10);

    // Same-message swipe unlocks bare gen
    unlockAfterSwipeCancel({ messageId: 10, supersededCount: 0, togetherResult: 'noop' });
    assert.equal(state.generating, false);
    assert.equal(state.getGenerationTargetMesIdx(), null);
}

ctrl._resetSceneBuildRegistryForTests();

{
    // Supersede on that message unlocks when no active builds left
    state.setGenerating(true);
    state.setGenerationTargetMesIdx(1);
    const op = ctrl.startSceneBuild({ messageId: 1, swipeId: 0, source: 'manual', chatKey });
    ctrl.updateSceneBuild(op.operationId, { status: 'generating' });
    const n = ctrl.supersedeSceneBuildsForMessageExceptSwipe(1, 1, chatKey);
    assert.ok(n >= 1);
    unlockAfterSwipeCancel({ messageId: 1, supersededCount: n, togetherResult: 'noop' });
    assert.equal(state.generating, false);
    assert.equal(state.getGenerationTargetMesIdx(), null);
}

console.log('\n── abort rejects requestTracker promptly ──');
{
    const ac = new AbortController();
    let settled = false;
    const p = requestTracker({
        stContext: {
            async generateQuietPrompt() {
                await new Promise(r => setTimeout(r, 5000));
                return '{}';
            },
        },
        systemPrompt: '',
        prompt: 'x',
        responseLength: 100,
        signal: ac.signal,
        stopStOnAbort: false,
    }).then(
        () => { settled = 'resolved'; },
        (e) => { settled = e?.name || 'rejected'; },
    );
    ac.abort();
    await p;
    assert.equal(settled, 'AbortError');
}

ctrl._resetSceneBuildRegistryForTests();
state.setInlineGenerationContext(null);
state.setInlineGenStartMs(0);
state.setGenerating(false);
state.setGenerationTargetMesIdx(null);
console.log('swipe-cancel-scene-build.test.mjs: ok');
