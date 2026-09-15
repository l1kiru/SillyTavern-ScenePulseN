// Character-scoped custom panels — schema, prompt, normalization and delta merge.

const _ctx = {
    name1: 'Alex', name2: 'Jenna',
    characters: [], groups: [], groupId: null, selected_group: null,
    chatMetadata: { scenepulse: { snapshots: {}, chatPanels: [] } },
    extensionSettings: { scenepulse: {} },
    saveMetadata: () => {}, saveSettingsDebounced: () => {},
};
globalThis.SillyTavern = { getContext: () => _ctx };
globalThis.window = { innerWidth: 1280, innerHeight: 720 };
globalThis.toastr = { error: () => {}, warning: () => {}, info: () => {}, success: () => {} };
if (typeof document === 'undefined') {
    globalThis.document = {
        createElement: () => ({ style: {} }),
        body: { dataset: {}, appendChild: () => {}, addEventListener: () => {} },
        querySelector: () => null, querySelectorAll: () => [],
        getElementById: () => null,
    };
}
if (typeof localStorage === 'undefined') {
    globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}

const { buildDynamicSchema, buildRequestSchema } = await import('../src/schema.js');
const { assemblePrompt } = await import('../src/prompts/assembler.js');
const { normalizeChar } = await import('../src/normalize.js');
const { mergeDelta } = await import('../src/generation/delta-merge.js');
const { processExtraction } = await import('../src/generation/pipeline.js');
const {
    captureCharacterCustomFieldSpecs,
    captureTrackerStructure,
    clearForceFullState,
    forceFullStateRefresh,
    getLatestSnapshot,
    getPanelActivationStrategy,
    getSettings,
    getSnapshotFor,
    invalidateSettingsCache,
    reconcileLatestCustomPanelValues,
    reconcileTrackerStructureChange,
    rearmForceFullAfterFailedFullRun,
    sanitizeCharacterCustomFields,
    saveSettings,
    saveSnapshot,
    setPanelActivationStrategy,
    shouldUseDelta,
} = await import('../src/settings.js');
const { DEFAULTS } = await import('../src/constants.js');
const { makeProfile, updateActiveProfile } = await import('../src/profiles.js');
const { processTogetherExtraction, _setTogetherProcessExtractionForTests } = await import('../src/generation/together-scene-build.js');

let pass = 0, fail = 0;
function ok(name, value) {
    if (value) { pass++; console.log('  OK   ' + name); }
    else { fail++; console.log('  FAIL ' + name); }
}
function eq(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    ok(`${name} — expected ${e}, got ${a}`, a === e);
}

const globalPanel = {
    id: 'cp_global', name: 'Global State', scope: 'global', enabled: true,
    fields: [{ key: 'status', label: 'Status', type: 'text', desc: 'Overall story status.' }],
};
const characterPanel = {
    id: 'cp_character', name: 'Character State', scope: 'character', enabled: true,
    fields: [
        { key: 'disposition', label: 'Disposition', type: 'text', desc: 'Current state of this character.' },
        { key: 'threat', label: 'Threat', type: 'meter', desc: 'Threat posed by this character.' },
        { key: 'traits', label: 'Traits', type: 'list', desc: 'Relevant current traits.' },
        { key: 'rank', label: 'Rank', type: 'number', desc: 'Current integer rank.' },
        { key: 'alert', label: 'Alert', type: 'enum', desc: 'Alert state.', options: ['low', 'high'] },
    ],
};
_ctx.chatMetadata.scenepulse.chatPanels = [globalPanel, characterPanel];

const settings = {
    panels: {
        dashboard: false, scene: false, quests: false,
        relationships: false, characters: true, storyIdeas: false,
    },
    fieldToggles: {}, dashCards: {}, deltaMode: false,
};

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Character-scoped custom panels');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

console.log('\n── Dynamic schema ──');
{
    const schema = buildDynamicSchema(settings);
    ok('global custom field remains at root', Object.hasOwn(schema.properties, 'status'));
    ok('character custom field is nested', Object.hasOwn(schema.properties.characters.items.properties, 'disposition'));
    ok('reserved alias is not nested', !Object.hasOwn(schema.properties.characters.items.properties, 'status'));
    ok('meter constraints are nested', schema.properties.characters.items.properties.threat.maximum === 100);
    ok('global field stays required', schema.required.includes('status'));
    ok('full dynamic schema requires character custom fields', schema.properties.characters.items.required.includes('disposition'));
    ok('built-in character property is not overwritten', schema.properties.characters.items.properties.name.type === 'string');
    const full=buildRequestSchema({value:schema},{mode:'full'}).value;
    const delta=buildRequestSchema({value:schema},{mode:'delta'}).value;
    ok('full request requires character custom fields', full.properties.characters.items.required.includes('disposition'));
    ok('delta request makes character custom fields optional', !delta.properties.characters.items.required.includes('disposition'));
}

