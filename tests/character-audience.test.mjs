import assert from 'node:assert/strict';
import {
    audienceIsOpen,
    characterMatchesAudience,
    formatAudienceHint,
    normalizeAudience,
    normalizeGenderToken,
} from '../src/character-audience.js';
import { validateCustomPanels } from '../src/profiles.js';

assert.equal(normalizeGenderToken('Girl'), 'female');
assert.equal(normalizeGenderToken('he/him'), 'male');
assert.equal(normalizeGenderToken('enby'), 'nonbinary');

assert.equal(audienceIsOpen(normalizeAudience()), true);
assert.equal(audienceIsOpen({ names: [' Mira '], genders: ['FEMALE'], keywords: ['Cat', 'cat'] }), false);

const audience = normalizeAudience({
    names: ['Mira', 'mira', ''],
    genders: ['Girl', 'female'],
    keywords: ['Cat', 'neko', 'cat'],
});
assert.deepEqual(audience, { names: ['Mira'], genders: ['female'], keywords: ['cat', 'neko'] });

const mira = { name: 'Mira', aliases: ['Neko'], gender: 'female', role: 'cat girl with a tail' };
const tom = { name: 'Tom', gender: 'male', role: 'bartender' };
const stray = { name: 'Stray', gender: 'female', role: 'human courier' };

assert.equal(characterMatchesAudience(mira, audience), true);
assert.equal(characterMatchesAudience(tom, audience), false, 'male bartender fails name+gender+keyword AND');
assert.equal(characterMatchesAudience(stray, { genders: ['female'] }), true);
assert.equal(characterMatchesAudience(stray, { genders: ['female'], keywords: ['cat', 'neko'] }), false);
assert.equal(characterMatchesAudience(mira, { names: ['neko'] }), true, 'alias matches name filter');
assert.equal(characterMatchesAudience(mira, {}), true, 'open audience matches everyone');
assert.equal(characterMatchesAudience({ name: 'Catherine', role: 'retail worker' }, { keywords: ['cat'] }), false, 'cat is not a substring of Catherine');
assert.equal(characterMatchesAudience({ name: 'Ann', role: 'retail worker' }, { keywords: ['tail'] }), false, 'tail is not a substring of retail');
assert.equal(characterMatchesAudience({ name: 'Котя', role: 'который ждёт' }, { keywords: ['кот'] }), false, 'Cyrillic keyword does not match inside a longer word');
assert.equal(characterMatchesAudience({ name: 'Котя', role: 'чёрный кот сидит' }, { keywords: ['кот'] }), true, 'Cyrillic whole word matches');
assert.equal(characterMatchesAudience({ name: 'Keeper', role: 'bred dragons keeper' }, { keywords: ['red dragon'] }), false, 'multi-word keyword does not match inside surrounding words');
assert.equal(characterMatchesAudience({ name: 'Keeper', role: 'red dragon keeper' }, { keywords: ['red dragon'] }), true, 'multi-word keyword matches as a phrase');
assert.equal(characterMatchesAudience({ name: 'Kiara', innerThought: 'She hopes this works.' }, { genders: ['female'] }), true, 'gender inferred from pronouns');
assert.equal(characterMatchesAudience({ name: 'Bob', innerThought: 'He hopes this works.' }, { genders: ['female'] }), false, 'male pronouns fail female audience');
assert.equal(characterMatchesAudience({ name: 'Киара', innerThought: 'Она надеется, что всё получится.' }, { genders: ['female'] }), true, 'Russian female pronoun fallback works');
assert.equal(characterMatchesAudience({ name: 'Боб', innerThought: 'Он надеется, что всё получится.' }, { genders: ['female'] }), false, 'Russian male pronoun fallback works');

const parsed = validateCustomPanels([{
    name: 'Cat traits',
    scope: 'character',
    audience: { names: [' Mira '], genders: ['Girl'], keywords: ['Tail', 'cat'] },
    fields: [{ key: 'tail_state', label: 'Tail', type: 'text', desc: '' }],
}]);
assert.equal(parsed.ok, true);
assert.deepEqual(parsed.panels[0].audience, { names: ['Mira'], genders: ['female'], keywords: ['tail', 'cat'] });
assert.ok(formatAudienceHint(parsed.panels[0].audience).includes('female'));

const rejected = validateCustomPanels([{
    name: 'Bad gender',
    scope: 'character',
    audience: { genders: ['helicopter'] },
    fields: [{ key: 'tail_state', label: 'Tail', type: 'text', desc: '' }],
}]);
assert.equal(rejected.ok, false);

console.log('character-audience.test.mjs: all tests passed');
