// Provider wrapper normalization and finish-reason coverage.

globalThis.SillyTavern={getContext:()=>({chat:[],chatMetadata:{},extensionSettings:{scenepulse:{}}})};
globalThis.localStorage={getItem:()=>null,setItem(){}};
const {normalizeProviderResponse}=await import('../src/generation/extraction.js');

let pass=0,fail=0;
function eq(name,actual,expected){const a=JSON.stringify(actual),e=JSON.stringify(expected);if(a===e){pass++;console.log('  OK   '+name)}else{fail++;console.log('  FAIL '+name+' — expected '+e+', got '+a)}}

console.log('\n── Provider response normalization ──');
eq('plain string',normalizeProviderResponse('{"time":"10:00"}'),{text:'{"time":"10:00"}',finishReason:''});
eq('OpenAI choice wrapper',normalizeProviderResponse({choices:[{message:{content:'{"time":"11:00"}'},finish_reason:'length'}]}),{text:'{"time":"11:00"}',finishReason:'length'});
eq('Anthropic content blocks',normalizeProviderResponse({content:[{type:'text',text:'{"time":'},{type:'text',text:'"12:00"}'}],stop_reason:'max_tokens'}),{text:'{"time":"12:00"}',finishReason:'max_tokens'});
eq('output_text wrapper',normalizeProviderResponse({output_text:'{"time":"13:00"}',finishReason:'stop'}),{text:'{"time":"13:00"}',finishReason:'stop'});
eq('Gemini candidate parts',normalizeProviderResponse({candidates:[{content:{parts:[{text:'{"time":'},{text:'"14:00"}'}]},finishReason:'MAX_TOKENS'}]}),{text:'{"time":"14:00"}',finishReason:'MAX_TOKENS'});
eq('text completion results',normalizeProviderResponse({results:[{text:'{"time":"15:00"}',finish_reason:'stop'}]}),{text:'{"time":"15:00"}',finishReason:'stop'});
eq('direct tracker object',normalizeProviderResponse({time:'16:00',sceneSummary:'Direct object'}),{text:'{"time":"16:00","sceneSummary":"Direct object"}',finishReason:''});

console.log(`\n${fail===0?'PASS':'FAIL'} ${pass}/${pass+fail}`);
if(fail)process.exit(1);
