import { buildDynamicSchema, buildRequestSchema } from '../src/schema.js';
import { cleanJson, parseTrackerCandidate } from '../src/generation/extraction.js';
import { validateExtraction } from '../src/generation/validation.js';
import { buildRecentContext, classifyRequestError, computeResponseLength, correctiveInstruction, requestTracker } from '../src/generation/request.js';

let pass=0,fail=0;
function eq(name,actual,expected){const a=JSON.stringify(actual),e=JSON.stringify(expected);if(a===e){pass++;console.log('  OK   '+name)}else{fail++;console.log('  FAIL '+name+' — expected '+e+', got '+a)}}
function code(fn){try{fn();return''}catch(e){return e.code||''}}

console.log('\n── Mode-aware request schemas ──');
const source={name:'Test',strict:true,value:{type:'object',properties:{time:{type:'string'},date:{type:'string'},elapsed:{type:'string'},sceneSummary:{type:'string'},charactersPresent:{type:'array',items:{type:'string'}},witnesses:{type:'array',items:{type:'string'}},plotBranches:{type:'array',items:{type:'object',properties:{type:{type:'string'}},required:['type']}}},required:['time','date','elapsed','sceneSummary','charactersPresent','witnesses','plotBranches']}};
const before=JSON.stringify(source);
const full=buildRequestSchema(source,{mode:'full'});
const delta=buildRequestSchema(source,{mode:'delta'});
const section=buildRequestSchema(source,{mode:'section',fields:['sceneSummary','witnesses']});
eq('full keeps all required fields',full.value.required,source.value.required);
eq('delta requires only stable delta anchors',delta.value.required,['time','date','elapsed','plotBranches','charactersPresent','witnesses']);
eq('section exposes only requested properties',Object.keys(section.value.properties),['sceneSummary','witnesses']);
eq('section requires every requested property',section.value.required,['sceneSummary','witnesses']);
eq('request schema is non-mutating',JSON.stringify(source),before);
eq('structured output preserves invalid raw response',full.returnInvalid,true);
const dynamic=buildDynamicSchema({panels:{},customPanels:[]});
eq('dynamic schema keeps elapsed operational field',Object.hasOwn(dynamic.properties,'elapsed'),true);
eq('dynamic schema keeps temporal intent field',Object.hasOwn(dynamic.properties,'temporalIntent'),true);
const withoutIdeas=buildDynamicSchema({panels:{dashboard:true,scene:true,quests:true,relationships:true,characters:true,storyIdeas:false},customPanels:[]});
eq('disabled story ideas are excluded from generation schema',Object.hasOwn(withoutIdeas.properties,'plotBranches'),false);

console.log('\n── Candidate selection and blocking validation ──');
const tracker='{"time":"10:00","date":"Tuesday","sceneSummary":"real","charactersPresent":[],"witnesses":[]}';
eq('best tracker wins over earlier unrelated JSON',parseTrackerCandidate('preface {"note":"not the tracker"}\n'+tracker,{mode:'full',knownKeys:Object.keys(source.value.properties)}).sceneSummary,'real');
eq('schema echo loses to tracker data',parseTrackerCandidate('{"type":"object","properties":{"time":{"type":"string"}}}\n'+tracker,{mode:'full',knownKeys:Object.keys(source.value.properties)}).sceneSummary,'real');
eq('custom schema keys guide candidate selection',parseTrackerCandidate('{"note":"'+('x'.repeat(500))+'"}\n{"customMood":"focused"}',{mode:'section',knownKeys:['customMood']}).customMood,'focused');
eq('truncated outer tracker is not replaced by a nested object',code(()=>cleanJson('{"characters":[{"name":"Alice"}]')),'TRUNCATED');
eq('truncated outer tracker rejects known-key inner fragment',code(()=>cleanJson('{"characters":[{"sceneSummary":"fragment","time":"10:00","date":"Tuesday","witnesses":[],"charactersPresent":[]}]')),'TRUNCATED');
const invalid=validateExtraction({sceneSummary:'only one field'},{schema:section.value});
eq('missing section field blocks persistence',invalid.valid,false);
eq('missing section field is an error',invalid.errors.some(item=>item.includes('witnesses')),true);
const valid=validateExtraction({sceneSummary:'Complete',witnesses:[]},{schema:section.value});
eq('valid section passes',valid.valid,true);
const nearMiss={
    time:'14:32:15',date:'03/17/2025 (Monday)',elapsed:'00:07:23',
    sceneSummary:'Alex is alone in the recovery room.',
    charactersPresent:[],
    characters:[{name:'Mash Kyrielight',inventory:'Medical tablet'}],
};
const nearMissSchema={type:'object',properties:{time:{type:'string'},date:{type:'string'},elapsed:{type:'string'},sceneSummary:{type:'string'},charactersPresent:{type:'array',items:{type:'string'}},witnesses:{type:'array',items:{type:'string'}},characters:{type:'array',items:{type:'object',properties:{name:{type:'string'},inventory:{type:'array',items:{type:'string'}}},required:['name','inventory']}}},required:['time','date','elapsed','sceneSummary','charactersPresent','witnesses','characters']};
const nearMissValidation=validateExtraction(nearMiss,{schema:nearMissSchema});
eq('full tracker defaults missing witnesses',nearMissValidation.valid,true);
eq('missing witnesses becomes empty array',nearMiss.witnesses,[]);
eq('string inventory becomes array',nearMiss.characters[0].inventory,['Medical tablet']);
eq('JSON Schema integer accepts a JS integer',validateExtraction({score:42},{schema:{type:'object',properties:{score:{type:'integer'}},required:['score']}}).valid,true);
eq('JSON Schema integer rejects a fraction',validateExtraction({score:4.2},{schema:{type:'object',properties:{score:{type:'integer'}},required:['score']}}).valid,false);
const intentSchema={type:'object',properties:{temporalIntent:{type:'string',enum:['continue','flashback','timeSkip','parallel']}}};
const aliasedIntent={temporalIntent:'time_skip'};
const aliasedValidation=validateExtraction(aliasedIntent,{schema:intentSchema});
eq('optional temporal intent alias is normalized',aliasedIntent.temporalIntent,'timeSkip');
eq('normalized temporal intent remains valid',aliasedValidation.valid,true);
const unknownIntent={temporalIntent:'normal progression'};
const unknownValidation=validateExtraction(unknownIntent,{schema:intentSchema});
eq('unsupported optional temporal intent is omitted',Object.hasOwn(unknownIntent,'temporalIntent'),false);
eq('unsupported optional temporal intent does not trigger a retry',unknownValidation.valid,true);
eq('unsupported optional temporal intent leaves a warning',unknownValidation.warnings.length,1);

