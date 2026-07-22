// Together/inline prompt must share the volatile-field contract with standalone.

const ctx = {
    name1: 'User', name2: 'Alice', groupId: null, selected_group: null,
    groups: [], characters: [],
    chatMetadata: { scenepulse: { snapshots: {
        1: {
            time: '12:00', charactersPresent: [],
            characters: [{ name: 'Alice', role: 'bot', innerThought: 'SECRET OLD THOUGHT' }],
            relationships: [],
        },
    } } },
    extensionSettings: { scenepulse: {} },
    saveMetadata() {}, saveSettingsDebounced() {},
};
globalThis.SillyTavern = { getContext: () => ctx };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.toastr = { error() {}, warning() {}, info() {}, success() {} };
globalThis.document = {
    createElement: () => ({ style: {} }),
    body: { dataset: {}, appendChild() {}, addEventListener() {} },
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
};
globalThis.window = { addEventListener() {} };

const { buildInlineTrackerPrompt } = await import('../src/generation/interceptor.js');
const { getSettings } = await import('../src/settings.js');

let pass = 0, fail = 0;
function ok(name, value) {
    if (value) { pass++; console.log('  OK   ' + name); }
    else { fail++; console.log('  FAIL ' + name); }
}

console.log('\n── Together prompt thought contract ──');
const delta = buildInlineTrackerPrompt();
ok('delta requires charactersPresent and witnesses', delta.includes('charactersPresent, witnesses'));
ok('delta requires fresh thought and need', delta.includes('Recompute innerThought and immediateNeed'));
ok('solo previous state does not leak old thought', !delta.includes('SECRET OLD THOUGHT'));
ok('solo previous state keeps only off-scene stub', delta.includes('_offSceneCharacters'));

getSettings().deltaMode = false;
const full = buildInlineTrackerPrompt();
ok('full prompt explicitly allows empty arrays', full.includes('Use [] for genuinely empty array fields'));
ok('full prompt no longer forbids every empty array', !full.includes('Never return "" or []'));

const settings=getSettings();
const active=settings.profiles?.find(profile=>profile.id===settings.activeProfileId);
if(active)active.panels={...active.panels,storyIdeas:false};
settings.deltaMode=true;
const withoutIdeas=buildInlineTrackerPrompt();
ok('disabled story ideas are absent from Together prompt', !withoutIdeas.includes('plotBranches'));

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass}/${pass + fail}`);
if (fail) process.exit(1);
