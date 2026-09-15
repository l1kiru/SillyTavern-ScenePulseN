import assert from 'node:assert/strict';
import {
    chooseDeltaCharacterBatchSize,
    runParallelDeltaBuild,
    shouldUseParallelDeltaBuild,
} from '../src/generation/parallel-build.js';

function makeSchema(extraCharacterFields = 0) {
    const charProps = {
        name: { type: 'string' },
        aliases: { type: 'array', items: { type: 'string' } },
        role: { type: 'string' },
    };
    const charRequired = ['name', 'role'];
    for (let i = 0; i < extraCharacterFields; i++) {
        const key = `panel_${i}`;
        charProps[key] = { type: 'string' };
        charRequired.push(key);
    }
    return {
        name: 'Parallel Delta test',
        strict: false,
        value: {
            type: 'object',
            additionalProperties: false,
            properties: {
                elapsed: { type: 'string' },
                time: { type: 'string' },
                date: { type: 'string' },
                sceneSummary: { type: 'string' },
                charactersPresent: { type: 'array', items: { type: 'string' } },
                witnesses: { type: 'array', items: { type: 'string' } },
                relationships: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: { name: { type: 'string' }, relType: { type: 'string' } },
                        required: ['name', 'relType'],
                        additionalProperties: false,
                    },
                },
                characters: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: charProps,
                        required: charRequired,
                        additionalProperties: false,
                    },
                },
            },
            required: ['elapsed', 'time', 'date', 'sceneSummary', 'charactersPresent', 'witnesses', 'relationships', 'characters'],
        },
    };
}

const lightSchema = makeSchema(0);
const heavySchema = makeSchema(45);
const oneCharacter = {
    elapsed: '1m', time: '10:00:00', date: '08/26/2026', sceneSummary: 'Previous',
    charactersPresent: ['Alice'], witnesses: [], relationships: [],
    characters: [{ name: 'Alice', aliases: [], role: 'Scout' }],
};
const sevenCharacters = {
    ...oneCharacter,
    charactersPresent: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    characters: ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(name => ({ name, aliases: [], role: 'NPC' })),
};

assert.equal(shouldUseParallelDeltaBuild({ fullSchema: lightSchema, previousSnapshot: oneCharacter }), false, 'small one-character Delta stays monolithic');
assert.equal(shouldUseParallelDeltaBuild({ fullSchema: lightSchema, previousSnapshot: sevenCharacters }), true, 'large cast selects Parallel Delta');
assert.equal(shouldUseParallelDeltaBuild({ fullSchema: lightSchema, previousSnapshot: oneCharacter, automaticRouting: true }), true, 'Automatic routing always selects the router-capable parallel Delta path');
assert.equal(chooseDeltaCharacterBatchSize(lightSchema, 7), 2, 'light character schema batches by two');
assert.equal(chooseDeltaCharacterBatchSize(heavySchema, 7), 1, 'many active character fields isolate each character');

const previous = {
    elapsed: '1m', time: '10:00:00', date: '08/26/2026', sceneSummary: 'Previous summary',
    charactersPresent: ['Alice', 'Bob', 'Carol'], witnesses: [],
    relationships: [{ name: 'Alice', relType: 'Friend' }],
    characters: [
        { name: 'Alice', aliases: [], role: 'Scout' },
        { name: 'Bob', aliases: [], role: 'Guard' },
        { name: 'Carol', aliases: [], role: 'Medic' },
    ],
};
const calls = new Map();
let activeHeavy = 0;
let maxHeavy = 0;
const result = await runParallelDeltaBuild({
    fullSchema: lightSchema,
    systemPrompt: 'Update ScenePulse.',
    contextText: 'The group continues talking.',
    previousSnapshot: previous,
    profileId: 'profile-1',
    retryDelayMs: 0,
    maxRetries: 1,
    maxConcurrent: 2,
    request: async ({ messages, signal }) => {
        const prompt = messages.find(message => message.role === 'user')?.content || '';
        const laneId = prompt.match(/\[SCENEPULSE_LANE ([^\]]+)\]/)?.[1];
        calls.set(laneId, (calls.get(laneId) || 0) + 1);
        if (laneId !== 'core') {
            activeHeavy++;
            maxHeavy = Math.max(maxHeavy, activeHeavy);
            await new Promise((resolve, reject) => {
                const timer = setTimeout(resolve, 5);
                signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
            });
        }
        try {
            if (laneId === 'core') return { value: JSON.stringify({ elapsed: '2m', time: '10:02:00', date: '08/26/2026', charactersPresent: ['Alice', 'Bob', 'Carol'], witnesses: [] }) };
            if (laneId === 'characters-0' && calls.get(laneId) === 1) {
                return { value: JSON.stringify({ characters: [{ name: 'Alice', aliases: [], role: 'Scout' }] }) };
            }
            if (laneId === 'characters-0') {
                return { value: JSON.stringify({ characters: [
                    { name: 'Alice', aliases: [], role: 'Scout' },
                    { name: 'Bob', aliases: [], role: 'Captain' },
                ] }) };
            }
            if (laneId === 'characters-1') return { value: JSON.stringify({ characters: [{ name: 'Carol', aliases: [], role: 'Medic' }] }) };
            if (laneId === 'global') return { value: '{}' };
            throw new Error('unexpected lane ' + laneId);
        } finally {
            if (laneId !== 'core') activeHeavy--;
        }
    },
});

