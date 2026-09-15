import assert from 'node:assert/strict';
import {
    buildLaneSchema,
    mergeOwnedLaneResults,
    projectLaneResult,
} from '../src/generation/lane-contract.js';

const schema = {
    name: 'ScenePulse lanes',
    strict: true,
    value: {
        type: 'object',
        additionalProperties: false,
        properties: {
            elapsed: { type: 'string' },
            time: { type: 'string' },
            sceneSummary: { type: 'string' },
            relationships: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: { name: { type: 'string' }, relType: { type: 'string' } },
                    required: ['name', 'relType'],
                },
            },
            characters: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        name: { type: 'string' },
                        aliases: { type: 'array', items: { type: 'string' } },
                        role: { type: 'string' },
                        combatState: { type: 'string' },
                    },
                    required: ['name', 'role', 'combatState'],
                },
            },
        },
        required: ['elapsed', 'time', 'sceneSummary', 'relationships', 'characters'],
    },
};

const coreSpec = { id: 'core', kind: 'core', fields: ['elapsed', 'time', 'sceneSummary'] };
const aliceSpec = {
    id: 'characters-0',
    kind: 'characters',
    fields: ['characters'],
    characterNames: ['Alice'],
    characterFields: ['role'],
};
const bobSpec = {
    id: 'characters-1',
    kind: 'characters',
    fields: ['characters'],
    characterNames: ['Bob'],
};
const globalSpec = { id: 'global', kind: 'global', fields: ['relationships'] };

const schemaBefore = structuredClone(schema);
const characterSchema = buildLaneSchema(schema, aliceSpec);
assert.deepEqual(Object.keys(characterSchema.value.properties), ['characters']);
assert.deepEqual(Object.keys(characterSchema.value.properties.characters.items.properties), ['name', 'aliases', 'role']);
assert.deepEqual(characterSchema.value.properties.characters.items.required, ['name', 'role']);
assert.deepEqual(characterSchema.value.required, ['characters']);
assert.equal(characterSchema.strict, false);
assert.equal(characterSchema.returnInvalid, true);
assert.deepEqual(schema, schemaBefore, 'lane schema construction must not mutate the full schema');

const rawAlice = {
    time: 'must not escape the core owner',
    characters: [
        { name: 'Alice', aliases: [], role: 'Scout', combatState: 'alert', invented: 'drop me' },
        { name: 'Mallory', aliases: [], role: 'Intruder', combatState: 'hidden' },
    ],
};
const rawAliceBefore = structuredClone(rawAlice);
const projected = projectLaneResult(schema, aliceSpec, rawAlice);
assert.deepEqual(projected.value, { characters: [{ name: 'Alice', aliases: [], role: 'Scout' }] });
assert.deepEqual(projected.diagnostics.droppedRootFields, ['time']);
assert.deepEqual(projected.diagnostics.droppedCharacters, ['Mallory']);
assert.deepEqual(projected.diagnostics.droppedCharacterFields, ['Alice.combatState', 'Alice.invented']);
assert.deepEqual(rawAlice, rawAliceBefore, 'projection must not mutate the provider result');
const revealed = projectLaneResult(schema, aliceSpec, {
    characters: [{ name: 'Alicia', aliases: ['Alice'], role: 'Scout' }],
});
assert.equal(revealed.value.characters[0].name, 'Alicia', 'an alias-linked identity reveal remains owned by the batch');

const merged = mergeOwnedLaneResults(schema, [
    { spec: coreSpec, result: { elapsed: '2m', time: '10:30:00', sceneSummary: 'Two scouts meet.', relationships: ['drop'] } },
    { spec: aliceSpec, result: rawAlice },
    { spec: bobSpec, result: { characters: [{ name: 'Bob', aliases: [], role: 'Guard', combatState: 'calm' }], elapsed: 'drop' } },
    { spec: globalSpec, result: { relationships: [{ name: 'Alice', relType: 'Ally' }], sceneSummary: 'drop' } },
]);
assert.deepEqual(merged.value, {
    elapsed: '2m',
    time: '10:30:00',
    sceneSummary: 'Two scouts meet.',
    characters: [
        { name: 'Alice', aliases: [], role: 'Scout' },
        { name: 'Bob', aliases: [], role: 'Guard', combatState: 'calm' },
    ],
    relationships: [{ name: 'Alice', relType: 'Ally' }],
});
assert.equal(merged.diagnostics.length, 4);

assert.throws(
    () => buildLaneSchema(schema, { ...aliceSpec, characterFields: ['notInSchema'] }),
    error => error?.code === 'LANE_SCHEMA_FIELD_UNKNOWN',
);
assert.throws(
    () => mergeOwnedLaneResults(schema, [
        { spec: coreSpec, result: { elapsed: '2m', time: '10:30:00', sceneSummary: 'A' } },
        { spec: { id: 'other-core', kind: 'global', fields: ['sceneSummary'] }, result: { sceneSummary: 'B' } },
    ]),
    error => error?.code === 'LANE_OWNERSHIP_CONFLICT',
);
assert.throws(
    () => mergeOwnedLaneResults(schema, [
        { spec: aliceSpec, result: { characters: [{ name: 'Alice', role: 'Scout' }] } },
        { spec: { ...bobSpec, characterNames: [' alice '] }, result: { characters: [{ name: 'Alice', role: 'Guard' }] } },
    ]),
    error => error?.code === 'LANE_CHARACTER_OWNERSHIP_CONFLICT',
);
assert.throws(
    () => projectLaneResult(schema, { ...aliceSpec, characterNames: ['Alice', 'Bob'] }, {
        characters: [{ name: 'Merged', aliases: ['Alice', 'Bob'], role: 'Invalid' }],
    }),
    error => error?.code === 'LANE_CHARACTER_AMBIGUOUS',
);

console.log('lane-contract.test.mjs: all tests passed');
