import assert from 'node:assert/strict';
import { installThoughtDom } from './helpers/thought-dom.mjs';

const ctx = {
    name1: 'User', name2: 'Alice', chatId: 'plans', characterId: 0,
    characters: [], groups: [], chat: [{ is_user: true, mes: 'Hello' }, { is_user: false, mes: 'Alice explains her plan.', swipe_id: 0 }],
    chatMetadata: { scenepulse: { snapshots: {} } }, extensionSettings: { scenepulse: {} },
    saveMetadata() {}, saveSettingsDebounced() {},
};
globalThis.SillyTavern = { getContext: () => ctx };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.toastr = { error() {}, warning() {}, info() {}, success() {} };
globalThis.document = {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, contains: () => false } }),
    body: { dataset: {}, appendChild() {}, addEventListener() {} }, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
};
globalThis.window = { innerWidth: 1280, addEventListener() {} };
installThoughtDom();
Object.defineProperty(performance, 'now', { configurable: true, value: () => 1000 });

const { getSettings, getActiveSchema, getActivePrompt, saveSnapshot, getSnapshotFor } = await import('../src/settings.js');
const { getActiveProfile, isBuiltInCharacterFieldKey } = await import('../src/profiles.js');
const { prepareSnapshotContext, normalizeKnowledge } = await import('../src/continuity.js');
const { normalizeTracker } = await import('../src/normalize.js');
const { mergeDelta, preserveOffSceneEntities } = await import('../src/generation/delta-merge.js');
const { buildInlineTrackerPrompt } = await import('../src/generation/interceptor.js');
const { buildRequestSchema } = await import('../src/schema.js');
const { processExtraction } = await import('../src/generation/pipeline.js');
const { validateExtraction } = await import('../src/generation/validation.js');
const { runParallelFullBuild } = await import('../src/generation/parallel-build.js');
const { renderSceneState, renderCharacterState, renderKnowledgeProvenance } = await import('../src/ui/state-records-view.js');
const { CHARACTER_STATE_FIELDS, SCENE_STATE_FIELDS, normalizeStateRecords } = await import('../src/state-records.js');

const settings = getSettings();
getActiveSchema();
const profile = getActiveProfile(settings);
const condition = { id: 'arm', detail: 'Bruised arm', status: 'active', limitation: 'Cannot lift the crate', source: 'Alice tried and stopped because of the pain.' };
const emotion = { detail: 'Worried', valence: 'negative', activation: 'high', control: 'unknown', basis: 'interpreted', source: 'Her hands trembled while reading.' };
const trait = { id: 'craft', kind: 'skill', detail: 'Repairs radios', source: 'Established in her character description.' };
const item = { id: 'key', name: 'Brass key', ownerType: 'npc', owner: 'Alice', location: 'Pocket', quantity: 1, condition: 'Bent', status: 'held', source: 'Alice picked up the bent key.' };
const fact = { id: 'gate', detail: 'The gate closes at sunset', scope: 'Old town', status: 'active', source: 'Narrator established the town rule.' };
const knowledge = { kind: 'belief', detail: 'The bridge is closed', source: 'Ben told Alice.', learnedFrom: 'Ben', channel: 'told', verification: 'unverified' };
const alice = { name: 'Alice', role: 'Mechanic', conditions: [condition], emotionalState: [emotion], establishedTraits: [trait], knowledge: [knowledge] };
const prior = { elapsed: '1m', charactersPresent: ['Alice'], characters: [alice], trackedItems: [item], worldFacts: [fact] };
const original = structuredClone(prior);
const fullSchema = getActiveSchema();
const normalized = normalizeTracker(prior);
for (const key of Object.keys(CHARACTER_STATE_FIELDS)) {
    assert.deepEqual(normalized.characters[0][key], alice[key]);
    assert.ok(isBuiltInCharacterFieldKey(key), 'new fields survive custom-field sanitization');
}
for (const key of Object.keys(SCENE_STATE_FIELDS)) assert.deepEqual(normalized[key], prior[key]);
assert.deepEqual(normalized.characters[0].knowledge, [knowledge]);
const legacyKnowledge = { kind: 'known', detail: 'Old fact', source: 'Witnessed' };
assert.deepEqual(normalizeKnowledge([legacyKnowledge]), [legacyKnowledge], 'no invented provenance for old saves');
assert.equal(normalizeKnowledge([{ ...knowledge, channel: 'telepathy' }])[0].channel, undefined);
assert.deepEqual(normalizeStateRecords([condition, condition, { ...condition, id: 'bad', source: '' }], CHARACTER_STATE_FIELDS.conditions.schema), [condition]);
assert.equal(normalizeStateRecords([{ ...item, quantity: -1 }], SCENE_STATE_FIELDS.trackedItems.schema)[0].quantity, null);
assert.equal(normalizeStateRecords([{ ...item, quantity: 0 }], SCENE_STATE_FIELDS.trackedItems.schema)[0].quantity, 0);
assert.equal(normalizeStateRecords(Array.from({ length: 40 }, (_, i) => ({ ...fact, id: String(i) })), SCENE_STATE_FIELDS.worldFacts.schema).length, 30);

