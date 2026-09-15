// Security regression tests for custom-panel imports.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    validateActiveCustomPanelFields,
    validateCustomPanels,
    validateImportedConfigSettings,
    validateImportedProfile,
} from '../src/profiles.js';

let pass = 0;
function ok(name, value) {
    if (!value) throw new Error(name);
    pass++;
    console.log('  OK   ' + name);
}
function eq(name, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    ok(`${name} — expected ${e}, got ${a}`, a === e);
}

const validPanels = [{
    id: 'cp_source',
    name: '  Status "quoted"  ',
    scope: 'CHARACTER',
    enabled: false,
    activationMode: 'AUTO',
    activationTags: ['Combat', 'injury', 'combat'],
    ignored: '<img src=x onerror=alert(1)>',
    fields: [
        { key: 'HEALTH', label: ' Health ', type: 'METER', desc: ' HP ', invert: true, ignored: true },
        { key: 'mood_state', label: 'Condition', type: 'enum', desc: 'State', options: [' Good ', 'Bad'] },
    ],
}];
const original = structuredClone(validPanels);
const valid = validateCustomPanels(validPanels);
ok('valid custom panels accepted', valid.ok);
eq('input is not mutated', validPanels, original);
eq('panel name is trimmed', valid.panels[0].name, 'Status "quoted"');
eq('field key is normalized to lowercase', valid.panels[0].fields[0].key, 'health');
eq('field type is normalized', valid.panels[0].fields[0].type, 'meter');
eq('enum options are trimmed', valid.panels[0].fields[1].options, ['Good', 'Bad']);
ok('unknown panel properties are dropped', !Object.hasOwn(valid.panels[0], 'ignored'));
ok('unknown field properties are dropped', !Object.hasOwn(valid.panels[0].fields[0], 'ignored'));
eq('explicit false panel state survives', valid.panels[0].enabled, false);
eq('panel scope is normalized', valid.panels[0].scope, 'character');
eq('panel activation mode is normalized', valid.panels[0].activationMode, 'auto');
eq('panel activation tags are canonical and deduplicated', valid.panels[0].activationTags, ['combat', 'injury']);
eq('meter inversion survives', valid.panels[0].fields[0].invert, true);

const legacyScope = validateCustomPanels([{ name: 'Legacy', fields: [{ key: 'legacy_value', label: '', type: 'text', desc: '' }] }]);
eq('legacy panels default to global scope', legacyScope.panels[0].scope, 'global');
eq('legacy panels default to always activation', legacyScope.panels[0].activationMode, 'always');
eq('legacy panels default to no activation tags', legacyScope.panels[0].activationTags, []);
ok('invalid panel scope is rejected', !validateCustomPanels([{ name: 'Bad scope', scope: 'relationship', fields: [{ key: 'value', label: '', type: 'text', desc: '' }] }]).ok);
ok('invalid activation mode is rejected', !validateCustomPanels([{ name: 'Bad mode', activationMode: 'sometimes', fields: [{ key: 'value', label: '', type: 'text', desc: '' }] }]).ok);
ok('free-form activation tag is rejected', !validateCustomPanels([{ name: 'Bad tag', activationMode: 'auto', activationTags: ['battle'], fields: [{ key: 'value', label: '', type: 'text', desc: '' }] }]).ok);
ok('non-array activation tags are rejected', !validateCustomPanels([{ name: 'Bad tags', activationTags: 'combat', fields: [{ key: 'value', label: '', type: 'text', desc: '' }] }]).ok);
for (const alias of ['inner_thought', 'status', 'notes', 'items', 'thought', 'condition', 'position', 'fertility']) {
    ok(`built-in character alias is rejected: ${alias}`, !validateCustomPanels([{ name: 'Conflict', scope: 'character', fields: [{ key: alias, label: '', type: 'text', desc: '' }] }]).ok);
    ok(`same alias remains valid globally: ${alias}`, validateCustomPanels([{ name: 'Global', scope: 'global', fields: [{ key: alias, label: '', type: 'text', desc: '' }] }]).ok);
}

for (const reserved of ['__proto__', 'prototype', 'constructor']) {
    const result = validateCustomPanels([{ name: 'Unsafe', fields: [{ key: reserved, label: '', type: 'text', desc: '' }] }]);
    ok(`reserved key rejected: ${reserved}`, !result.ok && result.errors.some(e => e.includes('reserved')));
}

