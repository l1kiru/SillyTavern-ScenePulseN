import assert from 'node:assert/strict';
import { createFullLanePlan, runParallelFullBuild } from '../src/generation/parallel-build.js';
import { createBuildTiming } from '../src/generation/build-timing.js';

const fullSchema = {
    name: 'Parallel test',
    strict: false,
    value: {
        type: 'object',
        additionalProperties: false,
        properties: {
            elapsed: { type: 'string' },
            time: { type: 'string' },
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
                    properties: {
                        name: { type: 'string' },
                        aliases: { type: 'array', items: { type: 'string' } },
                        role: { type: 'string' },
                    },
                    required: ['name', 'role'],
                    additionalProperties: false,
                },
            },
        },
        required: ['elapsed', 'time', 'sceneSummary', 'charactersPresent', 'witnesses', 'relationships', 'characters'],
    },
};

const calls = new Map();
let activeHeavy = 0;
let maxActiveHeavy = 0;
const request = async ({ messages, signal }) => {
    const prompt = messages.find(message => message.role === 'user')?.content || '';
    const laneId = prompt.match(/\[SCENEPULSE_LANE ([^\]]+)\]/)?.[1];
    calls.set(laneId, (calls.get(laneId) || 0) + 1);
    if (laneId !== 'core') {
        activeHeavy++;
        maxActiveHeavy = Math.max(maxActiveHeavy, activeHeavy);
    }
    try {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, laneId === 'core' ? 1 : 8);
            signal?.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(signal.reason || new DOMException('Aborted', 'AbortError'));
            }, { once: true });
        });
        if (laneId === 'core') return { value: JSON.stringify({ elapsed: '2m', time: '10:00:00', sceneSummary: 'Ready', charactersPresent: ['Alice', 'Bob', 'Carol'], witnesses: [] }), strategy: 'fake' };
        if (laneId === 'global') return { value: JSON.stringify({ relationships: [{ name: 'Alice', relType: 'Ally' }], elapsed: 'foreign' }), strategy: 'fake' };
        if (laneId === 'characters-0' && calls.get(laneId) === 1) return { value: JSON.stringify({ characters: [{ name: 'Alice', aliases: [], role: 'Scout' }] }), strategy: 'fake' };
        if (laneId === 'characters-0') return { value: JSON.stringify({ characters: [{ name: 'Alice', aliases: [], role: 'Scout' }, { name: 'Bob', aliases: [], role: 'Guard', time: 'foreign' }] }), strategy: 'fake' };
        return { value: JSON.stringify({ characters: [{ name: 'Carol', aliases: [], role: 'Medic' }] }), strategy: 'fake' };
    } finally {
        if (laneId !== 'core') activeHeavy--;
    }
};

const beforeSchema = structuredClone(fullSchema);

