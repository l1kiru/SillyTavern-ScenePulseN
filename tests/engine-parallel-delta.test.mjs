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
    sceneSummary: 'The group is planning.', soundEnvironment: 'Quiet room',
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
            parallelFullGeneration: true, panelActivationStrategy: 'manual',
            promptMode: 'json', connectionProfile: 'profile-1', chatPreset: '',
            fallbackEnabled: false, showThoughts: false,
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

const { saveSnapshot, getSnapshotFor } = await import('../src/settings.js');
const { generateTracker } = await import('../src/generation/engine.js');
saveSnapshot(1, structuredClone(previous), 0);
const savesBefore = metadataSaves;

const laneCalls = [];
ctx.ConnectionManagerRequestService = {
    getSupportedProfiles() { return [{ id: 'profile-1', name: 'Soji' }]; },
    async sendRequest(_profileId, messages) {
        const prompt = messages.find(message => message?.role === 'user')?.content || '';
        const laneId = prompt.match(/\[SCENEPULSE_LANE ([^\]]+)\]/)?.[1] || 'unknown';
        laneCalls.push(laneId);
        if (laneId === 'core') return { content: JSON.stringify({
            elapsed: '2m (conversation)', time: '10:02:00', date: '08/26/2026 (Wednesday)',
            location: 'Hall > Manor', weather: 'Clear', temperature: '22°C — mild',
            sceneTopic: 'Planning', sceneMood: 'Focused', sceneInteraction: 'Conversation', sceneTension: 'low',
            sceneSummary: 'Bob takes command of the plan.', soundEnvironment: 'Quiet room',
            charactersPresent: [...names], witnesses: [],
        }) };
        if (laneId.startsWith('characters-')) {
            const requested = prompt.match(/preserving this batch order: ([^.]+)\./)?.[1]?.split(',').map(x => x.trim()).filter(Boolean) || [];
            return { content: JSON.stringify({ characters: requested.map(name => makeCharacter(name, name === 'Bob' ? 'Leader' : 'Companion')) }) };
        }
        if (laneId === 'global') return { content: JSON.stringify({ plotBranches }) };
        throw new Error('Unexpected lane: ' + laneId);
    },
};

const result = await generateTracker(3);
assert.equal(legacyCalls, 0, 'heavy Delta does not call monolithic legacy transport');
assert.equal(result?.characters?.find(character => character.name === 'Bob')?.role, 'Leader');
assert.equal(result?.sceneSummary, 'Bob takes command of the plan.');
assert.equal(result?._spMeta?.deltaMode, true);
assert.equal(result?._spMeta?.parallel?.mode, 'parallel-delta');
assert.equal(result?._spMeta?.request?.strategy, 'connection-profile-parallel-delta');
assert.equal(result?._spMeta?.timing?.transport, 'profile-bound-parallel-delta');
assert.equal(metadataSaves - savesBefore, 1, 'Parallel Delta commits exactly one final snapshot');
assert.deepEqual(laneCalls, ['core', 'characters-0', 'characters-1', 'global'], 'four-character light schema uses two-character batches plus Global');
assert.equal(getSnapshotFor(3, 0)?._spMeta?.parallel?.mode, 'parallel-delta');

console.log('engine-parallel-delta.test.mjs: all tests passed');
