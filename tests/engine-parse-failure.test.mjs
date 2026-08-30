// A malformed provider response on a new swipe must not break the retry.

let providerCalls = 0;
let worldInfoCalls = 0;
let metadataSaves = 0;
let stopGenerationCalls = 0;
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
    stopGeneration() { stopGenerationCalls++; return true; },
    getWorldInfoPrompt: async () => { worldInfoCalls++; throw new Error('ScenePulse must not scan World Info'); },
    saveMetadata() { metadataSaves++; }, saveSettingsDebounced() {},
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
const { getBuildTimings } = await import('../src/generation/build-timing.js');
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
const firstTiming=getBuildTimings().slice(-1)[0];
eq('successful build timing is recorded', firstTiming?.status, 'ok');
eq('timing records both provider attempts', firstTiming?.attempts?.length, 2);
eq('first malformed attempt is classified', firstTiming?.attempts?.[0]?.status, 'parse_failed');
eq('second attempt is accepted', firstTiming?.attempts?.[1]?.status, 'ok');
eq('snapshot persists the same generation id', getSnapshotFor(1, 1)?._spMeta?.timing?.generationId, firstTiming?.generationId);
eq('snapshot timing omits internal chat key', Object.hasOwn(getSnapshotFor(1, 1)?._spMeta?.timing||{},'chatKey'), false);

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
eq('cancelled build is retained for diagnostics',getBuildTimings().slice(-1)[0]?.status,'discarded');

ctx.chat.push(
    {is_user:true,mes:'Build this scene in parallel'},
    {is_user:false,mes:'Parallel answer',swipe_id:0,swipes:['Parallel answer']},
);
ctx.extensionSettings.scenepulse.parallelFullGeneration=true;
ctx.extensionSettings.scenepulse.injectionMethod='separate';
ctx.extensionSettings.scenepulse.deltaMode=false;
ctx.extensionSettings.scenepulse.connectionProfile='profile-1';
ctx.extensionSettings.scenepulse.chatPreset='';
ctx.extensionSettings.connectionManager={selectedProfile:'profile-1'};
const parallelTracker={...validTracker,sceneSummary:'Parallel full scene'};
const coreFields=new Set(['elapsed','temporalIntent','time','date','location','weather','temperature','soundEnvironment','sceneTopic','sceneMood','sceneInteraction','sceneTension','sceneSummary','charactersPresent','witnesses']);
const profileLanes=[];
ctx.ConnectionManagerRequestService={
    getSupportedProfiles(){return[{id:'profile-1',name:'Soji'}]},
    async sendRequest(_profileId,messages){
        const prompt=messages.find(message=>message?.role==='user')?.content||'';
        const laneId=prompt.match(/\[SCENEPULSE_LANE ([^\]]+)\]/)?.[1]||'unknown';
        profileLanes.push(laneId);
        let payload;
        if(laneId==='core')payload=Object.fromEntries(Object.entries(parallelTracker).filter(([key])=>coreFields.has(key)));
        else if(laneId.startsWith('characters-'))payload={characters:parallelTracker.characters};
        else payload=Object.fromEntries(Object.entries(parallelTracker).filter(([key])=>!coreFields.has(key)&&key!=='characters'));
        return{content:JSON.stringify(payload)};
    },
};
const legacyCallsBeforeParallel=providerCalls;
const metadataSavesBeforeParallel=metadataSaves;
const parallelResult=await generateTracker(7);
eq('parallel full uses core + character + global lanes',JSON.stringify(profileLanes),JSON.stringify(['core','characters-0','global']));
eq('parallel full does not call legacy generation transport',providerCalls,legacyCallsBeforeParallel);
eq('parallel full result reaches normal postprocess',parallelResult?.sceneSummary,'Parallel full scene');
eq('parallel lanes produce exactly one final metadata save',metadataSaves-metadataSavesBeforeParallel,1);
eq('parallel full metadata is persisted once on the final snapshot',getSnapshotFor(7,0)?._spMeta?.parallel?.mode,'parallel-full');
eq('parallel build timing identifies profile-bound transport',getSnapshotFor(7,0)?._spMeta?.timing?.transport,'profile-bound-parallel');
const parallelTiming=getBuildTimings().slice(-1)[0];
eq('parallel build timing exposes lane count',parallelTiming?.laneCount,3);
eq('parallel build timing exposes the measured lane wall',Object.hasOwn(parallelTiming||{},'laneWallMs'),true);
eq('parallel build timing exposes the measured lane sum',Object.hasOwn(parallelTiming||{},'laneSumMs'),true);
eq('parallel build timing exposes the measured gain',Object.hasOwn(parallelTiming||{},'parallelGain'),true);