for (const [count, expectedBatches] of [
    [1, [['A']]],
    [2, [['A', 'B']]],
    [4, [['A', 'B'], ['C', 'D']]],
    [6, [['A', 'B'], ['C', 'D'], ['E', 'F']]],
    [7, [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G']]],
]) {
    const names = Array.from({ length: count }, (_, index) => String.fromCharCode(65 + index));
    const plan = createFullLanePlan(fullSchema, { charactersPresent: names });
    assert.deepEqual(
        plan.lanes.filter(lane => lane.kind === 'characters').map(lane => lane.characterNames),
        expectedBatches,
        `${count} character(s) use deterministic batches of two`,
    );
}

const built = await runParallelFullBuild({
    fullSchema,
    systemPrompt: 'Generate ScenePulse JSON.',
    contextText: 'User: Report in.\nAssistant: Ready.',
    previousSnapshot: null,
    profileId: 'profile-1',
    promptMode: 'json',
    maxRetries: 1,
    retryDelayMs: 0,
    request,
});

assert.deepEqual(built.value, {
    elapsed: '2m',
    time: '10:00:00',
    sceneSummary: 'Ready',
    charactersPresent: ['Alice', 'Bob', 'Carol'],
    witnesses: [],
    characters: [
        { name: 'Alice', aliases: [], role: 'Scout' },
        { name: 'Bob', aliases: [], role: 'Guard' },
        { name: 'Carol', aliases: [], role: 'Medic' },
    ],
    relationships: [{ name: 'Alice', relType: 'Ally' }],
});
assert.equal(calls.get('core'), 1);
assert.equal(calls.get('global'), 1);
assert.equal(calls.get('characters-0'), 2, 'only the incomplete character batch retries');
assert.equal(calls.get('characters-1'), 1);
assert.equal(maxActiveHeavy, 2, 'heavy lanes use bounded concurrency');
assert.equal(built.meta.concurrency, 2);
assert.equal(built.meta.lanes.find(lane => lane.id === 'characters-0')?.attempts, 2);
assert.equal(built.meta.lanes.find(lane => lane.id === 'global')?.attempts, 1);
assert.deepEqual(built.meta.lanes.find(lane => lane.id === 'characters-0')?.characterNames, ['Alice', 'Bob']);
assert.ok(built.meta.wallMs > 0, 'parallel lane wall time is recorded');
assert.ok(built.meta.sumLaneMs >= built.meta.wallMs, 'summed lane duration exposes overlapping work');
assert.equal(
    built.meta.parallelGain,
    Math.round((built.meta.sumLaneMs / built.meta.wallMs) * 100) / 100,
    'parallel gain is derived from lane sum divided by lane wall time',
);
assert.deepEqual(fullSchema, beforeSchema, 'parallel build must not mutate the frozen full schema');

const activatedSchema = structuredClone(fullSchema);
activatedSchema.value.properties.combat_state = { type: 'string' };
activatedSchema.value.properties.social_state = { type: 'string' };
activatedSchema.value.required.push('combat_state', 'social_state');
activatedSchema.value.properties.characters.items.properties.injury_state = { type: 'string' };
activatedSchema.value.properties.characters.items.required.push('injury_state');
const activationPanels = [
    {
        id: 'cp_combat', name: 'Combat', scope: 'global', enabled: true,
        activationMode: 'auto', activationTags: ['combat'],
        fields: [{ key: 'combat_state', type: 'text' }],
    },
    {
        id: 'cp_social', name: 'Social', scope: 'global', enabled: true,
        activationMode: 'auto', activationTags: ['social'],
        fields: [{ key: 'social_state', type: 'text' }],
    },
    {
        id: 'cp_injury', name: 'Injury', scope: 'character', enabled: true,
        activationMode: 'auto', activationTags: ['injury'],
        fields: [{ key: 'injury_state', type: 'text' }],
    },
];
const activationLaneSchemas = new Map();
let activePromptPanelIds = null;
const activated = await runParallelFullBuild({
    fullSchema: activatedSchema,
    systemPrompt: 'Router prompt without custom panel fields.',
    systemPromptForActivePanels: ids => {
        activePromptPanelIds = ids;
        return 'Heavy prompt for active panels: ' + ids.join(',');
    },
    contextText: 'Alice talks after an uneventful encounter.',
    previousSnapshot: {
        combat_state: 'Previous encounter',
        characters: [{ name: 'Alice', aliases: [], role: 'Scout', injury_state: 'Bandaged' }],
    },
    panels: activationPanels,
    profileId: 'profile-1',
    retryDelayMs: 0,
    request: async ({ messages, jsonSchema }) => {
        const prompt = messages.find(message => message.role === 'user')?.content || '';
        const laneId = prompt.match(/\[SCENEPULSE_LANE ([^\]]+)\]/)?.[1];
        activationLaneSchemas.set(laneId, structuredClone(jsonSchema));
        if (laneId === 'core') return { value: JSON.stringify({
            elapsed: '1m', time: '10:05:00', sceneSummary: 'Talking',
            charactersPresent: ['Alice'], witnesses: [], sceneTags: ['social'], resolvedTags: [],
        }) };
        if (laneId === 'global') return { value: JSON.stringify({
            relationships: [], social_state: 'Friendly', combat_state: 'foreign overwrite',
        }) };
        return { value: JSON.stringify({
            characters: [{ name: 'Alice', aliases: [], role: 'Scout', injury_state: 'foreign overwrite' }],
        }) };
    },
});
assert.equal(activated.value.social_state, 'Friendly', 'active panel is regenerated');
assert.equal(activated.value.combat_state, 'Previous encounter', 'inactive global panel state is preserved');
assert.equal(activated.value.characters[0].injury_state, 'Bandaged', 'inactive character panel state is preserved');
assert.ok(activePromptPanelIds.includes('cp_social'));
assert.ok(!activePromptPanelIds.includes('cp_combat'));
assert.ok(!Object.hasOwn(activationLaneSchemas.get('global').value.properties, 'combat_state'), 'inactive global field is absent from its lane schema');
assert.ok(!Object.hasOwn(activationLaneSchemas.get('characters-0').value.properties.characters.items.properties, 'injury_state'), 'inactive character field is absent from its lane schema');
assert.deepEqual(activated.meta.activation.sceneTags, ['social']);
assert.deepEqual(activated.meta.activation.activePanelIds, ['cp_social']);
assert.deepEqual(activated.meta.activation.inactivePanelIds, ['cp_combat', 'cp_injury']);

const parent = new AbortController();
const heavySignals = [];
const hangingRequest = async ({ messages, signal }) => {
    const prompt = messages.find(message => message.role === 'user')?.content || '';
    const laneId = prompt.match(/\[SCENEPULSE_LANE ([^\]]+)\]/)?.[1];
    if (laneId === 'core') return request({ messages, signal });
    heavySignals.push(signal);
    return await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
};
const cancelled = runParallelFullBuild({
    fullSchema,
    systemPrompt: 'Generate ScenePulse JSON.',
    contextText: 'Cancel this build.',
    profileId: 'profile-1',
    signal: parent.signal,
    retryDelayMs: 0,
    request: hangingRequest,
});
setTimeout(() => parent.abort(new DOMException('Parent stopped', 'AbortError')), 15);
await assert.rejects(cancelled, error => error?.name === 'AbortError');
assert.ok(heavySignals.length >= 1);
assert.ok(heavySignals.every(signal => signal.aborted), 'parent abort reaches every started child lane');

