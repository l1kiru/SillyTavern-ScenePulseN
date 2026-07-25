// Continuation recovery user prompt: continuity dual-rule + JSON-only.

globalThis.SillyTavern = {
    getContext: () => ({
        name1: 'User', name2: 'Alice', groupId: null, selected_group: null,
        groups: [], characters: [], chat: [],
        chatMetadata: { scenepulse: {} },
        extensionSettings: { scenepulse: {} },
        saveMetadata() {}, saveSettingsDebounced() {},
    }),
};
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.toastr = { error() {}, warning() {}, info() {}, success() {} };
globalThis.document = {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }),
    body: { dataset: {}, appendChild() {}, addEventListener() {} },
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
};
globalThis.window = { addEventListener() {} };
globalThis.getComputedStyle = () => ({ display: 'none', visibility: 'hidden' });

const { buildContinuationRecoveryPrompt } = await import('../src/generation/engine.js');

let pass = 0, fail = 0;
function ok(name, value) {
    if (value) { pass++; console.log('  OK   ' + name); }
    else { fail++; console.log('  FAIL ' + name); }
}

console.log('\n── Continuation recovery prompt ──');

const prompt = buildContinuationRecoveryPrompt({
    narrativeText: 'Rain hit the awning. Alice waited.',
    deltaInstruction: '',
    prevStateJson: { time: '12:00', charactersPresent: ['Alice'] },
});

ok('relabels prevState with continuity dual-rule',
    prompt.includes('PREVIOUS STATE') &&
    /continuity only/i.test(prompt) &&
    !/carry forward unchanged details/i.test(prompt));
ok('bullets: continuity-only prevState',
    /PREVIOUS STATE[^\n]*continuity only|continuity only[^\n]*PREVIOUS STATE|- [^\n]*continuity only/i.test(prompt));
ok('bullets: new facts/meters from this narrative only',
    /new facts[^\n]*this narrative|meter[^\n]*this narrative/i.test(prompt));
ok('bullets: no markdown fences / no commentary',
    /no markdown fences/i.test(prompt) && /no commentary/i.test(prompt));
ok('JSON-only recovery — no SP markers in instruction',
    !prompt.includes('SP_TRACKER_START') &&
    !prompt.includes('SP_TRACKER_END') &&
    !prompt.includes('<!--SP_'));
ok('includes narrative text', prompt.includes('Rain hit the awning. Alice waited.'));
ok('includes previous state JSON', prompt.includes('"time": "12:00"'));

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass}/${pass + fail}`);
if (fail) process.exit(1);
