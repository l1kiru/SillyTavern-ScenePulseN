// Regression coverage for per-swipe tracker ownership and stale writes.

const ctx = {
    name1: 'User', name2: 'Alice', groupId: null, selected_group: null,
    groups: [], characters: [],
    chat: [
        { is_user: true, mes: 'Hello' },
        { is_user: false, mes: 'First answer', swipe_id: 0, swipes: ['First answer', 'Second answer'] },
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
    getTrackerData, getLatestSnapshot, getSnapshotEntryForMessage, getSnapshotFor, getPrevSnapshot,
    saveSnapshot, reconcileSnapshotsAfterChatMutation, clearAllSnapshots,
} = await import('../src/settings.js');

let pass = 0, fail = 0;
function eq(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { pass++; console.log('  OK   ' + name); }
    else { fail++; console.log('  FAIL ' + name + ' — expected ' + e + ', got ' + a); }
}

console.log('\n── Swipe-aware snapshots ──');

const first = { sceneSummary: 'First', charactersPresent: ['Alice'], characters: [{ name: 'Alice', innerThought: 'first thought' }] };
saveSnapshot(1, first, 0);
eq('active first swipe is visible', getLatestSnapshot()?.sceneSummary, 'First');

ctx.chat[1].swipe_id = 1;
ctx.chat[1].mes = ctx.chat[1].swipes[1];
eq('unprocessed sibling has no borrowed state', getSnapshotFor(1), null);
eq('unprocessed latest swipe does not borrow an older scene',getLatestSnapshot(),null);
eq('selected message entry still points at the active swipe',getSnapshotEntryForMessage(1)?.swipeId,1);
eq('selected message entry is explicitly missing',getSnapshotEntryForMessage(1)?.status,'missing');

const second = { sceneSummary: 'Second', charactersPresent: ['Bob'], characters: [{ name: 'Bob', innerThought: 'second thought' }] };
saveSnapshot(1, second, 1);
eq('second swipe owns its snapshot', getLatestSnapshot()?.sceneSummary, 'Second');
eq('selected message entry resolves the second swipe',getSnapshotEntryForMessage(1)?.snapshot?.sceneSummary,'Second');

// Editing the active object must not mutate its sibling.
getLatestSnapshot().characters[0].innerThought = 'edited second thought';
ctx.chat[1].swipe_id = 0;
eq('manual edit stays on active swipe', getSnapshotFor(1)?.characters[0].innerThought, 'first thought');
ctx.chat[1].swipe_id = 1;
eq('edited value restored with its swipe', getSnapshotFor(1)?.characters[0].innerThought, 'edited second thought');

const next = { sceneSummary: 'Next', charactersPresent: [] };
ctx.chat.push(
    { is_user: true, mes: 'Continue' },
    { is_user: false, mes: 'Next answer', swipe_id: 0, swipes: ['Next answer'] },
);
saveSnapshot(3, next, 0);
eq('generation base follows selected prior swipe', getPrevSnapshot(3)?.sceneSummary, 'Second');
ctx.chat[1].swipe_id = 0;
ctx.chat[1].mes = ctx.chat[1].swipes[0];
eq('generation base changes with prior swipe selection', getPrevSnapshot(3)?.sceneSummary, 'First');

// SillyTavern emits the NEW chat length after deleting the final message.
// The reconciler must derive the affected snapshot from the actual chat.
ctx.chat.length = 3;
reconcileSnapshotsAfterChatMutation({ type: 'message-delete' });
eq('last-message deletion removes out-of-range bucket', getTrackerData().swipeSnapshots['3'], undefined);
eq('last-message deletion restores previous scene', getLatestSnapshot()?.sceneSummary, 'First');

clearAllSnapshots();
eq('clear removes swipe buckets', Object.keys(getTrackerData().swipeSnapshots), []);
eq('clear removes active mirrors', Object.keys(getTrackerData().snapshots), []);

// Legacy data is assigned only to the currently selected sibling.
ctx.chat[1].swipe_id = 1;
ctx.chatMetadata.scenepulse = { snapshots: { 1: { sceneSummary: 'Legacy' } } };
getTrackerData();
eq('legacy snapshot migrates to selected swipe', getSnapshotFor(1, 1)?.sceneSummary, 'Legacy');
eq('legacy snapshot is not cloned to siblings', getSnapshotFor(1, 0), null);

// A delayed extraction for swipe 0 must be rejected after the user switches.
const { processExtraction } = await import('../src/generation/pipeline.js');
const before = JSON.stringify(getTrackerData().swipeSnapshots);
const stale = await processExtraction(1, { sceneSummary: 'STALE' }, 'test', {
    swipeId: 0, expectedSwipeId: 0, baseSnapshot: null,
});
eq('stale async result is rejected', stale, null);
eq('stale async result writes nothing', JSON.stringify(getTrackerData().swipeSnapshots), before);

function user(mes) { return { is_user: true, mes }; }
function assistant(mes, swipes = [mes], swipe_id = 0) { return { is_user: false, mes, swipes, swipe_id }; }
function resetChat(chat) {
    ctx.chat = chat;
    ctx.chatMetadata.scenepulse = { snapshots: {} };
    getTrackerData();
}
function snapshot(sceneSummary) { return { sceneSummary, charactersPresent: [] }; }

console.log('\n── Message deletion reconciliation ──');
resetChat([
    user('Start'), assistant('Scene A'), user('Choice A'), assistant('Scene B'),
    user('Choice B'), assistant('Scene C'),
]);
saveSnapshot(1, snapshot('A'));
saveSnapshot(3, snapshot('B'));
saveSnapshot(5, snapshot('C'));

// deleteMessage(2) splices one message, but MESSAGE_DELETED reports 5 (the
// new length), not 2. Descendant snapshots must be discarded, not shifted.
ctx.chat.splice(2, 1);
reconcileSnapshotsAfterChatMutation({ type: 'message-delete' });
eq('middle deletion preserves scene before changed context', getLatestSnapshot()?.sceneSummary, 'A');
eq('middle deletion drops first dependent snapshot', getTrackerData().swipeSnapshots['3'], undefined);
eq('middle deletion drops later dependent snapshot', getTrackerData().swipeSnapshots['5'], undefined);

resetChat([
    user('Start'), assistant('Scene A'), user('Choice A'), assistant('Scene B'),
    user('Choice B'), assistant('Scene C'),
]);
saveSnapshot(1, snapshot('A'));
saveSnapshot(3, snapshot('B'));
saveSnapshot(5, snapshot('C'));
ctx.chat.length = 4;
reconcileSnapshotsAfterChatMutation({ type: 'message-delete' });
eq('tail deletion keeps latest surviving scene', getLatestSnapshot()?.sceneSummary, 'B');
eq('tail deletion removes deleted tail snapshots', getTrackerData().swipeSnapshots['5'], undefined);

ctx.chat.push(user('No tracker yet'), assistant('Unprocessed answer'));
eq('general latest lookup may retain the previous trusted scene', getLatestSnapshot()?.sceneSummary, 'B');
eq('targeted latest message lookup never borrows that scene',getSnapshotEntryForMessage(5)?.snapshot,null);

console.log('\n── Swipe deletion reconciliation ──');
function seedSwipeChat(activeSwipe) {
    const swipes = ['Answer A', 'Answer B', 'Answer C'];
    resetChat([
        user('Start'), assistant(swipes[activeSwipe], [...swipes], activeSwipe),
        user('Continue'), assistant('Descendant scene'),
    ]);
    saveSnapshot(1, snapshot('Swipe A'), 0);
    saveSnapshot(1, snapshot('Swipe B'), 1);
    saveSnapshot(1, snapshot('Swipe C'), 2);
    saveSnapshot(3, snapshot('Descendant'));
}

seedSwipeChat(1);
ctx.chat[1].swipes.splice(1, 1);
ctx.chat[1].swipe_id = 1;
ctx.chat[1].mes = 'Answer C';
reconcileSnapshotsAfterChatMutation({ type: 'swipe-delete', messageId: 1, swipeId: 1, activeChanged: true });
eq('deleting active swipe selects processed sibling snapshot', getSnapshotFor(1, 1)?.sceneSummary, 'Swipe C');
eq('deleting active swipe invalidates descendants', getTrackerData().swipeSnapshots['3'], undefined);
eq('active swipe deletion falls back to selected sibling scene', getLatestSnapshot()?.sceneSummary, 'Swipe C');

seedSwipeChat(2);
ctx.chat[1].swipes.splice(0, 1);
ctx.chat[1].swipe_id = 1;
ctx.chat[1].mes = 'Answer C';
reconcileSnapshotsAfterChatMutation({ type: 'swipe-delete', messageId: 1, swipeId: 0, activeChanged: false });
eq('inactive swipe deletion remaps current sibling snapshot', getSnapshotFor(1, 1)?.sceneSummary, 'Swipe C');
eq('inactive swipe deletion preserves valid descendants', getLatestSnapshot()?.sceneSummary, 'Descendant');

seedSwipeChat(0);
ctx.chat[1].swipes.splice(2, 1);
ctx.chat[1].swipe_id = 0;
ctx.chat[1].mes = 'Answer A';
reconcileSnapshotsAfterChatMutation({ type: 'swipe-delete', messageId: 1, swipeId: 2, activeChanged: false });
eq('deleting later inactive swipe keeps current snapshot', getSnapshotFor(1, 0)?.sceneSummary, 'Swipe A');
eq('deleting later inactive swipe keeps descendants', getLatestSnapshot()?.sceneSummary, 'Descendant');

console.log('\n── Repeated deletion reconciliation ──');
resetChat([
    user('Start'), assistant('Scene A'), user('Choice A'), assistant('Scene B'),
    user('Choice B'), assistant('Scene C'),
]);
saveSnapshot(1, snapshot('A'));
saveSnapshot(3, snapshot('B'));
saveSnapshot(5, snapshot('C'));
ctx.chat.length = 5;
reconcileSnapshotsAfterChatMutation({ type: 'message-delete' });
ctx.chat.length = 3;
reconcileSnapshotsAfterChatMutation({ type: 'message-delete' });
eq('two sequential deletions settle on oldest surviving scene', getLatestSnapshot()?.sceneSummary, 'A');
eq('two sequential deletions leave no orphan descendants', Object.keys(getTrackerData().swipeSnapshots), ['1']);

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass}/${pass + fail}`);
if (fail) process.exit(1);