// Persistence, transfers, clearing and no autonomous advancement.
let elapsed = prior;
for (let i = 0; i < 10; i++) elapsed = mergeDelta(elapsed, { charactersPresent: [], characters: [] });
assert.deepEqual(elapsed.characters[0].conditions, [condition]);
assert.deepEqual(elapsed.characters[0].establishedTraits, [trait]);
assert.deepEqual(elapsed.characters[0].emotionalState, []);
assert.deepEqual(elapsed.trackedItems, [item]);
assert.deepEqual(elapsed.worldFacts, [fact]);
assert.deepEqual(mergeDelta(prior, { elapsed: '2m' }).characters[0].emotionalState, [], 'absence clears emotion even without a roster update');
const playerItem = { ...item, ownerType: 'player', owner: 'User', source: 'Alice handed the key to User.' };
const transferred = mergeDelta(prior, { trackedItems: [playerItem], characters: [{ name: 'Alice', conditions: [], establishedTraits: [] }] });
assert.deepEqual(transferred.trackedItems, [playerItem], 'same id has exactly one current holder');
assert.equal(transferred.characters.length, 1, 'player inventory never creates a player NPC');
assert.deepEqual(transferred.characters[0].conditions, []);
assert.deepEqual(transferred.characters[0].establishedTraits, []);
assert.deepEqual(mergeDelta(prior, { trackedItems: [], worldFacts: [] }).trackedItems, []);
const fullCleared = preserveOffSceneEntities({ characters: [{ name: 'Alice', conditions: [], establishedTraits: [], emotionalState: [] }], trackedItems: [], worldFacts: [] }, prior);
assert.deepEqual(fullCleared.characters[0].conditions, []);
assert.deepEqual(fullCleared.worldFacts, []);
const revealed = normalizeTracker(preserveOffSceneEntities({ characters: [{ name: 'Alina', aliases: ['Alice'] }] }, prior));
assert.deepEqual(revealed.characters[0].conditions, [condition]);
assert.equal(revealed.trackedItems[0].owner, 'Alina');
assert.equal(revealed.characters[0].emotionalState, undefined);
assert.equal(mergeDelta(prior, { characters: [{ name: 'Alina', aliases: ['Alice'] }] }).trackedItems[0].owner, 'Alina');
assert.deepEqual(prior, original, 'merges must not alter saved history');

// Next-response context follows the switches, including nested knowledge fields.
saveSnapshot(1, structuredClone(prior), 0);
for (const [toggle, key] of [['char_conditions', 'conditions'], ['char_emotionalState', 'emotionalState'], ['char_establishedTraits', 'establishedTraits'], ['trackedItems', 'trackedItems'], ['worldFacts', 'worldFacts'], ['char_knowledgeProvenance', 'learnedFrom']]) {
    assert.ok(buildInlineTrackerPrompt().includes(`"${key}"`));
    profile.fieldToggles[toggle] = false;
    const schema = getActiveSchema();
    const prompt = getActivePrompt();
    assert.ok(!JSON.stringify(prepareSnapshotContext(prior, schema)).includes(`"${key}"`));
    assert.ok(!buildInlineTrackerPrompt().includes(`"${key}"`));
    assert.ok(!prompt.includes(key === 'learnedFrom' ? 'learnedFrom' : `- ${key}:`));
    if (key === 'learnedFrom') assert.ok(schema.value.properties.characters.items.properties.knowledge, 'knowledge itself remains enabled');
    profile.fieldToggles[toggle] = true;
}
profile.fieldToggles.char_knowledge = false;
assert.ok(!JSON.stringify(prepareSnapshotContext(prior, getActiveSchema())).includes('learnedFrom'));
profile.fieldToggles.char_knowledge = true;
assert.deepEqual(getSnapshotFor(1).characters[0].knowledge, [knowledge]);
const offScene = prepareSnapshotContext({ ...prior, charactersPresent: [] }, fullSchema)._offSceneCharacters[0];
assert.deepEqual(offScene.conditions, [condition]);
assert.deepEqual(offScene.establishedTraits, [trait]);
assert.ok(!Object.hasOwn(offScene, 'emotionalState'));
const resolved = prepareSnapshotContext({ ...prior, worldFacts: [{ ...fact, status: 'superseded' }], characters: [{ ...alice, conditions: [{ ...condition, status: 'resolved' }] }] }, fullSchema);
assert.deepEqual(resolved.worldFacts, []);
assert.deepEqual(resolved.characters[0].conditions, []);

