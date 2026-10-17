import assert from 'node:assert/strict';

const validTracker = {
    time:'10:00:00',date:'07/21/2026 (Tuesday)',elapsed:'1m (conversation)',location:'Hall > Manor',weather:'Clear',temperature:'22°C — mild',
    sceneTopic:'A changed answer',sceneMood:'Watchful',sceneInteraction:'Conversation',sceneTension:'low',
    sceneSummary:'Second swipe scene',soundEnvironment:'Quiet room',charactersPresent:['Alice'],witnesses:[],
    northStar:'Learn the truth',mainQuests:[],sideQuests:[],relationships:[],
    characters:[{name:'Alice',aliases:[],archetype:'friend',role:'Companion',innerThought:'This answer feels different.',immediateNeed:'Listen',shortTermGoal:'Answer',longTermGoal:'Help',hair:'Dark',face:'Calm',outfit:'Travel clothes',posture:'Standing',proximity:'Nearby',notableDetails:'',inventory:[],fertStatus:'N/A',fertNotes:''}],
    plotBranches:['dramatic','intense','comedic','twist','exploratory'].map(type=>({type,name:type,hook:'A specific next step.'})),
};
const calls = [];
const ctx = {
    name1:'User',name2:'Alice',characterId:1,chatId:'frozen-continuation',
    chat:[{is_user:true,mes:'Continue'},{is_user:false,mes:'Previous answer',swipe_id:0},{is_user:false,mes:'Narrative. '.repeat(70),swipe_id:0}],
    chatMetadata:{scenepulse:{snapshots:{'1':{...structuredClone(validTracker),_spMeta:{deltaTurnsSinceFull:2}}}}},
    extensionSettings:{scenepulse:{enabled:true,injectionMethod:'inline',deltaMode:true,deltaRefreshInterval:15,showThoughts:false}},
    generateRawData:async args=>{calls.push(args);return JSON.stringify(validTracker);},
    saveMetadata(){},saveSettingsDebounced(){},saveChat:async()=>{},
};
globalThis.SillyTavern = {getContext:()=>ctx};
globalThis.localStorage = {getItem:()=>null,setItem(){}};
globalThis.toastr = {error(){},warning(){},info(){},success(){}};
globalThis.document = {
    createElement:()=>({style:{},dataset:{},classList:{add(){},remove(){},contains:()=>false},appendChild(){},addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[]}),
    body:{dataset:{},appendChild(){},addEventListener(){},classList:{add(){},remove(){}}},
    addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null,
};
globalThis.window = {addEventListener(){},innerWidth:1280,innerHeight:720};
globalThis.getComputedStyle = ()=>({display:'none',visibility:'hidden'});

const {continuationReprompt} = await import('../src/generation/engine.js');
const {buildRequestSchema} = await import('../src/schema.js');
const {getActiveSchema,shouldUseDelta,forceFullStateRefresh,clearForceFullState} = await import('../src/settings.js');
const full = buildRequestSchema(getActiveSchema(),{mode:'full'});
full.value.properties.frozenProbe = {type:'string'};
const base = ctx.chatMetadata.scenepulse.snapshots['1'];
const opts = {mesIdx:2,baseSnapshot:base,stopStOnAbort:false};
assert.equal(shouldUseDelta(base),true,'test starts with delta eligible');

const a = await continuationReprompt(ctx.chat[2].mes,{...opts,frozenDeltaMode:false,frozenRequestSchema:full});
assert.ok(a,'full continuation returns a tracker');
assert.doesNotMatch(calls.at(-1).prompt+calls.at(-1).systemPrompt,/DELTA MODE/,'frozen full must not ask for delta');
assert.equal(a._spContinuationMeta.mode,'full');
assert.deepEqual(a._spContinuationMeta.requestSchema,full,'continuation uses the exact frozen schema');
assert.notEqual(a._spContinuationMeta.requestSchema,full,'frozen schema is cloned');
assert.notEqual(a._spContinuationMeta.requestSchema.value,full.value);

const delta = buildRequestSchema(getActiveSchema(),{mode:'delta'});
forceFullStateRefresh();
const b = await continuationReprompt(ctx.chat[2].mes,{...opts,frozenDeltaMode:true,frozenRequestSchema:delta.value});
assert.match(calls.at(-1).prompt,/DELTA MODE/,'frozen delta beats a later force-full flag');
assert.equal(b._spContinuationMeta.mode,'delta');
assert.deepEqual(b._spContinuationMeta.requestSchema,{value:delta.value},'raw frozen schema is wrapped');

const c = await continuationReprompt(ctx.chat[2].mes,{...opts,baseSnapshot:null,frozenDeltaMode:true,frozenRequestSchema:delta});
assert.ok(c,'delta without a base returns a full tracker');
assert.equal(c._spContinuationMeta.mode,'full');
assert.doesNotMatch(calls.at(-1).prompt,/DELTA MODE/);
assert.deepEqual(c._spContinuationMeta.requestSchema,buildRequestSchema(getActiveSchema(),{mode:'full'}),'missing base rebuilds the full schema');
clearForceFullState();

const legacy = await continuationReprompt(ctx.chat[2].mes,opts);
assert.equal(legacy._spContinuationMeta.mode,'delta','unfrozen callers retain automatic mode selection');
console.log('together-continuation-frozen-contract: passed');