const invalidKey = validateCustomPanels([{ name: 'Unsafe', fields: [{ key: 'x"><img_onerror', label: '', type: 'text', desc: '' }] }]);
ok('HTML-shaped field key rejected', !invalidKey.ok);

const duplicateKeys = validateCustomPanels([
    { name: 'One', fields: [{ key: 'health', label: '', type: 'text', desc: '' }] },
    { name: 'Two', fields: [{ key: 'health', label: '', type: 'number', desc: '' }] },
]);
ok('duplicate keys across panels rejected', !duplicateKeys.ok && duplicateKeys.errors.some(e => e.includes('duplicates')));

const sameKeyDifferentScope = validateCustomPanels([
    { name: 'Global', scope: 'global', fields: [{ key: 'disposition', label: '', type: 'text', desc: '' }] },
    { name: 'Character', scope: 'character', fields: [{ key: 'disposition', label: '', type: 'text', desc: '' }] },
]);
ok('same key is allowed in different scopes', sameKeyDifferentScope.ok);

const transitionPanels = [
    { name: 'Global', scope: 'global', fields: [{ key: 'status', label: '', type: 'text', desc: '' }] },
    { name: 'Character', scope: 'character', fields: [{ key: 'disposition', label: '', type: 'text', desc: '' }] },
];
const reservedTransition = structuredClone(transitionPanels);
reservedTransition[0].scope = 'character';
ok('global alias cannot transition into character scope', !validateActiveCustomPanelFields(reservedTransition).ok);
const duplicateTransition = structuredClone(transitionPanels);
duplicateTransition[0].fields[0].key = 'disposition';
duplicateTransition[0].scope = 'character';
ok('scope transition cannot activate a duplicate key', !validateActiveCustomPanelFields(duplicateTransition).ok);
reservedTransition[0].enabled = false;
ok('disabling an invalid draft remains possible', validateActiveCustomPanelFields(reservedTransition).ok);

const duplicateNames = validateCustomPanels([
    { name: 'Same Name', fields: [{ key: 'one', label: '', type: 'text', desc: '' }] },
    { name: 'same   name', fields: [{ key: 'two', label: '', type: 'text', desc: '' }] },
]);
ok('duplicate DOM section names rejected', !duplicateNames.ok && duplicateNames.errors.some(e => e.includes('panel name')));

const duplicateIds = validateCustomPanels([
    { id: 'cp_same', name: 'First ID', fields: [{ key: 'first_id', label: '', type: 'text', desc: '' }] },
    { id: 'cp_same', name: 'Second ID', fields: [{ key: 'second_id', label: '', type: 'text', desc: '' }] },
]);
ok('duplicate imported panel ids are normalized to unique runtime ids', duplicateIds.ok && duplicateIds.panels[0].id !== duplicateIds.panels[1].id);

const badEnum = validateCustomPanels([{ name: 'Enum', fields: [{ key: 'state', label: '', type: 'enum', desc: '', options: ['ok', 7] }] }]);
ok('non-string enum option rejected', !badEnum.ok);

const nullTypes = validateCustomPanels([{ name: 'Nulls', enabled: null, fields: [{ key: 'state', label: null, type: 'text', desc: '' }] }]);
ok('explicit null values do not bypass type checks', !nullTypes.ok);

const tooManyPanels = Array.from({ length: 33 }, (_, i) => ({
    name: `Panel ${i}`,
    fields: [{ key: `field_${i}`, label: '', type: 'text', desc: '' }],
}));
ok('panel count limit enforced', !validateCustomPanels(tooManyPanels).ok);

const pollutedConfig = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"bad":true},"autoGenerate":false,"customPanels":[]}');
const config = validateImportedConfigSettings(pollutedConfig);
ok('clean config accepted while inherited names are ignored', config.ok);
eq('supported scalar imported', config.settingsPatch.autoGenerate, false);
const parallelConfig = validateImportedConfigSettings({ parallelFullGeneration: true });
ok('parallel full feature flag imports as a boolean', parallelConfig.ok && parallelConfig.settingsPatch.parallelFullGeneration === true);
const activationStrategyConfig = validateImportedConfigSettings({ panelActivationStrategy: 'automatic' });
ok('automatic panel strategy imports as a controlled enum', activationStrategyConfig.ok && activationStrategyConfig.settingsPatch.panelActivationStrategy === 'automatic');
ok('invalid panel strategy is rejected', !validateImportedConfigSettings({ panelActivationStrategy: 'sometimes' }).ok);
ok('__proto__ absent from settings patch', !Object.hasOwn(config.settingsPatch, '__proto__'));
ok('constructor absent from settings patch', !Object.hasOwn(config.settingsPatch, 'constructor'));
ok('Object prototype remains unpolluted', ({}).polluted === undefined);

