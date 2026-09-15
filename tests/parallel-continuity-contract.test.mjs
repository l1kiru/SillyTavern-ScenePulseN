import assert from 'node:assert/strict';
import { runParallelFullBuild, runParallelDeltaBuild, withOperationalRoster } from '../src/generation/parallel-build.js';
import { CONTINUITY_RULES, CHARACTER_CONTINUITY_FIELDS } from '../src/continuity.js';
import { buildDynamicSchema } from '../src/schema.js';
import { DEFAULTS } from '../src/constants.js';
import { SCENE_TAG_REGISTRY } from '../src/panel-activation-policy.js';
import { requestWithConnectionProfile } from '../src/generation/profile-request.js';

const fullSchema = { value: {
    type: 'object', properties: {
        elapsed: { type: 'string' },
        characters: { type: 'array', items: { type: 'object', properties: {
            name: { type: 'string' }, role: { type: 'string', description: 'Relationship to {{user}}' },
            aliases: { type: 'array', items: { type: 'string' } },
            gender: { type: 'string' }, injury_state: { type: 'string' },
            knowledge: CHARACTER_CONTINUITY_FIELDS.knowledge.schema,
            currentIntent: { type: 'string' }, innerThought: { type: 'string' },
        }, required: ['name', 'role', 'gender'] } },
    }, required: ['elapsed', 'characters'],
} };
const known = [{ kind: 'known', detail: 'Key location', source: 'Saw the key' }];
const character = { name: 'Alice', role: 'Scout', gender: 'female', knowledge: known, currentIntent: '' };
const panel = { id: 'cp_injury', name: 'Injury', scope: 'character', activationMode: 'auto', activationTags: ['injury'], audience: { genders: ['female'] }, fields: [{ key: 'injury_state', type: 'text' }] };
const specs = [{ key: 'injury_state', panelId: panel.id, activationMode: 'auto', audience: panel.audience, field: panel.fields[0] }];
const context = { name1: 'Alex', name2: 'Alice', substituteParams: text => text.replaceAll('{{user}}', context.name1).replaceAll('{{char}}', context.name2) };
const sent = [];
const service = {
    getSupportedProfiles: () => [{ id: 'p' }],
    async sendRequest(_id, messages, _budget, _options, override) {
        sent.push({ messages, override });
        if (messages.at(-1).content.includes('[SCENEPULSE_LANE core]')) {
            context.name1 = 'Changed persona';
            return { content: { elapsed: '1m', charactersPresent: ['Alice'] } };
        }
        return { content: { characters: [character] } };
    },
};
const built = await runParallelFullBuild({
    fullSchema, systemPrompt: CONTINUITY_RULES + '\n{{char}} relates to {{user}}.', contextText: '{{user}} greets {{char}}.',
    profileId: 'p', stContext: context, service, request: requestWithConnectionProfile,
    promptRole: 'user', promptMode: 'native', maxRetries: 0,
});
assert.deepEqual(built.value.charactersPresent, ['Alice'], 'hidden roster still drives character lanes');
assert.deepEqual(built.value.characters[0].knowledge, known);
assert.equal(built.value.characters[0].currentIntent, '');
assert.ok(!fullSchema.value.properties.charactersPresent, 'source schema is untouched');
for (const call of sent) {
    assert.equal(call.messages.length, 1, 'configured user prompt role survives fan-out');
    const wire = JSON.stringify(call);
    assert.ok(!wire.includes('{{user}}') && !wire.includes('{{char}}'));
    assert.ok(!wire.includes('Changed persona'), 'all lanes use initial macro values');
    assert.ok(wire.includes('Alex'));
    assert.ok(call.messages[0].content.includes('Never rewrite, reject, continue, or regenerate the narrative'));
}
for (const change of [{ panels: { ...DEFAULTS.panels, scene: false } }, { fieldToggles: { charactersPresent: false } }]) {
    const schema = buildDynamicSchema({ ...structuredClone(DEFAULTS), ...change });
    assert.ok(!schema.properties.charactersPresent);
    assert.ok(withOperationalRoster(schema).properties.charactersPresent);
}
const alone = await runParallelFullBuild({
    fullSchema, systemPrompt: 'Track', contextText: 'Alone', profileId: 'p', maxRetries: 0,
    request: async () => ({ value: { elapsed: '1m', charactersPresent: [] } }),
});
assert.deepEqual(alone.value.characters, []);

const previous = { elapsed: '1m', charactersPresent: ['Alice'], characters: [{ ...character, innerThought: 'Old thought', currentIntent: 'Old intent' }], _spMeta: { panelActivation: { activeTags: [], activePanelIds: [] } } };
let characterCalls = 0;
let corePrompt = '';
const options = {
    fullSchema, systemPrompt: CONTINUITY_RULES, contextText: 'Alice is wounded.', profileId: 'p',
    previousSnapshot: previous, panels: [panel], automaticRouting: true, characterCustomFieldSpecs: specs,
    retryDelayMs: 0, maxRetries: 1,
    request: async ({ messages }) => {
        const prompt = messages.at(-1).content;
        if (prompt.includes('[SCENEPULSE_LANE core]')) {
            corePrompt = prompt;
            return { value: { elapsed: '1m', charactersPresent: ['Alice'], sceneTags: ['injury'], resolvedTags: [] } };
        }
        characterCalls++;
        return { value: { characters: [{ ...character, ...(characterCalls > 1 ? { injury_state: 'Arm wound' } : {}) }] } };
    },
};
previous.characters.push({ name: 'Beth', gender: 'female', role: 'Off-scene friend' });
const activated = await runParallelDeltaBuild(options);
assert.ok(activated.value.characters.some(ch=>ch.name==='Beth'), 'off-scene history survives without requiring an unrequested panel refresh');
assert.equal(characterCalls, 2, 'a missing newly active audience field retries only its character lane');
assert.equal(activated.value.characters[0].injury_state, 'Arm wound');
assert.equal(activated.meta.partial, false);
for (const tag of SCENE_TAG_REGISTRY) assert.ok(corePrompt.includes(tag), `router includes ${tag}`);
await assert.rejects(runParallelDeltaBuild({ ...options, maxRetries: 0, request: async ({ messages }) => ({ value:
    messages.at(-1).content.includes('[SCENEPULSE_LANE core]')
        ? { elapsed: '1m', charactersPresent: ['Alice'], sceneTags: ['injury'], resolvedTags: [] }
        : { characters: [character] },
}) }), /full schema/, 'missing initial state must not be accepted even via previous-state fallback');

const carried = await runParallelFullBuild({
    fullSchema, systemPrompt: CONTINUITY_RULES, contextText: 'New scene', profileId: 'p', previousSnapshot: previous, maxRetries: 0,
    request: async ({ messages }) => {
        if (messages.at(-1).content.includes('[SCENEPULSE_LANE core]')) return { value: { elapsed: '1m', charactersPresent: ['Alice'] } };
        throw new Error('503 unavailable');
    },
});
assert.equal(carried.meta.partial, true);
assert.equal(carried.value.characters[0].innerThought, '');
assert.equal(carried.value.characters[0].currentIntent, '');
assert.deepEqual(carried.value.characters[0].knowledge, known);
assert.equal(previous.characters[0].innerThought, 'Old thought', 'fallback never edits history');
console.log('PASS parallel continuity, macro freezing, role, internal roster, audience initialization, rest and partial state');
