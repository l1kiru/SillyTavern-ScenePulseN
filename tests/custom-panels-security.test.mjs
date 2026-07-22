// Security regression tests for custom-panel imports.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
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
    enabled: false,
    ignored: '<img src=x onerror=alert(1)>',
    fields: [
        { key: 'HEALTH', label: ' Health ', type: 'METER', desc: ' HP ', invert: true, ignored: true },
        { key: 'condition', label: 'Condition', type: 'enum', desc: 'State', options: [' Good ', 'Bad'] },
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
eq('meter inversion survives', valid.panels[0].fields[0].invert, true);

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

const duplicateNames = validateCustomPanels([
    { name: 'Same Name', fields: [{ key: 'one', label: '', type: 'text', desc: '' }] },
    { name: 'same   name', fields: [{ key: 'two', label: '', type: 'text', desc: '' }] },
]);
ok('duplicate DOM section names rejected', !duplicateNames.ok && duplicateNames.errors.some(e => e.includes('panel name')));

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
ok('__proto__ absent from settings patch', !Object.hasOwn(config.settingsPatch, '__proto__'));
ok('constructor absent from settings patch', !Object.hasOwn(config.settingsPatch, 'constructor'));
ok('Object prototype remains unpolluted', ({}).polluted === undefined);

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
ok('refresh title is localized and assigned as a DOM property', sectionSource.includes("refreshButton.title=t('Refresh {title}',{title:String(title)})"));
ok('user panel title is not interpolated into a title attribute', !sectionSource.includes('title="Refresh ${title}"'));
ok('dynamic section selectors use CSS.escape', managerSource.includes('globalThis.CSS.escape'));
ok('collision warning writes message with textContent', managerSource.includes("warn.querySelector('span').textContent=String(message)"));

console.log(`\nPASS ${pass}/${pass}`);
