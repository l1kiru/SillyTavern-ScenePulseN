import assert from 'node:assert/strict';
import { startSceneSourceTrace, recordWorldInfoEntriesLoaded, recordWorldInfoScanDone,
 recordWorldInfoActivation, finishSceneSourceTrace } from '../src/scene-source-trace.js';
const owner={chatKey:'rename-test',targetMessageId:1,swipeId:0};
const entry={world:'Old book',uid:7,comment:'Gate',key:['gate'],content:'The gate is locked.'};
const decision={entry:{world:'Old book',uid:7},status:'accepted',reason:'primary_key',
 primaryMatch:{matched:true,text:'gate',originalKey:'gate',index:0},secondaryMatches:[]};
function start(entries,decisions){
 startSceneSourceTrace(owner,{enabled:true,chat:[{mes:'gate'}],depth:1});
 recordWorldInfoEntriesLoaded({globalLore:entries,chatLore:entries});
 recordWorldInfoScanDone({activated:{entries:new Map(entries.map(e=>[`${e.world}.${e.uid}`,e]))},
 state:{current:1,next:0,loopCount:0},...(decisions?{decisions}: {})});
 recordWorldInfoActivation(entries);
}
start([entry],[decision]);
// Simulate a source reusing its event objects after an edit/rename, before finish.
entry.world='New book';decision.entry.world='New book';decision.primaryMatch.text='edited';
const historical=finishSceneSourceTrace(owner);
assert.deepEqual(historical.lorebook.entries.map(e=>e.world),['Old book']);
assert.equal(historical._decisions[0].entry.world,'Old book');
assert.equal(historical._decisions[0].primaryMatch.text,'gate');
const archived=JSON.stringify(historical);
// Both host generations emit the newly loaded world name; decisions are optional.
for(const decisions of [undefined,[decision]]){
 start([entry],decisions);
 const fresh=finishSceneSourceTrace(owner);
 assert.deepEqual(fresh.loadedEntryKeys,['New book::7']);
 assert.deepEqual(fresh.lorebooks[0].attachmentSources,['global','chat']);
 assert.deepEqual(fresh.lorebook.entries.map(e=>e.world),['New book']);
 assert.equal(fresh.candidates.length,0);
 assert.equal(JSON.stringify(historical),archived,'new capture must not migrate history');
}
// Reusing the old name and UID is a separate source, never a rename alias.
start([entry,{...entry,world:'Old book'}]);
const coexist=finishSceneSourceTrace(owner);
assert.deepEqual(coexist.lorebook.entries.map(e=>e.world),['New book','Old book']);
assert.deepEqual(coexist.loadedEntryKeys,['New book::7','Old book::7']);
decision.entry.world='Changed again';decision.primaryMatch.text='changed again';
assert.equal(JSON.stringify(historical),archived,'finished history must not retain source references');
globalThis.document={createElement:()=>({style:{},classList:{add(){},remove(){}}}),body:{},querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null,addEventListener(){}};
globalThis.window={addEventListener(){}};
const {buildTraceDrawerModel}=await import('../src/ui/scene-source-trace-ui.js');
const restored=JSON.parse(archived);
const drawer=buildTraceDrawerModel({settings:{sceneSourceTrace:true,injectionMethod:'inline'},trace:restored});
assert.equal(drawer.groups[0].world,'Old book');
assert.equal(drawer.groups[0].items[0].uid,'7');
assert.equal(JSON.stringify(restored),archived,'rendering history must not rewrite it');
console.log('scene-source-trace-rename: passed');
