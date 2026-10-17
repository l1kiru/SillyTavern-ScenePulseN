import assert from 'node:assert/strict';

const validTracker = {
    time:'10:00:00',date:'07/21/2026 (Tuesday)',elapsed:'1m (conversation)',location:'Hall > Manor',weather:'Clear',temperature:'22°C — mild',
    sceneTopic:'A changed answer',sceneMood:'Watchful',sceneInteraction:'Conversation',sceneTension:'low',
    sceneSummary:'Second swipe scene',soundEnvironment:'Quiet room',charactersPresent:['Alice'],witnesses:[],
    northStar:'Learn the truth',mainQuests:[],sideQuests:[],relationships:[],
    characters:[{name:'Alice',aliases:[],archetype:'friend',role:'Companion',innerThought:'This answer feels different.',immediateNeed:'Listen',shortTermGoal:'Answer',longTermGoal:'Help',hair:'Dark',face:'Calm',outfit:'Travel clothes',posture:'Standing',proximity:'Nearby',notableDetails:'',inventory:[],fertStatus:'N/A',fertNotes:''}],
    plotBranches:['dramatic','intense','comedic','twist','exploratory'].map(type=>({type,name:type,hook:'A specific next step.'})),
};

let requests = 0;
const ctx = {
    characterId: 1, chatId: 'cancel-recovery', name1: 'User', name2: 'Mira',
    chat: [{ is_user: true, mes: 'Continue' }, { is_user: false, mes: 'Narrative. '.repeat(70), swipe_id: 0 }],
    chatMetadata: { scenepulse: { snapshots: {} } },
    extensionSettings: { scenepulse: { enabled: true, injectionMethod: 'inline', autoGenerate: true,
        fallbackEnabled: true, maxRetries: 0, showThoughts: false } },
    saveMetadata() {}, saveSettingsDebounced() {}, saveChat: async () => {},
    generateRawData: async () => { requests++; return JSON.stringify(validTracker); },
};
globalThis.SillyTavern = { getContext: () => ctx };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.toastr = { error() {}, warning() {}, info() {}, success() {} };
const element = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false },
    querySelector: () => null, querySelectorAll: () => [], getAttribute: () => '1', setAttribute() {}, removeAttribute() {},
    appendChild() {}, insertBefore() {}, addEventListener() {} });
const hiddenThoughtElement = {...element(),innerHTML:''};
globalThis.document = { createElement: element, body: element(), addEventListener() {},
    querySelector: selector => selector.startsWith('.mes[mesid=') ? element() : null,
    querySelectorAll: () => [], getElementById: id => ['sp-thought-panel','sp-tp-body'].includes(id) ? hiddenThoughtElement : null };
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


const together = await import('../src/generation/together-scene-build.js');
const {debugLog} = await import('../src/logger.js');
const {buildRequestSchema} = await import('../src/schema.js');
const {getActiveSchema,forceFullStateRefresh,clearForceFullState,getSnapshotFor} = await import('../src/settings.js');
let forwarded;
function beginFrozen(frozenDeltaMode = false) {
    const op = begin();
    const mode = frozenDeltaMode ? 'delta' : 'full';
    state.setInlineGenerationContext({...state.inlineGenerationContext,
        baseSnapshot:null,frozenDeltaMode,frozenRequestSchema:buildRequestSchema(getActiveSchema(),{mode})});
    return op;
}

try {
    together._setTogetherProcessExtractionForTests(async (_idx,_data,_source,opts) => {forwarded=opts;return null;});
    requests=0; debugLog.length=0; beginFrozen(); await onCharMsg(1);
    assert.equal(requests,2,'rejected continuation must fall through to Tier 2');
    assert.ok(debugLog.some(line=>line.includes('pipeline rejected tracker, escalating to full separate generation')));
    assert.ok(!debugLog.some(line=>line.includes('Together continuation: succeeded')),'rejected tracker is not logged as saved');
    assert.ok(getSnapshotFor(1),'Tier 2 saves the recovered scene');

    together._setTogetherProcessExtractionForTests(async (_idx,_data,_source,opts) => {forwarded=opts;return {ok:true};});
    requests=0; beginFrozen(); await onCharMsg(1);
    assert.equal(requests,1,'accepted continuation must skip Tier 2');
    assert.equal(forwarded.frozenDeltaMode,false);
    assert.deepEqual(forwarded.frozenRequestSchema,buildRequestSchema(getActiveSchema(),{mode:'full'}));

    // A lost delta base switches continuation AND the pipeline contract to full.
    requests=0; beginFrozen(true); await onCharMsg(1);
    assert.equal(requests,1);
    assert.equal(forwarded.frozenDeltaMode,false,'pipeline receives the actual full mode');
    assert.deepEqual(forwarded.frozenRequestSchema,buildRequestSchema(getActiveSchema(),{mode:'full'}));

    // Test real saving with full forced at injection and a delta-eligible base.
    together._setTogetherProcessExtractionForTests(null);
    ctx.chat.push({is_user:true,mes:'Continue'},{is_user:false,mes:'Narrative. '.repeat(70),swipe_id:0});
    const base=getSnapshotFor(1);
    base._spMeta.deltaTurnsSinceFull=2;
    requests=0; debugLog.length=0; beginFrozen();
    const operation=ctrl.startSceneBuild({messageId:3,swipeId:0,source:'auto:together',chatKey:currentChatKey()});
    state.setInlineGenerationContext({...state.inlineGenerationContext,mesIdx:3,baseSnapshot:base,sceneBuildOperationId:operation.operationId});
    clearForceFullState();
    await onCharMsg(3);
    assert.equal(requests,1,'frozen full continuation saves without a separate request');
    assert.ok(getSnapshotFor(3),'full continuation creates a real snapshot');
    assert.equal(getSnapshotFor(3)._spMeta.deltaTurnsSinceFull,0,'saved scene is full');

    // Cancelling while saving a rejected continuation must still block Tier 2.
    await new Promise(resolve=>setTimeout(resolve,160)); // Exercise UI updates outside their debounce window.
    requests=0;
    const cancelled=beginFrozen();
    together._setTogetherProcessExtractionForTests(async () => {
        ctrl.cancelSceneBuild(cancelled.operationId,'user');
        return null;
    });
    await onCharMsg(1);
    assert.equal(requests,1,'cancel during rejected Tier 1 must not launch Tier 2');
} finally {
    together._setTogetherProcessExtractionForTests(null);
    clearForceFullState();
    ctrl._resetSceneBuildRegistryForTests();
}
console.log('together-continuation-false-success: passed');
