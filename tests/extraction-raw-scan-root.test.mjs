import assert from 'node:assert/strict';

const ctx = {
    name1:'User',name2:'Alice',characterId:1,chatId:'raw-scan-root',
    chat:[{is_user:true,mes:'Continue'},{is_user:false,mes:'',swipe_id:0}],
    chatMetadata:{scenepulse:{snapshots:{}}},extensionSettings:{scenepulse:{}},
    saveMetadata(){},saveSettingsDebounced(){},saveChat:async()=>{},
};
globalThis.SillyTavern = {getContext:()=>ctx};
globalThis.localStorage = {getItem:()=>null,setItem(){}};
globalThis.document = {querySelector:()=>null};
const {extractInlineTracker} = await import('../src/generation/extraction.js');
const {getLastExtractionFailure} = await import('../src/state.js');
const {debugLog} = await import('../src/logger.js');

const pad = 'x'.repeat(260);
const truncated = 'Story text.\n{"time":"10:00","activityPlans":[{"id":"sv-ap-1","note":"'+pad+'"}],"sceneSummary":"cut';
ctx.chat[1].mes = truncated;
assert.equal(extractInlineTracker(1),null,'nested object in a truncated root is rejected');
assert.equal(getLastExtractionFailure()?.code,'TRUNCATED');
assert.equal(ctx.chat[1].mes,truncated,'message must not be modified');

const nested = {time:'10:00',date:'07/21/2026',elapsed:'1m',location:'Hall',sceneSummary:pad};
const truncatedWithTrackerLikeChild = 'Story text.\n{"activityPlans":['+JSON.stringify(nested)+'],"sceneSummary":"cut';
ctx.chat[1].mes = truncatedWithTrackerLikeChild;
assert.equal(extractInlineTracker(1),null,'tracker-like nested object must not be extracted either');
assert.equal(getLastExtractionFailure()?.code,'TRUNCATED');
assert.equal(ctx.chat[1].mes,truncatedWithTrackerLikeChild);

const smallNested = {...nested,sceneSummary:'x'.repeat(65)};
const truncatedWithSmallChild = 'Story text.\n{"activityPlans":['+JSON.stringify(smallNested)+'],"sceneSummary":"cut';
ctx.chat[1].mes = truncatedWithSmallChild;
assert.equal(extractInlineTracker(1),null,'time-key fallback must not extract a small nested tracker');
assert.equal(getLastExtractionFailure()?.code,'TRUNCATED');
assert.equal(ctx.chat[1].mes,truncatedWithSmallChild);

const indentedRoot = 'Story.\n{\n  "time":"10:00","activityPlans":[{"id":"a","note":"'+pad+'"}],"sceneSummary":"cut';
const indentedRootWithSmallChild = 'Story.\n{\n  "time":"10:00","activityPlans":['+JSON.stringify(smallNested)+'],"sceneSummary":"cut';
for (const raw of [indentedRoot,indentedRootWithSmallChild]) {
    ctx.chat[1].mes = raw;
    assert.equal(extractInlineTracker(1),null,'indented JSON root still blocks nested extraction');
    assert.equal(getLastExtractionFailure()?.code,'TRUNCATED');
    assert.equal(ctx.chat[1].mes,raw,'indented truncated message must not be modified');
}

const fullTracker = {...nested,weather:'Clear',temperature:'22°C',sceneTopic:'A sigil',sceneMood:'Calm',
    sceneInteraction:'Conversation',sceneTension:'low',soundEnvironment:'Quiet',charactersPresent:[],witnesses:[]};
assert.ok(JSON.stringify(fullTracker).length>200,'large fixture uses the raw JSON scan');
assert.ok(JSON.stringify(smallNested).length>100&&JSON.stringify(smallNested).length<=200,'small fixture uses the time-key scan');
const outcomes = [];
for (const [method,tracker] of [['RAW_JSON_SCAN',fullTracker],['RAW_TIME_KEY_SCAN',smallNested]]) {
    for (const prefix of [
        'She draws a sigil: { — and stops. "Wait," she says.\n',
        'He pouts :{ and laughs.\n',
        '*{смеётся}* "Hi," she says.\n',
        '{"aside":"a literal { brace"} She nods.\n',
        '{ \n } She nods.\n',
    ]) {
        ctx.chat[1].mes = prefix+JSON.stringify(tracker);
        debugLog.length=0;
        const extracted=extractInlineTracker(1);
        outcomes.push({method,prefix,time:extracted?.time??null,code:getLastExtractionFailure()?.code??null});
        if(extracted){
            assert.equal(ctx.chat[1].mes.trim(),prefix.trim(),'only tracker is removed');
            assert.ok(debugLog.some(line=>line.includes('found via '+method+' ')),'fixture exercises '+method);
        }
    }
}
assert.deepEqual(outcomes,outcomes.map(result=>({...result,time:'10:00',code:null})),'prose braces do not hide complete trackers in either raw fallback');
console.log('extraction-raw-scan-root: passed');
