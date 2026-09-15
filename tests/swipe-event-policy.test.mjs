// Event wiring regression: selecting/editing a swipe must not force the next
// tracker request to full-state mode. Fingerprint checks decide that later.

class Events{
    constructor(){this.map=new Map()}
    on(name,fn){if(!this.map.has(name))this.map.set(name,[]);this.map.get(name).push(fn)}
    removeListener(){}
    emit(name,...args){for(const fn of this.map.get(name)||[])fn(...args)}
}
const eventSource=new Events();
const event_types={
    APP_READY:'ready',CHARACTER_MESSAGE_RENDERED:'rendered',STREAM_TOKEN_RECEIVED:'token',
    GENERATION_STARTED:'gen-start',GENERATION_ENDED:'gen-end',GENERATION_STOPPED:'gen-stop',
    CHAT_CHANGED:'chat',MESSAGE_DELETED:'deleted',MESSAGE_SWIPE_DELETED:'swipe-deleted',
    MESSAGE_UPDATED:'updated',MESSAGE_SWIPED:'swiped',WORLD_INFO_ACTIVATED:'wi',
};
const ctx={
    name1:'User',name2:'Alice',characterId:1,chatId:'swipe-events',groupId:null,groups:[],characters:[],
    chat:[{is_user:true,mes:'Question'},{is_user:false,name:'Alice',mes:'Answer B',swipe_id:1,swipes:['Answer A','Answer B']}],
    chatMetadata:{scenepulse:{snapshots:{},swipeSnapshots:{}}},
    extensionSettings:{scenepulse:{enabled:true,deltaMode:true,deltaRefreshInterval:15,showThoughts:false}},
    eventSource,event_types,saveMetadata(){},saveSettingsDebounced(){},
};
globalThis.SillyTavern={getContext:()=>ctx};
globalThis.localStorage={getItem:()=>null,setItem(){}};
globalThis.toastr={error(){},warning(){},info(){},success(){}};
globalThis.getComputedStyle=()=>({display:'none',visibility:'hidden'});
const classList={add(){},remove(){},contains(){return false}};
const thoughtPanel={classList,querySelector:()=>null,style:{}};
const thoughtBody={innerHTML:'',classList,style:{},querySelector:()=>null,querySelectorAll:()=>[]};
const messageButtons={appendChild(){}};
const messageElement={querySelector:selector=>selector==='.sp-mes-btn'?null:messageButtons,getAttribute:()=> '1'};
globalThis.document={
    body:{dataset:{},classList,appendChild(){},addEventListener(){}},
    addEventListener(){},querySelector:selector=>selector.startsWith('.mes[mesid="1"]')?messageElement:null,querySelectorAll:()=>[],createElement:()=>({classList,style:{},dataset:{},appendChild(){},addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[]}),
    getElementById:id=>id==='sp-thought-panel'?thoughtPanel:(id==='sp-tp-body'?thoughtBody:null),
};
globalThis.window={addEventListener(){},innerWidth:1280,innerHeight:720};
globalThis.setTimeout=()=>1;
globalThis.clearTimeout=()=>{};

await import('../index.js');
const{shouldUseDelta,forceFullStateRefresh,clearForceFullState}=await import('../src/settings.js');
const state=await import('../src/state.js');
const previous={_spMeta:{deltaTurnsSinceFull:0}};

let pass=0,fail=0;
function eq(name,actual,expected){if(actual===expected){pass++;console.log('  OK   '+name)}else{fail++;console.log('  FAIL '+name+' — expected '+expected+', got '+actual)}}

console.log('\n── Swipe event generation policy ──');
eq('delta is initially available',shouldUseDelta(previous),true);
eventSource.emit('swiped',1);
eq('selecting a swipe does not force full state',shouldUseDelta(previous),true);
eventSource.emit('updated',1);
eq('editing a message does not force full state pre-emptively',shouldUseDelta(previous),true);

console.log('\n── Together Full ownership on chat change and Stop ──');
forceFullStateRefresh();
state.setInlineGenerationContext({fullRefreshTicket:clearForceFullState(),frozenDeltaMode:false});
state.setInlineGenStartMs(Date.now());
state.setGenerating(false);
ctx.chatId='another-chat';
for(const handler of eventSource.map.get('chat')||[])await handler();
eq('chat change independently requests Full for the new panel set',shouldUseDelta(previous),false);
clearForceFullState();
ctx.chatId='swipe-events';
eq('returning to chat retains cancelled Together Full debt',shouldUseDelta(previous),false);
eq('chat change drops inline context',state.inlineGenerationContext,null);
state.setInlineGenerationContext({fullRefreshTicket:clearForceFullState(),frozenDeltaMode:false});
state.setInlineGenStartMs(Date.now());
eventSource.emit('gen-stop');
eq('ST Stop immediately restores Together Full debt',shouldUseDelta(previous),false);
clearForceFullState();
state.setInlineGenerationContext(null);
state.setInlineGenStartMs(0);
state.setCancelRequested(false);

console.log('\n── Delayed separate-generation ownership ──');
ctx.extensionSettings.scenepulse.injectionMethod='separate';
ctx.extensionSettings.scenepulse.autoGenerate=true;
let providerCalls=0;
ctx.generateRawData=async()=>{providerCalls++;return'{}'};
globalThis.setTimeout=(callback,ms)=>{
    if(ms===4000){ctx.chat[1].swipe_id=0;ctx.chat[1].mes=ctx.chat[1].swipes[0]}
    callback();return 1;
};
const{onCharMsg}=await import('../src/ui/message.js');
await onCharMsg(1);
eq('timer captured the original swipe and discarded stale work',providerCalls,0);

console.log(`\n${fail===0?'PASS':'FAIL'} ${pass}/${pass+fail}`);
if(fail)process.exit(1);
