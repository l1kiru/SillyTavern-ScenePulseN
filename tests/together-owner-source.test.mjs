// Together/inline must not track target-message source fingerprint:
// extract strips the tracker block and would otherwise trip SOURCE_CHANGED.

const ctx = {
    name1: 'User', name2: 'Alice', groupId: null, characterId: 1, chatId: 'chat-owner-src',
    groups: [], characters: [],
    chat: [
        { is_user: true, mes: 'Hello' },
        {
            is_user: false,
            mes: 'Narrative\n\n<<<SP_TRACKER>>>\n{"sceneSummary":"x"}\n<<<SP_END>>>',
            swipe_id: 1,
            swipes: ['First', 'Narrative\n\n<<<SP_TRACKER>>>\n{"sceneSummary":"x"}\n<<<SP_END>>>'],
        },
    ],
    chatMetadata: { scenepulse: { snapshots: {} } },
    extensionSettings: { scenepulse: {} },
    saveMetadata() {}, saveSettingsDebounced() {},
};
globalThis.SillyTavern = { getContext: () => ctx };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.toastr = { error() {}, warning() {}, info() {}, success() {} };
globalThis.document = {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, contains() { return false; } } }),
    body: { dataset: {}, appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {} } },
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
};
globalThis.window = { addEventListener() {}, innerWidth: 1280, innerHeight: 720 };

const {
    captureOperationOwner, validateOperationOwner, currentChatKey,
} = await import('../src/message-fingerprint.js');

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

console.log('\n── Together owner source fingerprint ──');

const togetherOwner = captureOperationOwner(1, 1, { trackSource: false });
eq('trackSource false leaves source empty', togetherOwner.sourceFingerprint, '');
assertTrue('parent still captured', !!togetherOwner.parentFingerprint);
eq('chatKey present', togetherOwner.chatKey, currentChatKey());

ctx.chat[1].mes = 'Narrative';
ctx.chat[1].swipes[1] = 'Narrative';
eq('strip does not SOURCE_CHANGED', validateOperationOwner(togetherOwner).code, 'CURRENT');
assertTrue('strip still valid', validateOperationOwner(togetherOwner).valid);

const tracked = captureOperationOwner(1, 1);
assertTrue('default tracks source', !!tracked.sourceFingerprint);
ctx.chat[1].mes = 'Narrative edited';
ctx.chat[1].swipes[1] = 'Narrative edited';
eq('default tracks text change', validateOperationOwner(tracked).code, 'SOURCE_CHANGED');

const badParent = { ...togetherOwner, parentFingerprint: 'not-parent' };
eq('parent still guarded', validateOperationOwner(badParent).code, 'PARENT_CHANGED');

const badChat = { ...togetherOwner, chatKey: 'other-chat' };
eq('chat still guarded', validateOperationOwner(badChat).code, 'CHAT_CHANGED');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
