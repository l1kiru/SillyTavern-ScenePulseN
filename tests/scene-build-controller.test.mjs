// SceneBuildController unit tests

globalThis.SillyTavern = {
    getContext: () => ({
        chat: [{ is_user: true, mes: 'hi' }, { is_user: false, mes: 'hello', swipe_id: 0 }],
        groupId: null, characterId: 1, chatId: 'sb-test',
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
const { currentChatKey } = await import('../src/message-fingerprint.js');

let pass = 0, fail = 0;
function eq(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { pass++; console.log('  OK   ' + name); }
    else { fail++; console.log('  FAIL ' + name + ' — expected ' + e + ', got ' + a); }
}
function assertTrue(name, v) {
    if (v) { pass++; console.log('  OK   ' + name); }
    else { fail++; console.log('  FAIL ' + name); }
}

let fakeNow = 1_000_000;
ctrl._setSceneBuildNow(() => fakeNow);
ctrl._setSceneBuildStGenerating(() => false);
ctrl._resetSceneBuildRegistryForTests();

console.log('\n── SceneBuildController ──');

const chatKey = currentChatKey();
const op1 = ctrl.startSceneBuild({ messageId: 1, swipeId: 0, source: 'manual:test', chatKey });
eq('starts pending', op1.status, 'pending');
assertTrue('active after start', ctrl.isOperationCurrent(op1.operationId));

ctrl.updateSceneBuild(op1.operationId, { status: 'generating' });
ctrl.updateSceneBuild(op1.operationId, { status: 'parsing' });
ctrl.updateSceneBuild(op1.operationId, { status: 'saving' });
ctrl.settleSceneBuild(op1.operationId, 'ready');
eq('settles ready', ctrl.getSceneBuild(op1.operationId)?.status, 'ready');
assertTrue('not current after ready', !ctrl.isOperationCurrent(op1.operationId));

const a = ctrl.startSceneBuild({ messageId: 1, swipeId: 0, source: 'manual:a', chatKey });
const aId = a.operationId;
const b = ctrl.startSceneBuild({ messageId: 1, swipeId: 0, source: 'manual:b', chatKey });
eq('first superseded', ctrl.getSceneBuild(aId)?.status, 'superseded');
assertTrue('first not current', !ctrl.isOperationCurrent(aId));
assertTrue('second current', ctrl.isOperationCurrent(b.operationId));

ctrl.cancelSceneBuild(b.operationId, 'user');
eq('cancelled', ctrl.getSceneBuild(b.operationId)?.status, 'cancelled');
assertTrue('cancelled not current', !ctrl.isOperationCurrent(b.operationId));

const s0 = ctrl.startSceneBuild({ messageId: 1, swipeId: 0, source: 'together', chatKey });
const s1 = ctrl.startSceneBuild({ messageId: 1, swipeId: 1, source: 'together', chatKey });
ctrl.supersedeSceneBuildsForMessageExceptSwipe(1, 1, chatKey);
eq('other swipe superseded', ctrl.getSceneBuild(s0.operationId)?.status, 'superseded');
assertTrue('kept swipe still active', ctrl.isOperationCurrent(s1.operationId));

const c1 = ctrl.startSceneBuild({ messageId: 1, swipeId: 0, source: 'manual', chatKey: 'chat-old' });
ctrl.cancelSceneBuildsForChat('chat-old', 'chat-changed');
eq('chat cancel', ctrl.getSceneBuild(c1.operationId)?.status, 'cancelled');

ctrl._resetSceneBuildRegistryForTests();
fakeNow = 1_000_000;
const soft = ctrl.startSceneBuild({ messageId: 1, swipeId: 0, source: 'manual', chatKey });
fakeNow += ctrl.SCENE_BUILD_SOFT_MS + 1;
ctrl.tickSceneBuildWatchdog();
assertTrue('soft notified', !!ctrl.getSceneBuild(soft.operationId)?.softNotified);

fakeNow += ctrl.SCENE_BUILD_EXPIRED_MS;
ctrl.updateSceneBuild(soft.operationId, { requestInFlight: false, status: 'generating' });
// bump updatedAt only via soft path already; force stale updatedAt
const softOp = ctrl.getSceneBuild(soft.operationId);
softOp.updatedAt = fakeNow - ctrl.SCENE_BUILD_EXPIRED_MS - 1;
ctrl.tickSceneBuildWatchdog();
eq('expired when idle long enough', ctrl.getSceneBuild(soft.operationId)?.status, 'expired');

ctrl._resetSceneBuildRegistryForTests();
fakeNow = 2_000_000;
const busy = ctrl.startSceneBuild({ messageId: 1, swipeId: 0, source: 'manual', chatKey });
ctrl.updateSceneBuild(busy.operationId, { status: 'generating', requestInFlight: true });
fakeNow += ctrl.SCENE_BUILD_EXPIRED_MS + 5;
busy.updatedAt = fakeNow - ctrl.SCENE_BUILD_EXPIRED_MS - 1;
ctrl.tickSceneBuildWatchdog();
eq('no expire while request in flight', ctrl.getSceneBuild(busy.operationId)?.status, 'generating');

ctrl._resetSceneBuildRegistryForTests();
const tog = ctrl.startSceneBuild({ messageId: 1, swipeId: 0, source: 'auto:together', chatKey });
const man = ctrl.startSceneBuild({ messageId: 2, swipeId: 0, source: 'manual:message', chatKey });
ctrl.cancelTogetherSceneBuilds('reply-stopped');
eq('together cancelled on stop', ctrl.getSceneBuild(tog.operationId)?.status, 'cancelled');
eq('manual survives ST stop', ctrl.getSceneBuild(man.operationId)?.status, 'pending');

ctrl.disposeSceneBuilds();
eq('dispose clears registry', ctrl.getAllSceneBuilds().length, 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
