// Production helper coverage for issue #16: the selected profile role must
// affect both separate-mode generateRaw arguments and Together-mode messages.

const { applyPromptRole, promptRoleFlags } = await import('../src/prompts/role.js');

let pass=0,fail=0;
function assertEq(name,actual,expected){
    const a=JSON.stringify(actual),e=JSON.stringify(expected);
    if(a===e){pass++;console.log('  OK   '+name)}
    else{fail++;console.log('  FAIL '+name+' — expected '+e+', got '+a)}
}

console.log('\nissue #16 — prompt role routing');

assertEq('system flags',promptRoleFlags('system'),{is_user:false,is_system:true,name:'System'});
assertEq('user flags',promptRoleFlags('user'),{is_user:true,is_system:false,name:'ScenePulse'});
assertEq('assistant flags',promptRoleFlags('assistant'),{is_user:false,is_system:false,name:'Assistant'});

assertEq('system generateRaw pair unchanged',applyPromptRole({systemPrompt:'SYS',prompt:'USER'},'system'),{
    systemPrompt:'SYS',prompt:'USER',
});
const userPair=applyPromptRole({systemPrompt:'SYS',prompt:'USER'},'user');
assertEq('user role clears system slot',userPair.systemPrompt,'');
assertEq('user role prepends instructions',userPair.prompt,'SYS\n\n---\n\nUSER');
const assistantPair=applyPromptRole({systemPrompt:'SYS',prompt:'USER'},'assistant');
assertEq('assistant role clears system slot',assistantPair.systemPrompt,'');
assertEq('assistant role keeps both texts',assistantPair.prompt.includes('SYS')&&assistantPair.prompt.endsWith('USER'),true);

console.log(`${fail===0?'PASS':'FAIL'} ${pass}/${pass+fail}`);
if(fail)process.exit(1);