console.log('\n── Bounded context, transport, budget, retry policy ──');
const chat=[0,1,2,3,4].map(i=>({is_user:i%2===0,name:'NPC',mes:'message-'+i}));
const recent=buildRecentContext(chat,2,3);
eq('context ends at target message',recent.recent.map(item=>item.mes),['message-2','message-3']);
eq('later chat content is excluded',recent.text.includes('message-4'),false);
eq('each selected message is included once',(recent.text.match(/message-3/g)||[]).length,1);
eq('full output has safe minimum',computeResponseLength({mode:'full'}),4096);
eq('delta output has safe minimum',computeResponseLength({mode:'delta'}),2048);
eq('large snapshot budget is capped',computeResponseLength({mode:'full',previousSnapshot:{text:'x'.repeat(40000)}}),8192);
eq('truncation increases budget',computeResponseLength({mode:'delta',attempt:1,lastErrorCode:'TRUNCATED'})>2048,true);
eq('429 is not retried',classifyRequestError(new Error('HTTP 429 rate limit')).retryable,false);
eq('numeric 429 status is not retried',classifyRequestError({status:429,message:'request failed'}).kind,'rate_limit');
eq('503 is retried',classifyRequestError(new Error('HTTP 503 upstream')).retryable,true);
const aborted=new Error('timeout while stopping');aborted.name='AbortError';
eq('an aborted timeout is not retried',classifyRequestError(aborted).kind,'cancelled');
eq('semantic correction contains errors',correctiveInstruction('SEMANTIC_INVALID',['missing time']).includes('missing time'),true);

let rawDataArgs=null,rawDataCalls=0,quietArgs=null;
const stContext={
    async generateRawData(args){rawDataCalls++;rawDataArgs=args;return tracker},
    async generateQuietPrompt(args){quietArgs=args;return tracker},
};
const response=await requestTracker({stContext,systemPrompt:'SYSTEM',prompt:'USER',responseLength:4096,jsonSchema:full,promptMode:'native'});
eq('quiet transport has priority',response.strategy,'quiet');
eq('raw-data path is not duplicated',rawDataCalls,0);
eq('quiet prompt carries system text',quietArgs.quietPrompt.includes('SYSTEM'),true);
eq('quiet prompt carries user text',quietArgs.quietPrompt.includes('USER'),true);
eq('quiet native schema is forwarded',quietArgs.jsonSchema?.returnInvalid,true);
eq('quiet response budget is forwarded',quietArgs.responseLength,4096);
await requestTracker({stContext:{async generateRawData(args){rawDataArgs=args;return tracker}},systemPrompt:'SYSTEM',prompt:'USER',responseLength:4096,jsonSchema:full,promptMode:'native'});
eq('system prompt is passed separately',rawDataArgs.systemPrompt,'SYSTEM');
eq('native schema is forwarded',rawDataArgs.jsonSchema?.returnInvalid,true);
eq('response budget is forwarded',rawDataArgs.responseLength,4096);
await requestTracker({stContext:{async generateQuietPrompt(args){quietArgs=args;return tracker}},systemPrompt:'SYSTEM',prompt:'USER',responseLength:2048});
eq('legacy quiet transport skips World Info activation',quietArgs.skipWIAN,true);

console.log(`\n${fail===0?'PASS':'FAIL'} ${pass}/${pass+fail}`);
if(fail)process.exit(1);
