// Expected swipe rebind: Together freezes swipe_id at inject; ST advances
// after new sibling finishes. Rebind must not fire on backward browse or
// real parent/chat branch changes.

const ctx = {
    name1: 'User', name2: 'Alice', groupId: null, characterId: 1, chatId: 'chat-rebind',
    groups: [], characters: [],
    chat: [
        { is_user: true, mes: 'Hello' },
        { is_user: false, mes: 'First', swipe_id: 1, swipes: ['First', 'Second', 'Third'] },
    ],
    chatMetadata: { scenepulse: { snapshots: {} } },
    extensionSettings: { scenepulse: {} },
    saveMetadata() {}, saveSettingsDebounced() {},
};
globalThis.SillyTavern = { getContext: () => ctx };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.toastr = { error() {}, warning() {}, info() {}, success() {} };
globalThis.document = {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} }, children: [], innerHTML: '', appendChild() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getAttribute() { return null; }, setAttribute() {}, remove() {}, removeAttribute() {} }),
    body: { dataset: {}, appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {} } },
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    // Pre-seed thought panel so updatePanel skips real DOM wiring in headless tests.
    getElementById: (id) => (id === 'sp-thought-panel'
        ? { style: {}, classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} }
        : null),
};
globalThis.window = { addEventListener() {}, innerWidth: 1280, innerHeight: 720 };

const { rebindInlineCtxForExpectedSwipe } = await import('../src/generation/inline-ctx.js');
const { currentChatKey, currentChatFingerprint, captureOperationOwner } = await import('../src/message-fingerprint.js');
const state = await import('../src/state.js');
const { getSnapshotFor, clearAllSnapshots, saveSnapshot } = await import('../src/settings.js');
const {
    buildPromptInjectionPlan,
    _resetPromptInjectionModuleForTests,
    serializePromptInjectionMeta,
} = await import('../src/generation/prompt-injection.js');
const { processExtraction } = await import('../src/generation/pipeline.js');

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

console.log('\n── swipe inline rebind ──');

const parentFp = currentChatFingerprint(0);
const chatKey = currentChatKey();

function baseCtx(overrides = {}) {
    return {
        mesIdx: 1,
        swipeId: 1,
        generationType: 'swipe',
        chatKey,
        parentFingerprint: parentFp,
        baseSnapshot: null,
        owner: captureOperationOwner(1, 1),
        ...overrides,
    };
}

// 1) Frozen 1 → active 2 with type swipe → rebind
ctx.chat[1].swipe_id = 2;
ctx.chat[1].mes = ctx.chat[1].swipes[2];
{
    const next = rebindInlineCtxForExpectedSwipe(baseCtx(), 1);
    eq('swipe type rebinds frozen+1 to active', next?.swipeId, 2);
    eq('state stores rebound swipe', state.inlineGenerationContext?.swipeId, 2);
    assertTrue('owner retargeted to active swipe', next?.owner?.swipeId === 2);
    eq('rebind owner skips source fingerprint', next?.owner?.sourceFingerprint, '');
    assertTrue('guard would pass after rebind', next.mesIdx === 1 && next.swipeId === 2);
}

// 2) Active goes backward → no rebind
ctx.chat[1].swipe_id = 0;
ctx.chat[1].mes = ctx.chat[1].swipes[0];
{
    const frozen = baseCtx({ swipeId: 1, owner: captureOperationOwner(1, 1) });
    state.setInlineGenerationContext(frozen);
    const next = rebindInlineCtxForExpectedSwipe(frozen, 1);
    eq('backward swipe does not rebind', next?.swipeId, 1);
    eq('state unchanged on backward', state.inlineGenerationContext?.swipeId, 1);
}

// 3) parentFingerprint mismatch → no rebind
ctx.chat[1].swipe_id = 2;
ctx.chat[1].mes = ctx.chat[1].swipes[2];
{
    const next = rebindInlineCtxForExpectedSwipe(baseCtx({
        swipeId: 1,
        parentFingerprint: 'not-the-parent',
        owner: captureOperationOwner(1, 1),
    }), 1);
    eq('parent mismatch does not rebind', next?.swipeId, 1);
}

