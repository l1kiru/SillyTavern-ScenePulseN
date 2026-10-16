import assert from 'node:assert/strict';

let metadataSaves = 0;
let legacyCalls = 0;
const names = ['Alice', 'Bob', 'Carol', 'Dana'];
const makeCharacter = (name, role = 'Companion') => ({
    name, aliases: [], archetype: 'ally', role,
    innerThought: 'Watching the scene.', immediateNeed: 'Stay aware',
    shortTermGoal: 'Continue', longTermGoal: 'Help',
    hair: 'Dark', face: 'Calm', outfit: 'Travel clothes', posture: 'Standing',
    proximity: 'Nearby', notableDetails: 'None', inventory: [], fertStatus: 'N/A', fertNotes: 'None',
});
const plotBranches = ['dramatic','intense','comedic','twist','exploratory'].map(type => ({ type, name: type, hook: 'A specific next step.' }));
const previous = {
    time: '10:00:00', date: '08/26/2026 (Wednesday)', elapsed: '1m (conversation)',
    location: 'Hall > Manor', weather: 'Clear', temperature: '22°C — mild',
    sceneTopic: 'Planning', sceneMood: 'Calm', sceneInteraction: 'Conversation', sceneTension: 'low',
    sceneSummary: 'Группа обсуждает планы. 街 😀', soundEnvironment: 'Quiet room',
    charactersPresent: [...names], witnesses: [], northStar: 'Keep moving',
    mainQuests: [], sideQuests: [], relationships: [],
    characters: names.map(name => makeCharacter(name)), plotBranches,
    _spMeta: { deltaMode: false, deltaTurnsSinceFull: 0 },
};

const ctx = {
    name1: 'User', name2: 'Alice', characterId: 1, chatId: 'parallel-delta-engine',
    groupId: null, selected_group: null, groups: [], characters: [],
    chat: [
        { is_user: true, mes: 'Old prompt' },
        { is_user: false, mes: 'Old answer', swipe_id: 0, swipes: ['Old answer'] },
        { is_user: true, mes: 'Continue the plan' },
        { is_user: false, mes: 'The group agrees and Bob takes command.', swipe_id: 0, swipes: ['The group agrees and Bob takes command.'] },
    ],
    chatMetadata: { scenepulse: { snapshots: {}, swipeSnapshots: {} } },
    extensionSettings: {
        scenepulse: {
            enabled: true, autoGenerate: true, maxRetries: 0, contextMessages: 4,
            injectionMethod: 'separate', deltaMode: true, deltaRefreshInterval: 15,
            parallelFullGeneration: false, panelActivationStrategy: 'manual',
            promptMode: 'json', connectionProfile: 'profile-1', chatPreset: '',
            fallbackEnabled: false, showThoughts: false,
            // Keep this batching fixture light as optional structured facets grow.
            fieldToggles: { char_conditions: false, char_emotionalState: false, char_establishedTraits: false, char_knowledgeProvenance: false },
        },
        connectionManager: { selectedProfile: 'profile-1' },
    },
    generateRawData: async () => { legacyCalls++; throw new Error('legacy transport must not run'); },
    stopGeneration() { return true; },
    getWorldInfoPrompt: async () => { throw new Error('World Info should not be scanned'); },
    saveMetadata() { metadataSaves++; }, saveSettingsDebounced() {},
};

globalThis.SillyTavern = { getContext: () => ctx };
globalThis.localStorage = { getItem: () => null, setItem() {} };
const errorToasts = [];
globalThis.toastr = { error(...args) { errorToasts.push(args); }, warning() {}, info() {}, success() {} };
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

const { saveSnapshot, getSnapshotFor } = await import('../src/settings.js');
const { generateTracker, continuationReprompt, cancelGeneration } = await import('../src/generation/engine.js');
saveSnapshot(1, structuredClone(previous), 0);
const savesBefore = metadataSaves;


let calls=0,stops=0;
ctx.stopGeneration=()=>{stops++;return true};
ctx.ConnectionManagerRequestService={
 getSupportedProfiles:()=>[{id:'profile-1',name:'Tracker'}],
 async sendRequest(id,messages,budget,options){
  calls++;assert.equal(id,'profile-1');assert.equal(options.includePreset,true);
  return {content:JSON.stringify(previous)};
 }
};
const result=await generateTracker(3);
assert.equal(result?.location,previous.location);
assert.equal(result?._spMeta?.request?.strategy,'connection-profile');
assert.equal(result?._spMeta?.timing?.transport,'profile-bound');
assert.equal(result._spMeta.timing.attempts[0].outputTokensEstimate,
 Math.ceil(new TextEncoder().encode(JSON.stringify(previous)).length / 3.35));
assert.equal(legacyCalls,0);
assert.equal(calls,1);
const continued=await continuationReprompt('The group agrees.',{mesIdx:3});
assert.equal(continued?.location,previous.location);
assert.equal(calls,2);
assert.equal(legacyCalls,0);
let entered;
const enteredPromise=new Promise(resolve=>{entered=resolve});
ctx.ConnectionManagerRequestService.sendRequest=async()=>{entered();return await new Promise(()=>{})};
const pending=continuationReprompt('The group waits.',{mesIdx:3});
await enteredPromise;
cancelGeneration();
assert.equal(await pending,null);
assert.equal(stops,0,'continuation cancel must not stop independent main generation');

console.log('engine-single-profile: passed');