// Real extraction validation, normalization, persistence and parallel transport.
const schema = { type: 'object', properties: {
    elapsed: { type: 'string' }, trackedItems: fullSchema.value.properties.trackedItems, worldFacts: fullSchema.value.properties.worldFacts,
    characters: { type: 'array', items: { type: 'object', properties: {
        name: { type: 'string' }, role: { type: 'string' },
        ...Object.fromEntries(['conditions', 'emotionalState', 'establishedTraits', 'knowledge'].map(k => [k, fullSchema.value.properties.characters.items.properties[k]])),
    }, required: ['name'] } },
}, required: ['elapsed', 'characters'] };
assert.ok(validateExtraction({ ...prior, trackedItems: [{ ...item, quantity: null }] }, { schema }).valid, 'unknown quantity is a valid required nullable field');
assert.ok(!validateExtraction({ ...prior, trackedItems: [{ ...item, quantity: -1 }] }, { schema }).valid);
assert.ok(!validateExtraction({ ...prior, trackedItems: [{ ...item, quantity: undefined }] }, { schema }).valid);
const saved = await processExtraction(1, { ...prior, trackedItems: [playerItem] }, 'auto:together', { frozenDeltaMode: false, frozenRequestSchema: schema, baseSnapshot: prior });
assert.deepEqual(saved.trackedItems, [playerItem]);
assert.deepEqual(getSnapshotFor(1).characters[0].knowledge, [knowledge]);
assert.deepEqual(Object.keys(buildRequestSchema({ value: schema }, { mode: 'section', fields: ['trackedItems', 'worldFacts'] }).value.properties), ['trackedItems', 'worldFacts']);
const requests = [];
const request = async args => {
    requests.push(args);
    const props = args.jsonSchema.value.properties;
    if (props.charactersPresent) return { value: { elapsed: '1m', charactersPresent: ['Alice'] } };
    if (props.characters) return { value: { characters: [alice] } };
    return { value: { trackedItems: [playerItem], worldFacts: [fact] } };
};
const options = { fullSchema: { value: schema }, systemPrompt: getActivePrompt(), contextText: 'Alice gives User the key.', previousSnapshot: prior, profileId: 'p', maxRetries: 0, request };
const built = await runParallelFullBuild(options);
assert.deepEqual(built.value.trackedItems, [playerItem]);
assert.deepEqual(built.value.characters[0].emotionalState, [emotion]);
assert.equal(requests.filter(r => r.jsonSchema.value.properties.trackedItems).length, 1, 'Global alone owns item transfers');
const carried = await runParallelFullBuild({ ...options, request: async args => {
    if (args.jsonSchema.value.properties.characters) throw new Error('503 unavailable');
    return request(args);
} });
assert.equal(carried.meta.partial, true);
assert.deepEqual(carried.value.characters[0].conditions, [condition]);
assert.deepEqual(carried.value.characters[0].emotionalState, [], 'partial fallback cannot present an old emotion as current');
const disabled = structuredClone(schema);
for (const key of ['conditions', 'emotionalState', 'establishedTraits']) delete disabled.properties.characters.items.properties[key];
for (const key of ['learnedFrom', 'channel', 'verification']) delete disabled.properties.characters.items.properties.knowledge.items.properties[key];
delete disabled.properties.trackedItems;
delete disabled.properties.worldFacts;
requests.length = 0;
await runParallelFullBuild({ ...options, fullSchema: { value: disabled }, systemPrompt: 'Track', request });
const wire = JSON.stringify(requests);
for (const value of ['Bruised arm', 'Repairs radios', 'Her hands trembled', 'learnedFrom', 'Brass key', 'The gate closes at sunset']) assert.ok(!wire.includes(value), value);

assert.ok(renderSceneState({ trackedItems: [{ ...playerItem, quantity: 0 }] }).includes('Player'));
assert.ok(renderSceneState({ trackedItems: [{ ...item, quantity: 0 }] }).includes('>0<'));
assert.equal(renderSceneState(prior, { trackedItems: false, worldFacts: false }), '');
assert.equal(renderCharacterState(alice, { char_conditions: false, char_emotionalState: false, char_establishedTraits: false }), '');
assert.equal(renderKnowledgeProvenance(knowledge, { char_knowledgeProvenance: false }), '');
assert.ok(!renderSceneState({ worldFacts: [{ ...fact, detail: '<script>bad</script>' }] }).includes('<script>'));
assert.ok(!renderCharacterState({ conditions: [{ ...condition, source: '<img onerror=bad>' }] }).includes('<img'));
assert.ok(!renderKnowledgeProvenance({ ...knowledge, learnedFrom: '<img onerror=bad>' }).includes('<img'));
assert.ok(!(await import('../src/logger.js')).debugLog.some(line => line.includes('panel update failed')), 'ordinary extraction renders without UI errors');
console.log('PASS six state facets: switches, evidence, lifecycle, transfers, aliases, context, saved pipeline, lanes and UI');
