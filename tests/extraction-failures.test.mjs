// Typed extraction failures and recovery candidate coverage.

const ctx = {
    name1: 'User', name2: 'Alice', groupId: null, characterId: 1, chatId: 'typed-errors',
    chat: [{ is_user: false, mes: 'Narrative only', swipe_id: 0, swipes: ['Narrative only'] }],
    chatMetadata: { scenepulse: { snapshots: {}, swipeSnapshots: {} } },
    extensionSettings: { scenepulse: { deltaMode: false } },
    saveMetadata() {}, saveSettingsDebounced() {},
};
globalThis.SillyTavern = { getContext: () => ctx };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.document = { querySelector: () => null };

const { cleanJson, parseTrackerCandidate, extractInlineTracker, SP_MARKER_START } = await import('../src/generation/extraction.js');
const { getLastExtractionFailure } = await import('../src/state.js');

let pass=0,fail=0;
function eq(name,actual,expected){if(actual===expected){pass++;console.log('  OK   '+name)}else{fail++;console.log('  FAIL '+name+' — expected '+JSON.stringify(expected)+', got '+JSON.stringify(actual))}}
function errorCode(fn){try{fn();return''}catch(e){return e.code||''}}

console.log('\n── Typed extraction failures ──');
eq('no object has typed code',errorCode(()=>cleanJson('plain prose')),'NO_JSON_OBJECT');
eq('missing closing brace has typed code',errorCode(()=>cleanJson('{"time":"10:00"')),'TRUNCATED');
eq('unknown object is rejected',errorCode(()=>parseTrackerCandidate('{"a":1,"b":2,"c":3,"d":4,"e":5}')),'UNKNOWN_SCHEMA');
eq('small tracker is rejected',errorCode(()=>parseTrackerCandidate('{"time":"10:00"}')),'TOO_SMALL');

eq('narrative-only extraction returns null',extractInlineTracker(0),null);
eq('narrative-only failure is classified',getLastExtractionFailure()?.code,'NO_TRACKER');

ctx.chat[0].mes='Story\n'+SP_MARKER_START+'\n{"time":"10:00","date":"Tuesday"';
ctx.chat[0].swipes[0]=ctx.chat[0].mes;
eq('truncated marker extraction returns null',extractInlineTracker(0),null);
eq('truncated marker is classified',getLastExtractionFailure()?.code,'TRUNCATED');
eq('raw repair candidate retained in memory',getLastExtractionFailure()?.rawCandidate.includes('"time"'),true);

console.log(`\n${fail===0?'PASS':'FAIL'} ${pass}/${pass+fail}`);
if(fail)process.exit(1);
