// Regression coverage for message edits and ancestor swipe changes.

const ctx = {
    name1: 'User', name2: 'Alice', groupId: null, characterId: 1, chatId: 'chat-a',
    groups: [], characters: [],
    chat: [
        { is_user: true, mes: 'Choose a door' },
        { is_user: false, mes: 'The red door opens', swipe_id: 0, swipes: ['The red door opens', 'The blue door opens'] },
        { is_user: true, mes: 'Enter' },
        { is_user: false, mes: 'Alice enters the hall', swipe_id: 0, swipes: ['Alice enters the hall'] },
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
    saveSnapshot, getSnapshotStatus, getLatestSnapshot, getPrevSnapshot, hasStaleSnapshotBefore,
} = await import('../src/settings.js');
const { currentChatFingerprint, currentChatKey } = await import('../src/message-fingerprint.js');
const { processExtraction } = await import('../src/generation/pipeline.js');

let pass = 0, fail = 0;
function eq(name, actual, expected) {
    if (actual === expected) { pass++; console.log('  OK   ' + name); }
    else { fail++; console.log('  FAIL ' + name + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual)); }
}

console.log('\n── Snapshot provenance ──');

saveSnapshot(1, { sceneSummary: 'Door', charactersPresent: ['Alice'] }, 0);
saveSnapshot(3, { sceneSummary: 'Hall', charactersPresent: ['Alice'] }, 0);
eq('fresh snapshot is current', getSnapshotStatus(3, 0), 'current');
eq('fresh latest snapshot is readable', getLatestSnapshot()?.sceneSummary, 'Hall');

ctx.chat[3].mes = 'Alice enters the cellar';
ctx.chat[3].swipes[0] = ctx.chat[3].mes;
eq('same-swipe text edit makes snapshot stale', getSnapshotStatus(3, 0), 'stale');
eq('stale latest snapshot is hidden', getLatestSnapshot(), null);
eq('trusted previous snapshot remains available', getPrevSnapshot(3)?.sceneSummary, 'Door');

ctx.chat[3].mes = 'Alice enters the hall';
ctx.chat[3].swipes[0] = ctx.chat[3].mes;
eq('undoing edit restores exact snapshot', getSnapshotStatus(3, 0), 'current');

ctx.chat[1].swipe_id = 1;
ctx.chat[1].mes = ctx.chat[1].swipes[1];
eq('ancestor swipe invalidates descendant snapshot', getSnapshotStatus(3, 0), 'stale');
eq('stale dependency gap is detected for next turn',hasStaleSnapshotBefore(4),true);
eq('inactive swipe keeps its own valid snapshot', getSnapshotStatus(1, 0), 'current');
ctx.chat[1].swipe_id = 0;
ctx.chat[1].mes = ctx.chat[1].swipes[0];
eq('returning to branch restores descendant', getSnapshotStatus(3, 0), 'current');

const expectedSourceFingerprint = currentChatFingerprint(3, 0);
ctx.chat[3].mes = 'Edited during generation';
ctx.chat[3].swipes[0] = ctx.chat[3].mes;
const rejected = await processExtraction(3, { sceneSummary: 'Wrong branch' }, 'test', {
    swipeId: 0,
    expectedSwipeId: 0,
    expectedChatKey: currentChatKey(),
    expectedSourceFingerprint,
    baseSnapshot: null,
});
eq('result for edited source is rejected', rejected, null);

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass}/${pass + fail}`);
if (fail) process.exit(1);