// 4) +1 advance without generationType=swipe must NOT rebind (browse-away)
ctx.chat[1].swipe_id = 2;
{
    const next = rebindInlineCtxForExpectedSwipe(baseCtx({
        swipeId: 1,
        generationType: 'normal',
        owner: captureOperationOwner(1, 1),
    }), 1);
    eq('normal +1 browse does not rebind', next?.swipeId, 1);
}

// 5) After rebind, snapshot write targets active swipe 2 (pipeline uses same swipeId)
clearAllSnapshots();
ctx.chat[1].swipe_id = 2;
ctx.chat[1].mes = ctx.chat[1].swipes[2];
const rebound = rebindInlineCtxForExpectedSwipe(baseCtx({ swipeId: 1, owner: captureOperationOwner(1, 1) }), 1);
eq('rebound swipeId is the save target', rebound?.swipeId, 2);
saveSnapshot(1, { sceneSummary: 'Rebound swipe scene', charactersPresent: ['Alice'] }, rebound.swipeId);
eq('writes under rebound swipe 2', getSnapshotFor(1, 2)?.sceneSummary, 'Rebound swipe scene');
eq('swipe 1 remains empty', getSnapshotFor(1, 1), null);

// 6) Rebind also retargets PromptInjectionPlan + runtime metrics so SP Context meta saves
clearAllSnapshots();
_resetPromptInjectionModuleForTests();
ctx.chat[1].swipe_id = 2;
ctx.chat[1].mes = ctx.chat[1].swipes[2];
{
    const plan = buildPromptInjectionPlan({
        text: 'tracker prompt',
        role: 'system',
        owner: { chatKey, messageId: 1, swipeId: 1 },
    });
    plan.status = 'verified';
    plan.verification.main = 'verified';
    plan.verification.tail = 'verified';
    plan.verification.finalHook = 'GENERATE_AFTER_DATA';
    plan.verifiedTokens = {
        mainInput: 120,
        instructionsInput: 80,
        previousStateInput: 20,
        tailInput: 8,
        totalInput: 128,
        estimateSource: 'heuristic',
    };
    plan.main.tokens = 120;
    plan.tail.tokens = 8;
    state.setLastPromptInjectionMetrics({
        chatKey,
        messageId: 1,
        swipeId: 1,
        tokens: plan.verifiedTokens,
        integrity: { main: 'verified', tail: 'verified', hook: 'GENERATE_AFTER_DATA' },
        registeredRole: 'system',
        effectiveRole: 'system',
        apiKind: 'text',
    });

    const reboundMeta = rebindInlineCtxForExpectedSwipe(
        baseCtx({ swipeId: 1, owner: captureOperationOwner(1, 1, { trackSource: false }) }),
        1,
    );
    eq('PI plan swipe rebound to 2', state.getActivePromptInjectionRun()?.owner?.swipeId, 2);
    eq('PI metrics swipe rebound to 2', state.getLastPromptInjectionMetrics()?.swipeId, 2);
    assertTrue(
        'rebound plan still serializes verified meta',
        !!serializePromptInjectionMeta(state.getActivePromptInjectionRun(), 'verified')?.tokens?.totalInput,
    );

    const saved = await processExtraction(
        1,
        { sceneSummary: 'SP Context kept', charactersPresent: ['Alice'] },
        'auto:together:swipe',
        {
            swipeId: 2,
            expectedSwipeId: 2,
            owner: reboundMeta.owner,
            baseSnapshot: null,
            frozenDeltaMode: false,
            frozenRequestSchema: {
                type: 'object',
                properties: {
                    sceneSummary: { type: 'string' },
                    charactersPresent: { type: 'array', items: { type: 'string' } },
                },
                required: ['sceneSummary'],
            },
            stopHider: false,
            unlockGen: false,
        },
    );
    assertTrue('pipeline saved rebound swipe', !!saved);
    eq(
        'saved snapshot keeps SP Context tokens',
        getSnapshotFor(1, 2)?._spMeta?.promptInjection?.tokens?.totalInput,
        128,
    );
}
_resetPromptInjectionModuleForTests();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