console.log('\n── Prompt placement ──');
{
    const prompt = assemblePrompt(settings, null, {});
    const charStart = prompt.indexOf('### Characters');
    const charEnd = prompt.indexOf('### Custom Tracked Fields');
    const customStart = charEnd;
    ok('characters section exists', charStart >= 0);
    ok('global custom section exists', customStart > charStart);
    const charBlock = prompt.slice(charStart, charEnd);
    const globalBlock = prompt.slice(customStart);
    ok('character field is described inside Characters', charBlock.includes('- threat: Threat posed by this character.'));
    ok('character panel marker is included', charBlock.includes('[custom panel: Character State]'));
    ok('global panel field remains in Custom Tracked Fields', globalBlock.includes('#### Global State') && globalBlock.includes('- status: Overall story status.'));
    ok('character panel is not emitted as a top-level custom section', !globalBlock.includes('#### Character State'));

    const runtimePrompt = assemblePrompt({ ...settings, runtimeActivePanelIds: ['cp_character'] }, null, {});
    ok('runtime prompt includes active character panel', runtimePrompt.includes('[custom panel: Character State]'));
    ok('runtime prompt omits inactive global panel', !runtimePrompt.includes('#### Global State'));

    const disabled={...settings,panels:{...settings.panels,characters:false}};
    const disabledSchema=buildDynamicSchema(disabled);
    const disabledPrompt=assemblePrompt(disabled,null,{});
    ok('disabled Characters removes characters from schema',!Object.hasOwn(disabledSchema.properties,'characters'));
    ok('disabled Characters removes custom character fields from Separate prompt',!disabledPrompt.includes('- threat: Threat posed by this character.'));
}

console.log('\n── Character normalization ──');
{
    const out = normalizeChar({
        name: 'Jenna', role: 'Ally', disposition: 'Wary', threat: 37,
        traits: ['injured', 'alert'], nested_state: { bad: true },
    });
    eq('custom text survives normalization', out.disposition, 'Wary');
    eq('custom number survives normalization', out.threat, 37);
    eq('custom string list survives normalization', out.traits, ['injured', 'alert']);
    ok('unsupported nested object is dropped', !Object.hasOwn(out, 'nested_state'));
    const alias = normalizeChar({ name: 'Jenna', status: 'Wary' });
    ok('reserved status alias is not preserved as custom data', !Object.hasOwn(alias, 'status'));
    eq('legacy status alias still maps only to fertility', alias.fertStatus, 'Wary');

    const legacy={characters:[{
        name:'Jenna',
        inner_thought:'Keep calm.',
        condition:'injured',
        items:['knife'],
        fertilityTracker:{status:'active'},
        disposition:'Wary',
    }]};
    const frozenSpecs=captureCharacterCustomFieldSpecs();
    sanitizeCharacterCustomFields(legacy,{
        customFieldSpecs:frozenSpecs,
        preserveAliases:true,
    });
    const normalized=normalizeChar(legacy.characters[0]);
    eq('sanitizer preserves inner_thought for normalization',normalized.innerThought,'Keep calm.');
    eq('sanitizer preserves condition for normalization',normalized.posture,'injured');
    eq('sanitizer preserves items for normalization',normalized.inventory,['knife']);
    eq('sanitizer preserves nested fertility alias for normalization',normalized.fertStatus,'active');
    eq('frozen custom field survives pre-normalization sanitizer',normalized.disposition,'Wary');
}

console.log('\n── Delta merge ──');
{
    const prev = { characters: [{ name: 'Jenna', role: 'Ally', disposition: 'Wary', threat: 37, traits: ['injured'] }] };
    const delta = { characters: [{ name: 'Jenna', innerThought: 'Stay calm.' }] };
    const merged = mergeDelta(prev, delta);
    const ch = merged.characters[0];
    eq('custom text carries forward', ch.disposition, 'Wary');
    eq('custom meter carries forward', ch.threat, 37);
    eq('custom list carries forward', ch.traits, ['injured']);
    eq('new built-in field merges normally', ch.innerThought, 'Stay calm.');
}

