import assert from 'node:assert/strict';

const validTracker = {
    time:'10:00:00',date:'07/21/2026 (Tuesday)',elapsed:'1m (conversation)',location:'Hall > Manor',weather:'Clear',temperature:'22°C — mild',
    sceneTopic:'A changed answer',sceneMood:'Watchful',sceneInteraction:'Conversation',sceneTension:'low',
    sceneSummary:'Second swipe scene',soundEnvironment:'Quiet room',charactersPresent:['Alice'],witnesses:[],
    northStar:'Learn the truth',mainQuests:[],sideQuests:[],relationships:[],
    characters:[{name:'Alice',aliases:[],archetype:'friend',role:'Companion',innerThought:'This answer feels different.',immediateNeed:'Listen',shortTermGoal:'Answer',longTermGoal:'Help',hair:'Dark',face:'Calm',outfit:'Travel clothes',posture:'Standing',proximity:'Nearby',notableDetails:'',inventory:[],fertStatus:'N/A',fertNotes:''}],
    plotBranches:['dramatic','intense','comedic','twist','exploratory'].map(type=>({type,name:type,hook:'A specific next step.'})),
};

const ctx = {
    name1:'User',name2:'Alice',characterId:1,chatId:'strip-root',
    chat:[{is_user:true,mes:'Continue'},{is_user:false,mes:'Alice answers',swipe_id:0},{is_user:true,mes:'Continue'},{is_user:false,mes:'Alice waits',swipe_id:0}],
    chatMetadata:{scenepulse:{snapshots:{}}},extensionSettings:{scenepulse:{showThoughts:false}},
    saveMetadata(){},saveSettingsDebounced(){},saveChat:async()=>{},
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


const {processExtraction} = await import('../src/generation/pipeline.js');
const {getSnapshotFor,getActiveSchema} = await import('../src/settings.js');
const {buildRequestSchema} = await import('../src/schema.js');
const {debugLog} = await import('../src/logger.js');
for (const [mesIdx,mode] of [[1,'full'],[3,'delta']]) {
    const schema=buildRequestSchema(getActiveSchema(),{mode});
    schema.value.properties.customSignal={type:'string'};
    const extracted={...structuredClone(validTracker),sceneTopicChanged:true,soundEnvironmentChanged:false,customSignal:'declared',_spProbe:1};
    assert.ok(await processExtraction(mesIdx,extracted,'auto:together',{
        frozenDeltaMode:mode==='delta',frozenRequestSchema:schema,
    }));
    const snap=getSnapshotFor(mesIdx);
    assert.ok(snap,'snapshot saved');
    assert.ok(!Object.hasOwn(snap,'sceneTopicChanged'),'unknown root field dropped');
    assert.ok(!Object.hasOwn(snap,'soundEnvironmentChanged'));
    assert.equal(snap.customSignal,'declared','schema-declared custom fields survive');
    assert.equal(snap._spProbe,1,'service root fields survive');
    assert.equal(snap.characters[0].name,validTracker.characters[0].name,'nested data untouched');
    assert.equal(snap.characters[0].innerThought,validTracker.characters[0].innerThought);
    assert.ok(snap._validationWarnings.some(warning=>warning.includes('sceneTopicChanged')),'validation warnings remain available');
}
assert.ok(debugLog.some(line=>line.includes('Pipeline: dropped fields outside request schema:')&&line.includes('sceneTopicChanged')));
console.log('pipeline-strip-unknown-root: passed');
