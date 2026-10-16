import assert from 'node:assert/strict';
import {getActiveModelId,findMatchingPreset,BUILT_IN_PRESETS,buildPresetPatch} from '../src/presets/registry.js';
let ctx={mainApi:'textgenerationwebui',chatCompletionSettings:{chat_completion_source:'openai',openai_model:'gpt-stale'},textCompletionSettings:{model:'local/current'}};
globalThis.SillyTavern={getContext:()=>ctx};
globalThis.document={querySelectorAll:()=>[],getElementById:()=>null};
assert.equal(getActiveModelId(),'local/current');
ctx={mainApi:'openai',getChatCompletionModel:()=> 'native/current',chatCompletionSettings:{chat_completion_source:'unknown',openai_model:'stale'}};
assert.equal(getActiveModelId(),'native/current');
delete ctx.getChatCompletionModel;
assert.equal(getActiveModelId(),'','unknown source must not borrow another provider');
ctx.chatCompletionSettings.unknown_model='future/model';
assert.equal(getActiveModelId(),'future/model');
ctx.chatCompletionSettings={chat_completion_source:'openrouter',openrouter_model:'',openai_model:'stale'};
assert.equal(getActiveModelId(),'');
ctx={chatCompletionSettings:{openai_model:'A',claude_model:'B'}};
assert.equal(getActiveModelId(),'','ambiguous legacy settings are not evidence of active model');
ctx={mainApi:'kobold',chatCompletionSettings:{openai_model:'stale'},textCompletionSettings:{model:'stale-text'}};
assert.equal(getActiveModelId(),'');
ctx={mainApi:'openai',getChatCompletionModel(){throw new Error('unavailable')},chatCompletionSettings:{chat_completion_source:'deepseek',deepseek_model:'active'}};
assert.equal(getActiveModelId(),'active');
const a={id:'test-longest',matchPatterns:['test','test-specific-long']};
const b={id:'test-shorter',matchPatterns:['test-specific']};
BUILT_IN_PRESETS.push(a,b);
try{assert.equal(findMatchingPreset('test-specific-long').id,a.id)}finally{BUILT_IN_PRESETS.splice(-2)}
const patch=buildPresetPatch({...a,promptOverrides:{role:'Rules'},samplerHints:{temperature:0.1},contextWindow:42,promptMode:'native'},{promptMode:'json'});
assert.deepEqual(Object.keys(patch).sort(),['promptOverrides','systemPromptRole']);
for(const preset of BUILT_IN_PRESETS)for(const pattern of preset.matchPatterns){
 assert.equal(findMatchingPreset(pattern)?.id,preset.id,`bundled alias ${pattern}`);
}
console.log('preset-selection: passed');
