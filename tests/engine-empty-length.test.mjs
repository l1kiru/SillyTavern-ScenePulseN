import assert from 'node:assert/strict';

const validTracker = {
    time:'10:00:00',date:'07/21/2026 (Tuesday)',elapsed:'1m (conversation)',location:'Hall > Manor',weather:'Clear',temperature:'22°C — mild',
    sceneTopic:'A changed answer',sceneMood:'Watchful',sceneInteraction:'Conversation',sceneTension:'low',
    sceneSummary:'Second swipe scene',soundEnvironment:'Quiet room',charactersPresent:['Alice'],witnesses:[],
    northStar:'Learn the truth',mainQuests:[],sideQuests:[],relationships:[],
    characters:[{name:'Alice',aliases:[],archetype:'friend',role:'Companion',innerThought:'This answer feels different.',immediateNeed:'Listen',shortTermGoal:'Answer',longTermGoal:'Help',hair:'Dark',face:'Calm',outfit:'Travel clothes',posture:'Standing',proximity:'Nearby',notableDetails:'',inventory:[],fertStatus:'N/A',fertNotes:''}],
    plotBranches:['dramatic','intense','comedic','twist','exploratory'].map(type=>({type,name:type,hook:'A specific next step.'})),
};

const lengths = [];
const ctx = {
    name1:'User',name2:'Alice',characterId:1,chatId:'empty-length',
    chat:[{is_user:true,mes:'Continue'},{is_user:false,mes:'Previous scene',swipe_id:0},{is_user:true,mes:'Continue'},{is_user:false,mes:'Narrative. '.repeat(70),swipe_id:0}],
    chatMetadata:{scenepulse:{snapshots:{'1':{...structuredClone(validTracker),_spMeta:{deltaTurnsSinceFull:2}}}}},
    extensionSettings:{scenepulse:{enabled:true,injectionMethod:'separate',deltaMode:true,deltaRefreshInterval:15,maxRetries:1,fallbackEnabled:false,showThoughts:false}},
    generateRawData:async args=>{
        lengths.push(args.responseLength);
        return lengths.length===1 ? {choices:[{message:{content:''},finish_reason:'length'}]} : JSON.stringify(validTracker);
    },
    saveMetadata(){},saveSettingsDebounced(){},saveChat:async()=>{},
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


const {generateTracker,continuationReprompt} = await import('../src/generation/engine.js');
const {getLastExtractionFailure} = await import('../src/state.js');

assert.ok(await generateTracker(3),'retry returns a valid tracker');
assert.equal(lengths.length,2);
assert.ok(lengths[1]>lengths[0],`budget must grow after empty length (${lengths})`);

ctx.extensionSettings.scenepulse.maxRetries=0;
ctx.extensionSettings.scenepulse.deltaMode=false;
for (const finishReason of ['length','max_tokens','max_output_tokens','token_limit','stop']) {
    const expected=finishReason==='stop'?'NO_JSON_OBJECT':'TRUNCATED';
    ctx.generateRawData=async ()=>({choices:[{message:{content:''},finish_reason:finishReason}]});
    assert.equal(await generateTracker(3),null);
    assert.equal(getLastExtractionFailure()?.code,expected,'Separate empty '+finishReason);
    if (expected==='TRUNCATED') assert.equal(getLastExtractionFailure()?.message,'Provider stopped at its output token limit before producing content');
    assert.equal(await continuationReprompt(ctx.chat[3].mes,{mesIdx:3,baseSnapshot:null,stopStOnAbort:false}),null);
    assert.equal(getLastExtractionFailure()?.code,expected,'continuation empty '+finishReason);
    if (expected==='TRUNCATED') assert.equal(getLastExtractionFailure()?.message,'Provider stopped at its output token limit before producing content');
}
console.log('engine-empty-length: passed');