console.log('\n── Persistence and structural transitions ──');
{
    const crowded={characters:[{name:'Jenna',...Object.fromEntries(Array.from({length:70},(_,i)=>[`unknown_${i}`,'x'])),disposition:'Wary'}]};
    sanitizeCharacterCustomFields(crowded);
    eq('configured fields survive unknown-property crowding',normalizeChar(crowded.characters[0]).disposition,'Wary');

    saveSnapshot(7,{
        characters:[{
            name:'Jenna',role:'Ally',disposition:'Wary',threat:37,
            traits:['injured'],rank:2,alert:'high',unknown_value:'drop me',
        }],
    });
    const stored=getSnapshotFor(7).characters[0];
    eq('configured text is persisted',stored.disposition,'Wary');
    eq('configured integer is persisted',stored.rank,2);
    ok('unknown primitive is dropped before persistence',!Object.hasOwn(stored,'unknown_value'));

    saveSnapshot(8,{
        characters:[{
            name:'Jenna',role:'Ally',disposition:42,threat:101,
            traits:['valid',3],rank:1.5,alert:'invalid',
        }],
    });
    const invalid=getSnapshotFor(8).characters[0];
    for(const key of['disposition','threat','traits','rank','alert']){
        ok(`invalid ${key} value is dropped`,!Object.hasOwn(invalid,key));
    }

    saveSnapshot(9,{
        characters:[{
            name:'Jenna',role:'Ally',disposition:'Wary',threat:37,
            traits:['injured'],rank:2,alert:'high',
        }],
    });
    const previous=structuredClone(_ctx.chatMetadata.scenepulse.chatPanels);
    const next=structuredClone(previous);
    next[1].fields.find(field=>field.key==='disposition').key='mood_state';
    next[1].fields.find(field=>field.key==='threat').type='number';
    reconcileLatestCustomPanelValues(previous,next);
    const current=getLatestSnapshot().characters[0];
    ok('renamed field is removed from current snapshot',!Object.hasOwn(current,'disposition'));
    ok('type-changed field is removed from current snapshot',!Object.hasOwn(current,'threat'));
    eq('unchanged field remains in current snapshot',current.traits,['injured']);
    eq('historical snapshot is not rewritten',getSnapshotFor(7).characters[0].disposition,'Wary');

    saveSnapshot(91,{
        characters:[
            {name:'Jenna',gender:'female',role:'Ally',disposition:'Wary',traits:['keep']},
            {name:'Bob',gender:'male',role:'Guard',disposition:'Neutral',traits:['drop']},
        ],
    });
    const audiencePrev=structuredClone(_ctx.chatMetadata.scenepulse.chatPanels);
    const audienceNext=structuredClone(audiencePrev);
    audiencePrev[1].audience={};
    audienceNext[1].audience={genders:['female']};
    reconcileLatestCustomPanelValues(audiencePrev,audienceNext);
    const audienceSnap=getLatestSnapshot();
    eq('audience tightening preserves still-matching value',audienceSnap.characters[0].traits,['keep']);
    ok('audience tightening removes only non-matching value',!Object.hasOwn(audienceSnap.characters[1],'traits'));

    const root=getSettings();
    root.deltaMode=true;
    ok('delta is available before structural refresh',shouldUseDelta(getLatestSnapshot()));
    forceFullStateRefresh();
    ok('forced refresh disables delta for the next generation',!shouldUseDelta(getLatestSnapshot()));
    clearForceFullState();

    saveSnapshot(10,{
        characters:[{name:'Jenna',role:'Ally',disposition:'Wary',threat:37}],
    });
    const beforeActivationEdit=captureTrackerStructure();
    _ctx.chatMetadata.scenepulse.chatPanels[1].activationMode='auto';
    _ctx.chatMetadata.scenepulse.chatPanels[1].activationTags=['combat'];
    ok('activation policy edit is a request-shape change',reconcileTrackerStructureChange(beforeActivationEdit));
    eq('activation policy edit preserves stored values',getLatestSnapshot().characters[0].disposition,'Wary');
    clearForceFullState();
    root.injectionMethod='separate';
    root.parallelFullGeneration=true;
    const beforeStrategyEdit=captureTrackerStructure();
    setPanelActivationStrategy('automatic');
    eq('chat-local activation strategy overrides the global default',getPanelActivationStrategy(root),'automatic');
    ok('chat activation strategy edit is a request-shape change',reconcileTrackerStructureChange(beforeStrategyEdit));
    eq('chat activation strategy edit preserves stored values',getLatestSnapshot().characters[0].disposition,'Wary');
    clearForceFullState();
    const beforeDisable=captureTrackerStructure();
    _ctx.chatMetadata.scenepulse.chatPanels[1].enabled=false;
    ok('shared lifecycle detects custom-panel toggle',reconcileTrackerStructureChange(beforeDisable));
    const disabledCharacter=getLatestSnapshot().characters[0];
    ok('disabling panel clears its live character values',!Object.hasOwn(disabledCharacter,'disposition'));
    ok('structural lifecycle forces the following generation to full state',!shouldUseDelta(getLatestSnapshot()));

    clearForceFullState();
    const beforeEnable=captureTrackerStructure();
    _ctx.chatMetadata.scenepulse.chatPanels[1].enabled=true;
    ok('shared lifecycle detects panel re-enable',reconcileTrackerStructureChange(beforeEnable));
    ok('re-enabling panel also forces a full refresh',!shouldUseDelta(getLatestSnapshot()));
    clearForceFullState();
}

