// Production-module coverage for issue #10: transition cards must never stack
// or remain after their animation/fallback cleanup.

const ctx={
    extensionSettings:{scenepulse:{sceneTransitions:true}},
    chatMetadata:{scenepulse:{snapshots:{}}},
    saveSettingsDebounced:()=>{},saveMetadata:()=>{},
};
globalThis.SillyTavern={getContext:()=>ctx};
globalThis.toastr={warning:()=>{},error:()=>{},info:()=>{},success:()=>{}};

const elements=new Map();
const fallbackTimers=[];
globalThis.setTimeout=fn=>{fallbackTimers.push(fn);return fallbackTimers.length};

function element(){
    const listeners={};
    return {
        id:'',innerHTML:'',parentNode:null,offsetWidth:100,
        classList:{add:()=>{}},
        addEventListener:(name,fn)=>{listeners[name]=fn},
        dispatch:name=>listeners[name]?.(),
        remove(){if(this.id)elements.delete(this.id);this.parentNode=null},
    };
}
globalThis.document={
    createElement:()=>element(),
    getElementById:id=>elements.get(id)||null,
    body:{appendChild(el){el.parentNode=this;if(el.id)elements.set(el.id,el)}},
};

const state=await import('../src/state.js');
const { checkSceneTransition }=await import('../src/ui/scene-transition.js');

let pass=0,fail=0;
function assertEq(name,actual,expected){
    if(actual===expected){pass++;console.log('  OK   '+name)}
    else{fail++;console.log('  FAIL '+name+' — expected '+JSON.stringify(expected)+', got '+JSON.stringify(actual))}
}

console.log('\nissue #10 — scene transition cleanup');

state.setPrevLocation('Office');state.setPrevTimePeriod('morning');
checkSceneTransition({location:'Park > Lake',time:'18:00'});
const first=document.getElementById('sp-scene-transition');
assertEq('first transition created',!!first,true);

checkSceneTransition({location:'Home',time:'22:00'});
const second=document.getElementById('sp-scene-transition');
assertEq('new transition replaces old card',first.parentNode,null);
assertEq('replacement card is active',second!==first&&!!second.parentNode,true);

second.dispatch('animationend');
assertEq('animationend removes card',document.getElementById('sp-scene-transition'),null);

state.setPrevLocation('Home');state.setPrevTimePeriod('night');
checkSceneTransition({location:'Station',time:'08:00'});
const third=document.getElementById('sp-scene-transition');
for(const fn of fallbackTimers.splice(0))fn();
assertEq('fallback removes card if animation event is absent',third.parentNode,null);

console.log(`${fail===0?'PASS':'FAIL'} ${pass}/${pass+fail}`);
if(fail)process.exit(1);