assert.equal(result.meta.mode, 'parallel-delta');
assert.equal(result.meta.characterBatchSize, 2);
assert.equal(result.value.time, '10:02:00', 'Core Delta overwrites temporal state');
assert.equal(result.value.sceneSummary, 'Previous summary', 'unchanged optional Core value carries forward');
assert.equal(result.value.characters.find(c => c.name === 'Bob')?.role, 'Captain', 'character lane update is merged into previous snapshot');
assert.deepEqual(result.value.relationships, previous.relationships, 'empty optional Global lane preserves previous relationships');
assert.equal(calls.get('characters-0'), 2, 'only invalid character batch retries');
assert.equal(calls.get('characters-1'), 1, 'successful sibling character batch is not repeated');
assert.equal(calls.get('global'), 1, 'successful Global lane is not repeated');
assert.equal(maxHeavy, 2, 'Parallel Delta obeys bounded concurrency');
assert.equal(result.delta.characters.length, 3, 'combined Delta contains only lane payload, separate from merged snapshot');

const autoSchema = makeSchema(0);
autoSchema.value.properties.combat_state = { type: 'string' };
autoSchema.value.required.push('combat_state');
autoSchema.value.properties.characters.items.properties.injury_state = { type: 'string' };
autoSchema.value.properties.characters.items.required.push('injury_state');
const panels = [
    {
        id: 'cp_combat', name: 'Combat', scope: 'global', enabled: true,
        activationMode: 'auto', activationTags: ['combat'],
        fields: [{ key: 'combat_state', type: 'text' }],
    },
    {
        id: 'cp_injury', name: 'Injury', scope: 'character', enabled: true,
        activationMode: 'auto', activationTags: ['injury'],
        fields: [{ key: 'injury_state', type: 'text' }],
    },
];
const autoPrevious = {
    elapsed: '1m', time: '11:00:00', date: '08/26/2026', sceneSummary: 'Calm',
    charactersPresent: ['Alice'], witnesses: [], relationships: [],
    characters: [{ name: 'Alice', aliases: [], role: 'Scout' }],
    _spMeta: { panelActivation: { activeTags: [], activePanelIds: [], inactivePanelIds: ['cp_combat', 'cp_injury'], graceByTag: {} } },
};
const laneSchemas = new Map();
const auto = await runParallelDeltaBuild({
    fullSchema: autoSchema,
    systemPrompt: 'Route the scene.',
    systemPromptForActivePanels: ids => `Active panels: ${ids.join(',')}`,
    contextText: 'A fight starts, but nobody is injured.',
    previousSnapshot: autoPrevious,
    panels,
    automaticRouting: true,
    profileId: 'profile-1',
    retryDelayMs: 0,
    request: async ({ messages, jsonSchema }) => {
        const prompt = messages.find(message => message.role === 'user')?.content || '';
        const laneId = prompt.match(/\[SCENEPULSE_LANE ([^\]]+)\]/)?.[1];
        laneSchemas.set(laneId, structuredClone(jsonSchema));
        if (laneId === 'core') return { value: JSON.stringify({
            elapsed: '2m', time: '11:01:00', date: '08/26/2026', charactersPresent: ['Alice'], witnesses: [],
            sceneTags: ['combat'], resolvedTags: [],
        }) };
        if (laneId === 'characters-0') return { value: JSON.stringify({ characters: [{ name: 'Alice', aliases: [], role: 'Scout' }] }) };
        if (laneId === 'global') return { value: JSON.stringify({ combat_state: 'Engaged' }) };
        throw new Error('unexpected lane ' + laneId);
    },
});
assert.equal(auto.value.combat_state, 'Engaged', 'newly activated global panel is initialized in the same Delta turn');
assert.deepEqual(auto.meta.activation.activePanelIds, ['cp_combat']);
assert.ok(laneSchemas.get('global').value.required.includes('combat_state'), 'newly activated global field is required only for initialization');
assert.ok(!Object.hasOwn(laneSchemas.get('characters-0').value.properties.characters.items.properties, 'injury_state'), 'inactive character panel is removed from the Delta lane schema');
assert.ok(!Object.hasOwn(auto.value.characters[0], 'injury_state'), 'missing inactive state is allowed when it never existed');

console.log('parallel-delta.test.mjs: all tests passed');
