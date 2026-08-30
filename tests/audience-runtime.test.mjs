const _ctx = {
    name1: 'Alex', name2: 'Kiara',
    characters: [], groups: [], groupId: null, selected_group: null,
    chatMetadata: { scenepulse: { snapshots: {}, swipeSnapshots: {}, chatPanels: [] } },
    extensionSettings: { scenepulse: {} },
    saveMetadata: () => {}, saveSettingsDebounced: () => {},
};
globalThis.SillyTavern = { getContext: () => _ctx };
globalThis.toastr = { error() {}, warning() {}, info() {}, success() {} };
if (typeof localStorage === 'undefined') {
    globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
}

const { buildDynamicPrompt, buildDynamicSchema, buildRequestSchema } = await import('../src/schema.js');
const { sanitizeCharacterCustomFields, invalidateSettingsCache, getSettings } = await import('../src/settings.js');
const { DEFAULTS } = await import('../src/constants.js');
const { validateCharacterAudienceRequirements } = await import('../src/generation/validation.js');

const s = getSettings();
Object.assign(s, structuredClone(DEFAULTS));
s.panels = { ...DEFAULTS.panels, characters: true };
s.fieldToggles = { ...s.fieldToggles, char_gender: false };
_ctx.chatMetadata.scenepulse.chatPanels = [{
    id: 'cp_female',
    name: 'Female state',
    scope: 'character',
    enabled: true,
    activationMode: 'always',
    activationTags: [],
    audience: { genders: ['female'] },
    fields: [{ key: 'female_state', label: 'Female state', type: 'text', desc: 'Only for women.' }],
}];
invalidateSettingsCache();

const dynamic = buildDynamicSchema(s);
if (!Object.hasOwn(dynamic.properties.characters.items.properties, 'gender')) {
    throw new Error('gender-targeted audience must force internal gender into the schema');
}
if (!(dynamic.properties.characters.items.required || []).includes('gender')) {
    throw new Error('gender-targeted audience must require internal gender even when visible Gender is off');
}
const prompt = buildDynamicPrompt(s);
if (!prompt.includes('- gender: female | male | nonbinary | ""')) {
    throw new Error('gender-targeted audience must keep gender instructions in the prompt');
}
const femaleRequired = dynamic.properties.characters.items.required || [];
if (femaleRequired.includes('female_state')) {
    throw new Error('dynamic schema must not require audience-targeted character fields');
}

const full = buildRequestSchema({ name: 'ScenePulse', value: dynamic }, { mode: 'full' });
const fullRequired = full.value.properties.characters.items.required || [];
if (fullRequired.includes('female_state')) {
    throw new Error(`Full request must not require female_state, got ${fullRequired.join(',')}`);
}

const delta = buildRequestSchema({ name: 'ScenePulse', value: dynamic }, { mode: 'delta' });
const deltaRequired = delta.value.properties.characters.items.required || [];
if (deltaRequired.includes('female_state')) {
    throw new Error('Delta request must not require female_state');
}

const audienceSpecs = [{
    key: 'female_state',
    field: { key: 'female_state', type: 'text' },
    audience: { genders: ['female'] },
    panelId: 'cp_female',
    activationMode: 'always',
}];
const missingFull = validateCharacterAudienceRequirements({
    characters: [{ name: 'Kiara', gender: 'female' }, { name: 'Bob', gender: 'male' }],
}, { schema: full.value, customFieldSpecs: audienceSpecs, mode: 'full' });
if (missingFull.valid || !missingFull.errors.some(error => error.includes('female_state'))) {
    throw new Error('Full audience validation must require targeted field on a matching character');
}
const presentFull = validateCharacterAudienceRequirements({
    characters: [{ name: 'Kiara', gender: 'female', female_state: 'ok' }, { name: 'Bob', gender: 'male' }],
}, { schema: full.value, customFieldSpecs: audienceSpecs, mode: 'full' });
if (!presentFull.valid) throw new Error('Full audience validation must accept a matching targeted field');
const missingDelta = validateCharacterAudienceRequirements({
    characters: [{ name: 'Kiara', gender: 'female' }],
}, { schema: delta.value, customFieldSpecs: audienceSpecs, mode: 'delta' });
if (!missingDelta.valid) throw new Error('Delta audience validation must leave targeted fields optional');

const snap = {
    characters: [
        { name: 'Kiara', gender: 'female', role: 'mage', female_state: 'ok' },
        { name: 'Bob', gender: 'male', role: 'guard', female_state: 'should-not-survive' },
    ],
};
sanitizeCharacterCustomFields(snap, {
    customFieldSpecs: [{
        key: 'female_state',
        field: { key: 'female_state', type: 'text' },
        audience: { genders: ['female'] },
    }],
});
if (snap.characters[0].female_state !== 'ok') throw new Error('matching audience value must survive sanitize');
if (Object.hasOwn(snap.characters[1], 'female_state')) throw new Error('mismatched audience value must be stripped');

console.log('audience-runtime.test.mjs: all tests passed');