ctx.chat.push(
    {is_user:true,mes:'Cancel parallel build'},
    {is_user:false,mes:'Parallel answer before stop',swipe_id:0,swipes:['Parallel answer before stop']},
);
const parallelChildSignals=[];
ctx.ConnectionManagerRequestService.sendRequest=async(_profileId,messages,_maxTokens,custom)=>{
    const prompt=messages.find(message=>message?.role==='user')?.content||'';
    const laneId=prompt.match(/\[SCENEPULSE_LANE ([^\]]+)\]/)?.[1]||'unknown';
    if(laneId==='core')return{content:JSON.stringify(Object.fromEntries(Object.entries(parallelTracker).filter(([key])=>coreFields.has(key))))};
    parallelChildSignals.push(custom.signal);
    return await new Promise((_,reject)=>custom.signal.addEventListener('abort',()=>reject(custom.signal.reason),{once:true}));
};
const cancelledParallel=generateTracker(9);
const stopCallsBeforeParallelCancel=stopGenerationCalls;
setTimeout(cancelGeneration,20);
const cancelledParallelResult=await cancelledParallel;
eq('manual Stop cancels the parallel parent build',cancelledParallelResult,null);
eq('manual Stop reaches every started profile-bound child',parallelChildSignals.length>0&&parallelChildSignals.every(signal=>signal.aborted),true);
eq('parallel Stop does not call global SillyTavern stopGeneration',stopGenerationCalls,stopCallsBeforeParallelCancel);
eq('cancelled parallel build writes no snapshot',getSnapshotFor(9,0),null);
eq('cancelled parallel build performs no metadata save',metadataSaves-metadataSavesBeforeParallel,1);

ctx.chat.push(
    {is_user:true,mes:'Fail one parallel lane'},
    {is_user:false,mes:'Parallel answer with one bad lane',swipe_id:0,swipes:['Parallel answer with one bad lane']},
);
ctx.extensionSettings.scenepulse.maxRetries=0;
ctx.ConnectionManagerRequestService.sendRequest=async(_profileId,messages)=>{
    const prompt=messages.find(message=>message?.role==='user')?.content||'';
    const laneId=prompt.match(/\[SCENEPULSE_LANE ([^\]]+)\]/)?.[1]||'unknown';
    if(laneId==='core')return{content:JSON.stringify(Object.fromEntries(Object.entries(parallelTracker).filter(([key])=>coreFields.has(key))))};
    if(laneId.startsWith('characters-'))return{content:JSON.stringify({characters:parallelTracker.characters})};
    return{content:'{}'};
};
const legacyCallsBeforeLaneFailure=providerCalls;
const metadataSavesBeforeLaneFailure=metadataSaves;
const failedParallel=await generateTracker(11);
eq('failed global lane still commits when previous state can fill it',!!failedParallel,true);
eq('failed parallel build does not fall back to legacy monolith',providerCalls,legacyCallsBeforeLaneFailure);
eq('partial parallel snapshot is saved',!!getSnapshotFor(11,0),true);
eq('partial parallel build performs one metadata save',metadataSaves,metadataSavesBeforeLaneFailure+1);
eq('partial meta is stamped',!!failedParallel?._spMeta?.parallel?.partial,true);