let timeoutCharacterCalls = 0;
let timeoutGlobalCalls = 0;
const timeoutTiming = createBuildTiming({ generationId: 'timeout-test' });
const timeoutRetry = await runParallelFullBuild({
    fullSchema,
    systemPrompt: 'Generate ScenePulse JSON.',
    contextText: 'Retry only the timed-out lane.',
    profileId: 'profile-1',
    maxRetries: 1,
    retryDelayMs: 0,
    timeouts: { characters: 5, global: 100 },
    timing: timeoutTiming,
    request: async ({ messages, signal }) => {
        const prompt = messages.find(message => message.role === 'user')?.content || '';
        const laneId = prompt.match(/\[SCENEPULSE_LANE ([^\]]+)\]/)?.[1];
        if (laneId === 'core') return { value: JSON.stringify({ elapsed: '1m', time: '11:00:00', sceneSummary: 'Retry', charactersPresent: ['Alice'], witnesses: [] }) };
        if (laneId === 'global') {
            timeoutGlobalCalls++;
            return { value: JSON.stringify({ relationships: [] }) };
        }
        timeoutCharacterCalls++;
        if (timeoutCharacterCalls === 1) {
            return await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
        }
        return { value: JSON.stringify({ characters: [{ name: 'Alice', aliases: [], role: 'Scout' }] }) };
    },
});
assert.equal(timeoutRetry.value.characters[0].name, 'Alice');
assert.equal(timeoutCharacterCalls, 2, 'a child timeout retries only that lane');
assert.equal(timeoutGlobalCalls, 1, 'a sibling lane is not repeated after another lane timeout');
assert.equal(timeoutTiming.timing.attempts.find(attempt => attempt.laneId === 'characters-0')?.status, 'timeout');
assert.equal(timeoutTiming.timing.attempts.find(attempt => attempt.laneId === 'characters-0')?.failureCode, 'TIMEOUT');

let networkCharacterCalls = 0;
let networkGlobalCalls = 0;
const networkRetry = await runParallelFullBuild({
    fullSchema,
    systemPrompt: 'Generate ScenePulse JSON.',
    contextText: 'Retry only the lane with a transient network failure.',
    profileId: 'profile-1',
    maxRetries: 1,
    retryDelayMs: 0,
    request: async ({ messages }) => {
        const prompt = messages.find(message => message.role === 'user')?.content || '';
        const laneId = prompt.match(/\[SCENEPULSE_LANE ([^\]]+)\]/)?.[1];
        if (laneId === 'core') return { value: JSON.stringify({ elapsed: '1m', time: '11:30:00', sceneSummary: 'Recovered', charactersPresent: ['Alice'], witnesses: [] }) };
        if (laneId === 'global') {
            networkGlobalCalls++;
            return { value: JSON.stringify({ relationships: [] }) };
        }
        networkCharacterCalls++;
        if (networkCharacterCalls === 1) throw Object.assign(new Error('503 service unavailable'), { status: 503 });
        return { value: JSON.stringify({ characters: [{ name: 'Alice', aliases: [], role: 'Scout' }] }) };
    },
});
assert.equal(networkRetry.value.characters[0].name, 'Alice');
assert.equal(networkCharacterCalls, 2, 'a transient network failure retries only its lane');
assert.equal(networkGlobalCalls, 1, 'a successful sibling is not repeated after a network retry');

