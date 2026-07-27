// Short/empty Together reply aborts scene-build immediately (no wait / fallback).

globalThis.SillyTavern = {
    getContext: () => ({
        chat: [{ is_user: true, mes: 'hi' }, { is_user: false, mes: '', swipe_id: 0 }],
        groupId: null, characterId: 1, chatId: 'short-reply',
        chatMetadata: { scenepulse: { snapshots: {} } },
        extensionSettings: { scenepulse: {} },
        saveMetadata() {}, saveSettingsDebounced() {},
    }),
};
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
const {
    isShortTogetherReply, abortShortTogetherReply, TOGETHER_SHORT_REPLY_CHARS,
} = await import('../src/generation/together-scene-build.js');
const { currentChatKey } = await import('../src/message-fingerprint.js');

let pass = 0, fail = 0;
function assertTrue(name, v) {
    if (v) { pass++; console.log('  OK   ' + name); }
    else { fail++; console.log('  FAIL ' + name); }
}
function eq(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { pass++; console.log('  OK   ' + name); }
    else { fail++; console.log('  FAIL ' + name + ' — expected ' + e + ', got ' + a); }
}

console.log('\n── short/empty Together reply abort ──');

assertTrue('empty is short', isShortTogetherReply(''));
assertTrue('99 chars is short', isShortTogetherReply('x'.repeat(TOGETHER_SHORT_REPLY_CHARS - 1)));
assertTrue('100 chars not short', !isShortTogetherReply('x'.repeat(TOGETHER_SHORT_REPLY_CHARS)));

ctrl._resetSceneBuildRegistryForTests();
state.setCancelRequested(false);
state.setInlineGenStartMs(Date.now());
state.setInlineExtractionDone(false);
state.setPendingInlineIdx(1);

const op = ctrl.startSceneBuild({
    messageId: 1, swipeId: 0, source: 'auto:together', chatKey: currentChatKey(),
});
ctrl.updateSceneBuild(op.operationId, { status: 'generating' });
state.setInlineGenerationContext({
    mesIdx: 1, swipeId: 0, sceneBuildOperationId: op.operationId, chatKey: currentChatKey(),
});

abortShortTogetherReply(state.inlineGenerationContext, 'empty-reply');

eq('scene-build cancelled', ctrl.getSceneBuild(op.operationId)?.status, 'cancelled');
eq('cancel reason', ctrl.getSceneBuild(op.operationId)?.cancellationReason, 'empty-reply');
assertTrue('blocks auto recovery', state.shouldSkipAutoSceneRecovery());
eq('inline start cleared', state.inlineGenStartMs, 0);
assertTrue('inline ctx cleared', state.inlineGenerationContext == null);
eq('pending cleared', state.pendingInlineIdx, -1);

ctrl._resetSceneBuildRegistryForTests();
state.setCancelRequested(false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