console.log('\n── In-flight Together lifecycle ──');
{
    // A structural edit made after request start must survive a late failed
    // extraction and force the following turn to full state.
    forceFullStateRefresh();
    const result=await processExtraction(50,{},'auto:together',{
        frozenDeltaMode:true,
        frozenRequestSchema:{
            type:'object',
            properties:{required_value:{type:'string'}},
            required:['required_value'],
            additionalProperties:false,
        },
        frozenCharacterCustomFieldSpecs:captureCharacterCustomFieldSpecs(),
    });
    eq('invalid frozen-schema extraction is rejected',result,null);
    ok('late extraction does not clear a newer force-full request',!shouldUseDelta(getLatestSnapshot()));
    clearForceFullState();
}

console.log('\n── Force-full survives failed full run ──');
{
    const root=getSettings();
    root.deltaMode=true;
    forceFullStateRefresh();
    ok('force-full armed before consume',!shouldUseDelta(getLatestSnapshot()));
    clearForceFullState();
    ok('consume allows delta again',shouldUseDelta(getLatestSnapshot()));
    rearmForceFullAfterFailedFullRun(false);
    ok('failed full run rearms force-full',!shouldUseDelta(getLatestSnapshot()));

    clearForceFullState();
    forceFullStateRefresh();
    clearForceFullState();
    forceFullStateRefresh(); // mid-flight structural re-arm after a delta decision
    rearmForceFullAfterFailedFullRun(true);
    ok('failed delta run does not clear mid-flight force-full',!shouldUseDelta(getLatestSnapshot()));
    clearForceFullState();

    _setTogetherProcessExtractionForTests(async()=>null);
    try{
        forceFullStateRefresh();
        clearForceFullState(); // interceptor already consumed for this Together full run
        const togetherResult=await processTogetherExtraction(51,{},'auto:together',{frozenDeltaMode:false});
        eq('Together pipeline null result',togetherResult,null);
        ok('Together failed full rearms force-full',!shouldUseDelta(getLatestSnapshot()));
    }finally{
        _setTogetherProcessExtractionForTests(null);
        clearForceFullState();
    }
}


console.log('\n── Frozen snapshot field contracts ──');
{
 const beforePanels=structuredClone(_ctx.chatMetadata.scenepulse.chatPanels);
 _ctx.chatMetadata.scenepulse.chatPanels=[{id:'cp_frozen',name:'Frozen',scope:'character',audience:{genders:['female']},fields:[{key:'injury_state',type:'text',label:'Injury'}]}];
 const specs=captureCharacterCustomFieldSpecs();
 const schema={type:'object',properties:{characters:{type:'array',items:{type:'object',properties:{name:{type:'string'},gender:{type:'string'},injury_state:{type:'string'}},required:['name','gender']}}},required:['characters']};
 const result=await processExtraction(11,{characters:[{name:'Alice',gender:'female',injury_state:'Arm wound'}]},'auto:together',{
  frozenDeltaMode:false,frozenRequestSchema:schema,
  frozenCharacterCustomFieldSpecs:specs,
  baseSnapshot:{characters:[{name:'Alice',gender:'female'},{name:'Beth',gender:'female'}]},
 });
 ok('Together Full validates current characters before archived off-scene fields',result!==null);
 ok('Together Full keeps archived character',result?.characters.some(c=>c.name==='Beth'));
 _ctx.chatMetadata.scenepulse.chatPanels=[];
 const frozen={characters:[{name:'Alice',gender:'female',injury_state:'Arm wound'}]};
 saveSnapshot(12,frozen,0,{customFieldSpecs:specs});
 eq('saving an in-flight result uses its frozen field contract',frozen.characters[0].injury_state,'Arm wound');
 const edited={characters:[{name:'Alice',injury_state:'Arm wound'}]};
 saveSnapshot(13,edited,0);
 ok('ordinary edits still use current field contracts',!Object.hasOwn(edited.characters[0],'injury_state'));
 _ctx.chatMetadata.scenepulse.chatPanels=beforePanels;
}