let rateLimitedCalls = 0;
let siblingCompleted = false;
let rateLimitFailure = null;
const startedAfterRateLimit = [];
await assert.rejects(runParallelFullBuild({
    fullSchema,
    systemPrompt: 'Generate ScenePulse JSON.',
    contextText: 'Rate-limit one lane while later lanes are still queued.',
    profileId: 'profile-1',
    maxRetries: 2,
    retryDelayMs: 0,
    request: async ({ messages }) => {
        const prompt = messages.find(message => message.role === 'user')?.content || '';
        const laneId = prompt.match(/\[SCENEPULSE_LANE ([^\]]+)\]/)?.[1];
        if (laneId === 'core') return { value: JSON.stringify({
            elapsed: '1m', time: '12:00:00', sceneSummary: 'Limited', witnesses: [],
            charactersPresent: ['Alice', 'Bob', 'Carol', 'Dana', 'Eli', 'Fran', 'Gail'],
        }) };
        startedAfterRateLimit.push(laneId);
        if (laneId === 'characters-0') {
            rateLimitedCalls++;
            throw Object.assign(new Error('429 rate limit'), { status: 429 });
        }
        if (laneId === 'characters-1') {
            await new Promise(resolve => setTimeout(resolve, 10));
            siblingCompleted = true;
            return { value: JSON.stringify({
                characters: [
                    { name: 'Carol', aliases: [], role: 'Medic' },
                    { name: 'Dana', aliases: [], role: 'Pilot' },
                ],
            }) };
        }
        if (laneId === 'global') return { value: JSON.stringify({ relationships: [] }) };
        const namesByLane = {
            'characters-2': ['Eli', 'Fran'],
            'characters-3': ['Gail'],
        };
        return { value: JSON.stringify({
            characters: (namesByLane[laneId] || []).map(name => ({ name, aliases: [], role: 'Queued' })),
        }) };
    },
}), error => {
    rateLimitFailure = error;
    return error?.code === 'PARALLEL_BUILD_FAILED';
});
assert.equal(rateLimitedCalls, 1, '429 is not amplified by lane retries');
assert.equal(siblingCompleted, true, 'one failed lane does not cancel an already-running sibling');
assert.ok(
    rateLimitFailure?.details?.some(detail => detail.code === 'LANES_SKIPPED' && detail.message.includes('3 queued lane(s)')),
    'failure diagnostics expose how many queued lanes were suppressed',
);
assert.deepEqual(
    startedAfterRateLimit.sort(),
    ['characters-0', 'characters-1'],
    '429 stops dispatching queued lanes while already-started siblings finish',
);

const partialPrev = {
    elapsed: '1m',
    time: '11:00:00',
    sceneSummary: 'Before',
    charactersPresent: ['Alice', 'Bob', 'Carol', 'Dana'],
    witnesses: [],
    relationships: [{ name: 'Alice', relType: 'Ally' }],
    characters: [
        { name: 'Alice', aliases: [], role: 'Scout' },
        { name: 'Bob', aliases: [], role: 'Guard' },
        { name: 'Carol', aliases: [], role: 'Medic' },
        { name: 'Dana', aliases: [], role: 'Pilot' },
    ],
};
const partialBuilt = await runParallelFullBuild({
    fullSchema,
    systemPrompt: 'Generate ScenePulse JSON.',
    contextText: 'One lane 429, keep the rest.',
    previousSnapshot: partialPrev,
    profileId: 'profile-1',
    maxConcurrent: 3,
    maxRetries: 0,
    retryDelayMs: 0,
    request: async ({ messages }) => {
        const prompt = messages.find(message => message.role === 'user')?.content || '';
        const laneId = prompt.match(/\[SCENEPULSE_LANE ([^\]]+)\]/)?.[1];
        if (laneId === 'core') return { value: JSON.stringify({
            elapsed: '3m', time: '12:00:00', sceneSummary: 'Partial', witnesses: [],
            charactersPresent: ['Alice', 'Bob', 'Carol', 'Dana'],
        }) };
        if (laneId === 'characters-0') throw Object.assign(new Error('429 rate limit'), { status: 429 });
        if (laneId === 'characters-1') return { value: JSON.stringify({
            characters: [
                { name: 'Carol', aliases: [], role: 'Medic' },
                { name: 'Dana', aliases: [], role: 'Pilot' },
            ],
        }) };
        if (laneId === 'global') return { value: JSON.stringify({ relationships: [{ name: 'Carol', relType: 'Ally' }] }) };
        return { value: '{}' };
    },
});
assert.equal(partialBuilt.meta.partial, true, 'failed character lane marks the build partial');
assert.ok(partialBuilt.value.characters.some(ch => ch.name === 'Alice' && ch.role === 'Scout'), 'missing lane is filled from previous Alice');
assert.ok(partialBuilt.value.characters.some(ch => ch.name === 'Carol' && ch.role === 'Medic'), 'successful sibling is kept');
assert.deepEqual(partialBuilt.value.relationships, [{ name: 'Carol', relType: 'Ally' }]);

console.log('parallel-build.test.mjs: all tests passed');
