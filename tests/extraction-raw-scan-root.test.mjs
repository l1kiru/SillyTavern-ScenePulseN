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

for (const prefix of ['*{смеётся}* She nods.\n','{"aside":"a literal { brace"} She nods.\n']) {
    const good = prefix+JSON.stringify(nested);
    ctx.chat[1].mes = good;
    assert.equal(extractInlineTracker(1)?.time,'10:00','closed narrative braces do not hide a complete tracker');
    assert.equal(getLastExtractionFailure(),null);
    assert.equal(ctx.chat[1].mes.trim(),prefix.trim(),'only tracker is removed');
}
console.log('extraction-raw-scan-root: passed');
