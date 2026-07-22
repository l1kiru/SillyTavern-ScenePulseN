// Connection profile switches must be scoped to ScenePulse's own request.

const profileEl={
    value:'old-profile',
    dispatchEvent(){},
};

let setCalls=[];
let saveCalls=0;
const ctx={
    chat:[],
    chatMetadata:{scenepulse:{snapshots:{}}},
    extensionSettings:{scenepulse:{}},
    async saveChat(){saveCalls++},
    saveMetadata(){},
    saveSettingsDebounced(){},
    async setConnectionProfile(value){
        setCalls.push(value);
        profileEl.value=value;
    },
};

globalThis.SillyTavern={getContext:()=>ctx};
globalThis.localStorage={getItem:()=>null,setItem(){}};
globalThis.toastr={error(){},warning(){},info(){},success(){}};
globalThis.getComputedStyle=()=>({display:'none',visibility:'hidden'});
globalThis.document={
    createElement:()=>({
        style:{},dataset:{},classList:{add(){},remove(){},contains(){return false}},
        appendChild(){},addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[],
    }),
    body:{dataset:{},appendChild(){},addEventListener(){},classList:{add(){},remove(){}}},
    addEventListener(){},
    querySelector(selector){return selector==='#connection_profiles, #connection_profile'?profileEl:null},
    querySelectorAll:()=>[],
    getElementById:()=>null,
};
globalThis.window={addEventListener(){},innerWidth:1280,innerHeight:720};

const {withProfileAndPreset}=await import('../src/generation/engine.js');

let pass=0,fail=0;
function eq(name,actual,expected){
    const a=JSON.stringify(actual),e=JSON.stringify(expected);
    if(a===e){pass++;console.log('  OK   '+name)}
    else{fail++;console.log('  FAIL '+name+' — expected '+e+', got '+a)}
}

console.log('\n── Connection profile scoped switching ──');

let ran=false;
await withProfileAndPreset('', '', async()=>{ran=true});
eq('empty profile leaves SillyTavern profile alone',setCalls,[]);
eq('empty profile still runs callback',ran,true);
eq('empty profile does not force chat save',saveCalls,0);

ran=false;setCalls=[];saveCalls=0;profileEl.value='old-profile';
await withProfileAndPreset('tracker-profile', '', async()=>{
    ran=true;
    eq('callback sees tracker profile',profileEl.value,'tracker-profile');
});
eq('explicit profile runs callback',ran,true);
eq('explicit profile switches and restores through ST API',setCalls,['tracker-profile','old-profile']);
eq('explicit profile restores selector value',profileEl.value,'old-profile');
eq('explicit profile saves before switch and restore',saveCalls,2);

ran=false;setCalls=[];saveCalls=0;profileEl.value='old-profile';
ctx.setConnectionProfile=async value=>{
    setCalls.push(value);
    profileEl.value=value;
    if(value==='bad-profile')throw new Error('boom');
};
let failed=false;
try{await withProfileAndPreset('bad-profile', '', async()=>{ran=true})}catch{failed=true}
eq('failed profile switch rejects',failed,true);
eq('failed profile switch skips callback',ran,false);
eq('failed profile switch still restores',setCalls,['bad-profile','old-profile']);
eq('failed profile switch restores selector value',profileEl.value,'old-profile');

console.log(`\n${fail===0?'PASS':'FAIL'} ${pass}/${pass+fail}`);
process.exit(fail?1:0);
