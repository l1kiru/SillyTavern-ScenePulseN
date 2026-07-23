// Regression coverage for issue #3: tracker payload must be hidden before
// SillyTavern paints streamed marker/JSON tokens.
// Also covers cancel/fail unlock: stuck data-sp-has-tracker must clear on stop.

const pendingTimeouts=[];
globalThis.setTimeout=(fn)=>{pendingTimeouts.push(fn);return pendingTimeouts.length};
globalThis.clearTimeout=()=>{};
globalThis.setInterval=(fn)=>({fn});
globalThis.clearInterval=()=>{};
globalThis.NodeFilter={SHOW_COMMENT:128};
globalThis.MutationObserver=class{observe(){}disconnect(){}};

let styles=[];
const messageHost={getAttribute:key=>key==='mesid'?'42':null};
const message={scrollHeight:96,textContent:'Narrative',dataset:{},closest:()=>messageHost};
function makeStyle(){
    return {id:'',textContent:'',removed:false,remove(){this.removed=true;styles=styles.filter(x=>x!==this)}};
}
globalThis.document={
    head:{appendChild:el=>styles.push(el)},
    createElement:tag=>tag==='style'?makeStyle():{},
    getElementById:id=>styles.find(el=>el.id===id)||null,
    querySelector:sel=>sel.includes('.mes.last_mes')?message:null,
    querySelectorAll:sel=>{
        if(sel.includes('data-sp-has-tracker'))return message.dataset.spHasTracker!=null?[message]:[];
        if(sel==='.mes_text')return [message];
        return [];
    },
    createTreeWalker:()=>({nextNode:()=>null}),
};

const streaming=await import('../src/generation/streaming.js');
const state=await import('../src/state.js');

let pass=0,fail=0;
function assertEq(name,actual,expected){
    if(actual===expected){pass++;console.log('  OK   '+name)}
    else{fail++;console.log('  FAIL '+name+' — expected '+JSON.stringify(expected)+', got '+JSON.stringify(actual))}
}
function assertTrue(name,value){assertEq(name,!!value,true)}

console.log('\nissue #3 — pre-paint streaming hider');

assertEq('complete HTML marker detected',streaming.findTrackerPayloadStart('Story\n<!--SP_TRACKER_START-->'),6);
assertEq('partial HTML marker detected before paint',streaming.findTrackerPayloadStart('Story\n<!--'),6);
assertEq('raw JSON opening detected before keys',streaming.findTrackerPayloadStart('Story\n{'),6);
assertEq('ordinary narrative is ignored',streaming.findTrackerPayloadStart('Story continues.'),-1);

streaming.startStreamingHider();
streaming.noteStreamingText('Story\n<!--');
const firstStyle=state._streamHiderStyleEl;
assertTrue('stream event locks active style',firstStyle.textContent.includes('max-height:96px'));
assertTrue('locked selector targets exact message',firstStyle.textContent.includes('[mesid="42"]'));
assertEq('message marked for safe failure hiding',message.dataset.spHasTracker,'true');

// Default stop (fail/extract-miss path): clear mark immediately, delay style removal.
streaming.stopStreamingHider();
assertEq('default stop clears collapse mark immediately',message.dataset.spHasTracker,undefined);
assertTrue('default stop keeps style until delayed cleanup',!firstStyle.removed);
assertEq('default stop still registers delayed style',state._streamHiderStyleEl,firstStyle);

streaming.startStreamingHider();
streaming.noteStreamingText('Story<!--');
assertTrue('inline marker hides whole message before paint',state._streamHiderStyleEl.textContent.includes('visibility:hidden'));
assertEq('inline lock remarks message',message.dataset.spHasTracker,'true');

// Abort stop (cancel/watchdog): clear mark and remove style immediately.
const abortStyle=state._streamHiderStyleEl;
streaming.stopStreamingHider({abort:true});
assertEq('abort stop clears collapse mark immediately',message.dataset.spHasTracker,undefined);
assertTrue('abort stop removes style immediately',abortStyle.removed);
assertEq('abort stop clears active style pointer',state._streamHiderStyleEl,null);

// Starting a new generation schedules cleanup for the old style. That delayed
// callback must not clear the new generation's state pointer.
streaming.startStreamingHider();
streaming.noteStreamingText('Story\n<!--');
const secondStyle=state._streamHiderStyleEl;
streaming.startStreamingHider();
const thirdStyle=state._streamHiderStyleEl;
for(const fn of pendingTimeouts.splice(0))fn();
assertTrue('new style differs from prior generation',thirdStyle!==secondStyle);
assertTrue('stale cleanup keeps new style registered',state._streamHiderStyleEl===thirdStyle);

streaming.stopStreamingHider();
for(const fn of pendingTimeouts.splice(0))fn();
assertEq('final cleanup clears active style',state._streamHiderStyleEl,null);
assertEq('final cleanup leaves mark cleared',message.dataset.spHasTracker,undefined);

console.log(`${fail===0?'PASS':'FAIL'} ${pass}/${pass+fail}`);
if(fail)process.exit(1);