ctx.chat.push(
    {is_user:true,mes:'A calm social scene after an old injury'},
    {is_user:false,mes:'Alice keeps talking',swipe_id:0,swipes:['Alice keeps talking']},
);
ctx.chatMetadata.scenepulse.chatPanels=[
    {
        id:'cp_social',name:'Social state',scope:'global',enabled:true,
        activationMode:'auto',activationTags:['social'],
        fields:[{key:'social_state',label:'Social',type:'text',desc:'Current social situation.'}],
    },
    {
        id:'cp_injury',name:'Injury state',scope:'character',enabled:true,
        activationMode:'auto',activationTags:['injury'],
        fields:[{key:'injury_state',label:'Injury',type:'text',desc:'Current injury state.'}],
    },
];
const dynamicPrevious=getSnapshotFor(11,0)||getSnapshotFor(7,0);
dynamicPrevious.social_state='Old social state';
dynamicPrevious.characters[0].injury_state='Bandaged';
dynamicPrevious._spMeta.panelActivation={version:1,activeTags:[],graceByTag:{},activePanelIds:[],inactivePanelIds:['cp_social','cp_injury']};
const dynamicSchemas=new Map();
const dynamicHeavyPrompts=[];
const liveProfileMutation='MUTATED PROFILE MUST NOT REACH HEAVY LANES';
let liveProfileMutated=false;
ctx.ConnectionManagerRequestService.sendRequest=async(_profileId,messages,_maxTokens,_custom,override)=>{
    const prompt=messages.find(message=>message?.role==='user')?.content||'';
    const systemPrompt=messages.find(message=>message?.role==='system')?.content||'';
    const laneId=prompt.match(/\[SCENEPULSE_LANE ([^\]]+)\]/)?.[1]||'unknown';
    dynamicSchemas.set(laneId,override?.json_schema||null);
    if(laneId==='core'){
        const liveProfile=ctx.extensionSettings.scenepulse.profiles?.find(profile=>profile.id===ctx.extensionSettings.scenepulse.activeProfileId);
        if(liveProfile){liveProfile.systemPrompt=liveProfileMutation;liveProfileMutated=true}
        return{content:JSON.stringify({
            ...Object.fromEntries(Object.entries(parallelTracker).filter(([key])=>coreFields.has(key))),
            sceneTags:['social'],resolvedTags:[],
        })};
    }
    dynamicHeavyPrompts.push(systemPrompt);
    if(laneId.startsWith('characters-'))return{content:JSON.stringify({characters:parallelTracker.characters.map(character=>({...character,injury_state:'foreign overwrite'}))})};
    return{content:JSON.stringify({
        ...Object.fromEntries(Object.entries(parallelTracker).filter(([key])=>!coreFields.has(key)&&key!=='characters')),
        social_state:'Friendly',
    })};
};
ctx.extensionSettings.scenepulse.promptMode='native';
ctx.chatMetadata.scenepulse.panelActivationStrategy='automatic';
const metadataSavesBeforeDynamic=metadataSaves;
const dynamicResult=await generateTracker(13);
eq('router activates matching custom panel on the same build',dynamicResult?.social_state,'Friendly');
eq('inactive character panel state survives the full build',dynamicResult?.characters?.[0]?.injury_state,'Bandaged');
eq('activation metadata is persisted on the final snapshot',JSON.stringify(dynamicResult?._spMeta?.panelActivation?.activePanelIds),JSON.stringify(['cp_social']));
eq('activation timing stores canonical scene tags',JSON.stringify(dynamicResult?._spMeta?.timing?.activeTags),JSON.stringify(['social']));
eq('inactive character field is absent from request schema',Object.hasOwn(dynamicSchemas.get('characters-0')?.value?.properties?.characters?.items?.properties||{},'injury_state'),false);
eq('dynamic parallel build performs exactly one final metadata save',metadataSaves-metadataSavesBeforeDynamic,1);
eq('Router test mutates the live profile after the frozen capture',liveProfileMutated,true);
eq('profile edits during Router do not leak into frozen heavy prompts',dynamicHeavyPrompts.some(prompt=>prompt.includes(liveProfileMutation)),false);

ctx.chat.push(
    {is_user:true,mes:'Use manual panel selection'},
    {is_user:false,mes:'Alice reports every configured panel',swipe_id:0,swipes:['Alice reports every configured panel']},
);
ctx.chatMetadata.scenepulse.panelActivationStrategy='manual';
const manualSchemas=new Map();
ctx.ConnectionManagerRequestService.sendRequest=async(_profileId,messages,_maxTokens,_custom,override)=>{
    const prompt=messages.find(message=>message?.role==='user')?.content||'';
    const laneId=prompt.match(/\[SCENEPULSE_LANE ([^\]]+)\]/)?.[1]||'unknown';
    manualSchemas.set(laneId,override?.json_schema||null);
    if(laneId==='core')return{content:JSON.stringify(
        Object.fromEntries(Object.entries(parallelTracker).filter(([key])=>coreFields.has(key))),
    )};
    if(laneId.startsWith('characters-'))return{content:JSON.stringify({
        characters:parallelTracker.characters.map(character=>({...character,injury_state:'Checked manually'})),
    })};
    return{content:JSON.stringify({
        ...Object.fromEntries(Object.entries(parallelTracker).filter(([key])=>!coreFields.has(key)&&key!=='characters')),
        social_state:'Updated manually',
    })};
};
const metadataSavesBeforeManual=metadataSaves;
const manualResult=await generateTracker(15);
eq('manual strategy regenerates an enabled auto global panel',manualResult?.social_state,'Updated manually');
eq('manual strategy regenerates an enabled auto character panel',manualResult?.characters?.[0]?.injury_state,'Checked manually');
eq('manual strategy skips Router-only schema fields',Object.hasOwn(manualSchemas.get('core')?.value?.properties||{},'sceneTags'),false);
eq('manual strategy preserves the last automatic decision for a later switch back',JSON.stringify(manualResult?._spMeta?.panelActivation?.activeTags),JSON.stringify(['social']));
eq('manual strategy still performs exactly one final metadata save',metadataSaves-metadataSavesBeforeManual,1);

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
