// Together processTogetherExtraction: fail op + rethrow on pipeline throw

globalThis.SillyTavern = {
    getContext: () => ({
        chat: [{ is_user: true, mes: 'hi' }, { is_user: false, mes: 'hello', swipe_id: 0 }],
        groupId: null, characterId: 1, chatId: 'together-catch',
        chatMetadata: { scenepulse: { snapshots: {} } },
        extensionSettings: { scenepulse: {} },
        saveMetadata() {}, saveSettingsDebounced() {},
    }),
};
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.toastr = { error() {}, warning() {}, info() {}, success() {} };
globalThis.document = {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, contains() { return false; } } }),
    body: { dataset: {}, appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {} } },
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
};
globalThis.window = { addEventListener() {}, innerWidth: 1280, innerHeight: 720 };

const ctrl = await import('../src/generation/scene-build-controller.js');
const together = await import('../src/generation/together-scene-build.js');
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

console.log('\n── Together extraction catch ──');
ctrl._resetSceneBuildRegistryForTests();

const op = ctrl.startSceneBuild({
    messageId: 1, swipeId: 0, source: 'auto:together', chatKey: currentChatKey(),
});
together._setTogetherProcessExtractionForTests(async () => {
    throw new Error('pipeline boom');
});

let rejected = false;
try {
    await together.processTogetherExtraction(1, { sceneSummary: 'x' }, 'auto:together', {
        sceneBuildOperationId: op.operationId,
        swipeId: 0,
        chatKey: currentChatKey(),
    });
} catch (e) {
    rejected = e?.message === 'pipeline boom';
}

assertTrue('Together exception rejects Promise', rejected);
eq('Together exception fails op', ctrl.getSceneBuild(op.operationId)?.status, 'error');

together._setTogetherProcessExtractionForTests(null);
ctrl._resetSceneBuildRegistryForTests();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