console.log('\n── Full refresh ownership ──');
{
 const s=getSettings();s.deltaMode=true;
 const snap={_spMeta:{deltaTurnsSinceFull:0}};
 _ctx.chatId='owner-a';forceFullStateRefresh();const old=clearForceFullState();
 _ctx.chatId='owner-b';clearForceFullState();rearmForceFullAfterFailedFullRun(false,old);
 ok('failed old chat does not force full in new chat',shouldUseDelta(snap));
 _ctx.chatId='owner-a';ok('returning to original chat retains full debt',!shouldUseDelta(snap));
 const stale=clearForceFullState();clearForceFullState();rearmForceFullAfterFailedFullRun(false,stale);
 ok('older completion cannot rearm after newer operation',shouldUseDelta(snap));
 forceFullStateRefresh();const edit=clearForceFullState();forceFullStateRefresh();rearmForceFullAfterFailedFullRun(false,edit);
 ok('mid-flight edit retains its new full debt',!shouldUseDelta(snap));
 clearForceFullState();delete _ctx.chatId;
 const savedMethod=s.injectionMethod,savedParallel=s.parallelFullGeneration;
 setPanelActivationStrategy('automatic');s.injectionMethod='inline';
 eq('Together uses manual panels when automatic routing unavailable',getPanelActivationStrategy(s),'manual');
 s.injectionMethod='separate';s.parallelFullGeneration=false;
 eq('Separate without parallel uses manual panels',getPanelActivationStrategy(s),'manual');
 s.parallelFullGeneration=true;
 eq('automatic preference resumes with parallel transport',getPanelActivationStrategy(s),'automatic');
 s.injectionMethod=savedMethod;s.parallelFullGeneration=savedParallel;
}

console.log('\n── Reset / template structure reconcile ──');
{
    const root=getSettings();
    root.deltaMode=true;
    const rich=makeProfile({
        name:'Rich',
        panels:{dashboard:false,scene:false,quests:false,relationships:false,characters:true,storyIdeas:false},
        customPanels:[structuredClone(characterPanel)],
    });
    root.profiles=[rich];
    root.activeProfileId=rich.id;
    delete _ctx.chatMetadata.scenepulse.chatPanels;
    invalidateSettingsCache();

    saveSnapshot(12,{characters:[{name:'Jenna',role:'Ally',disposition:'Wary',threat:37}]});
    const beforeReset=captureTrackerStructure();
    _ctx.extensionSettings.scenepulse=structuredClone(DEFAULTS);
    saveSettings();
    ok('reset-like structure change reconciles',reconcileTrackerStructureChange(beforeReset));
    ok('reset clears stale character custom fields',!Object.hasOwn(getLatestSnapshot().characters[0],'disposition'));
    ok('reset forces full state',!shouldUseDelta(getLatestSnapshot()));
    clearForceFullState();

    // Restore chat panels for template switch (profile-owned panels already wiped).
    _ctx.chatMetadata.scenepulse.chatPanels=[structuredClone(globalPanel),structuredClone(characterPanel)];
    const s=getSettings();
    if(!Array.isArray(s.profiles)||!s.profiles.length){
        const seed=makeProfile({name:'Seed'});
        s.profiles=[seed];
        s.activeProfileId=seed.id;
    }
    invalidateSettingsCache();
    const beforeTemplate=captureTrackerStructure();
    const empty=makeProfile({name:'From Template',promptOverrides:{role:'x'}});
    s.profiles.push(empty);
    s.activeProfileId=empty.id;
    ok('empty-profile activate reconciles',reconcileTrackerStructureChange(beforeTemplate));
    ok('template activate forces full state',!shouldUseDelta(getLatestSnapshot()));
    clearForceFullState();

    const beforePrompt=captureTrackerStructure();
    updateActiveProfile(s,{promptOverrides:{role:'new'},systemPromptRole:'user'});
    ok('prompt-only patch does not reconcile',!reconcileTrackerStructureChange(beforePrompt));
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass}/${pass + fail}`);
if (fail) process.exit(1);