{
    const roundTrip = validateImportedConfigSettings({
        sceneSourceTrace: true,
        sceneSourceTraceDiagnostics: true,
        trackerPromptStyle: 'full',
        autoGenerate: true,
    });
    ok('new settings config accepted', roundTrip.ok);
    eq('sceneSourceTrace imported', roundTrip.settingsPatch.sceneSourceTrace, true);
    eq('sceneSourceTraceDiagnostics imported', roundTrip.settingsPatch.sceneSourceTraceDiagnostics, true);
    eq('trackerPromptStyle profile patch', roundTrip.profilePatch.trackerPromptStyle, 'full');
}

const invalidConfig = validateImportedConfigSettings({ autoGenerate: 'yes', customPanels: [{ name: 'Bad', fields: 'nope' }] });
ok('invalid config is rejected atomically', !invalidConfig.ok && invalidConfig.settingsPatch === null && invalidConfig.profilePatch === null);

const profileResult = validateImportedProfile({
    name: 'Imported',
    customPanels: [{ name: 'Unsafe', fields: [{ key: '__proto__', label: '', type: 'text', desc: '' }] }],
});
ok('profile import uses custom-panel validation', !profileResult.ok);
ok('profile import rejects explicit null customPanels', !validateImportedProfile({ name: 'Null panels', customPanels: null }).ok);

globalThis.SillyTavern = {
    getContext: () => ({
        extensionSettings: { scenepulse: {} },
        chatMetadata: { scenepulse: { chatPanels: [
            { name: 7, fields: [
                { key: '__proto__', type: 'text', label: 'bad', desc: 'bad' },
                { key: 'safe_key', type: 'text', label: 'safe', desc: 'safe' },
            ] },
        ] } },
    }),
};
const { buildDynamicSchema } = await import('../src/schema.js');
const runtimeSchema = buildDynamicSchema({ panels: {}, fieldToggles: {}, dashCards: {} });
ok('runtime schema skips reserved keys from legacy saved data', !Object.hasOwn(runtimeSchema.properties, '__proto__'));
ok('runtime schema still accepts valid legacy fields', Object.hasOwn(runtimeSchema.properties, 'safe_key'));
ok('runtime schema properties keep a normal prototype', Object.getPrototypeOf(runtimeSchema.properties) === Object.prototype);

const here = dirname(fileURLToPath(import.meta.url));
const sectionSource = readFileSync(join(here, '../src/ui/section.js'), 'utf8');
const managerSource = readFileSync(join(here, '../src/settings-ui/custom-panels.js'), 'utf8');
const settingsSource = readFileSync(join(here, '../src/settings-ui/create-settings.js'), 'utf8');
const bindingsSource = readFileSync(join(here, '../src/settings-ui/bind-ui.js'), 'utf8');
ok('refresh title is localized and assigned as a DOM property', sectionSource.includes("refreshButton.title=t('Refresh {title}',{title:String(title)})"));
ok('user panel title is not interpolated into a title attribute', !sectionSource.includes('title="Refresh ${title}"'));
ok('dynamic section selectors use CSS.escape', managerSource.includes('globalThis.CSS.escape'));
ok('collision warning writes message with textContent', managerSource.includes("warn.querySelector('span').textContent=String(message)"));
ok('activation editor uses canonical tag registry', managerSource.includes('SCENE_TAG_REGISTRY'));
ok('activation editor keeps enabled separate from activation mode', managerSource.includes("next[cpIdx].activationMode=mode"));
ok('activation editor labels a disabled panel as forced off', managerSource.includes("badgeText=t('FORCED OFF')"));
ok('panel manager exposes manual and automatic chat control', managerSource.includes("['manual',t('Manual selection')]") && managerSource.includes("['automatic',t('Automatic by scene')]"));
ok('Separate settings expose the Parallel Full feature flag', settingsSource.includes('id="sp-parallel-full"'));
ok('Parallel Full UI loads and saves the existing flag', bindingsSource.includes("$('#sp-parallel-full').prop('checked',s.parallelFullGeneration===true)") && bindingsSource.includes('s.parallelFullGeneration=this.checked'));
ok('parallel and injection changes refresh an open Panel Manager', bindingsSource.includes('refreshOpenPanelManager()'));

console.log(`\nPASS ${pass}/${pass}`);
