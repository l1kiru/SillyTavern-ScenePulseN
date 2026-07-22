// A malformed provider response on a new swipe must not break the retry.

let providerCalls = 0;
let worldInfoCalls = 0;
const validTracker={
    time:'10:00:00',date:'07/21/2026 (Tuesday)',elapsed:'1m (conversation)',location:'Hall > Manor',weather:'Clear',temperature:'22°C — mild',
    sceneTopic:'A changed answer',sceneMood:'Watchful',sceneInteraction:'Conversation',sceneTension:'low',
    sceneSummary:'Second swipe scene',soundEnvironment:'Quiet room',charactersPresent:['Alice'],witnesses:[],
    northStar:'Learn the truth',mainQuests:[],sideQuests:[],relationships:[],
    characters:[{name:'Alice',aliases:[],archetype:'friend',role:'Companion',innerThought:'This answer feels different.',immediateNeed:'Listen',shortTermGoal:'Answer',longTermGoal:'Help',hair:'Dark',face:'Calm',outfit:'Travel clothes',posture:'Standing',proximity:'Nearby',notableDetails:'',inventory:[],fertStatus:'N/A',fertNotes:''}],
    plotBranches:['dramatic','intense','comedic','twist','exploratory'].map(type=>({type,name:type,hook:'A specific next step.'})),
};

const ctx = {
    name1: 'User', name2: 'Alice', characterId: 1, chatId: 'parse-failure',
    groupId: null, selected_group: null, groups: [], characters: [],
    chat: [
        { is_user: true, mes: 'Try another answer' },
        { is_user: false, mes: 'Second answer', swipe_id: 1, swipes: ['First answer', 'Second answer'] },
    ],
    chatMetadata: { scenepulse: { snapshots: {}, swipeSnapshots: {} } },
    extensionSettings: { scenepulse: {
        enabled: true, autoGenerate: true, maxRetries: 1,
        injectionMethod: 'separate', deltaMode: false, fallbackEnabled: false,
        showThoughts: false,
    } },
    generateRawData: async () => ++providerCalls === 1
        ? 'plain prose without JSON'
        : JSON.stringify(validTracker),
    getWorldInfoPrompt: async () => { worldInfoCalls++; throw new Error('ScenePulse must not scan World Info'); },
    saveMetadata() {}, saveSettingsDebounced() {},
};

globalThis.SillyTavern = { getContext: () => ctx };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.toastr = { error() {}, warning() {}, info() {}, success() {} };
globalThis.getComputedStyle = () => ({ display: 'none', visibility: 'hidden' });
const hiddenThoughtElement = {
    innerHTML: '', style: {}, classList: { add() {}, remove() {}, contains() { return false; } },
    querySelector: () => null,
};
globalThis.document = {
    createElement: () => ({
        style: {}, dataset: {}, classList: { add() {}, remove() {}, contains() { return false; } },
        appendChild() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    }),
    body: { dataset: {}, appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {} } },
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    getElementById: id => ['sp-thought-panel', 'sp-tp-body'].includes(id) ? hiddenThoughtElement : null,
};
globalThis.window = { addEventListener() {}, innerWidth: 1280, innerHeight: 720 };

const { generateTracker, cancelGeneration } = await import('../src/generation/engine.js');
const { getLastExtractionFailure } = await import('../src/state.js');
const { getSnapshotFor } = await import('../src/settings.js');

let pass = 0, fail = 0;
function eq(name, actual, expected) {
    if (actual === expected) { pass++; console.log('  OK   ' + name); }
    else { fail++; console.log('  FAIL ' + name + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual)); }
}

console.log('\n── Engine parse-failure ownership ──');
const result = await generateTracker(1);
const failure = getLastExtractionFailure();
eq('malformed first response reaches retry', providerCalls, 2);
eq('tracker generation does not scan World Info', worldInfoCalls, 0);
eq('retry creates the new swipe scene', result?.sceneSummary, 'Second swipe scene');
eq('successful retry clears the error', failure, null);
eq('new thought belongs to active swipe', getSnapshotFor(1, 1)?.characters?.[0]?.innerThought, 'This answer feels different.');
eq('first swipe does not borrow the new thought', getSnapshotFor(1, 0), null);

ctx.chat.push(
    {is_user:true,mes:'Try native mode'},
    {is_user:false,mes:'Native answer',swipe_id:0,swipes:['Native answer']},
);
ctx.extensionSettings.scenepulse.promptMode='native';
const schemaAttempts=[];
ctx.generateRawData=async args=>{
    schemaAttempts.push(!!args.jsonSchema);
    return schemaAttempts.length===1?'{}':JSON.stringify({...validTracker,sceneSummary:'Native fallback scene'});
};
const nativeFallback=await generateTracker(3);
eq('native empty object is retried',schemaAttempts.length,2);
eq('native retry falls back to JSON-only mode',JSON.stringify(schemaAttempts),JSON.stringify([true,false]));
eq('JSON-only fallback is persisted',nativeFallback?.sceneSummary,'Native fallback scene');

ctx.chat.push(
    {is_user:true,mes:'Cancel the retry'},
    {is_user:false,mes:'Answer before cancellation',swipe_id:0,swipes:['Answer before cancellation']},
);
ctx.extensionSettings.scenepulse.promptMode='json';
ctx.extensionSettings.scenepulse.maxRetries=2;
providerCalls=0;
ctx.generateRawData=async()=>{providerCalls++;return 'plain prose without JSON'};
const cancelledGeneration=generateTracker(5);
setTimeout(cancelGeneration,50);
const cancelledResult=await cancelledGeneration;
eq('manual cancellation during retry backoff prevents another API call',providerCalls,1);
eq('manual cancellation returns no tracker',cancelledResult,null);

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
