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
const { getActiveProfile } = await import('../src/profiles.js');
const { prepareSnapshotContext, normalizeActivityPlans, normalizeNarrativeHooks } = await import('../src/continuity.js');
const { normalizeTracker } = await import('../src/normalize.js');
const { mergeDelta, preserveOffSceneEntities } = await import('../src/generation/delta-merge.js');
const { buildInlineTrackerPrompt } = await import('../src/generation/interceptor.js');
const { buildRequestSchema } = await import('../src/schema.js');
const { processExtraction } = await import('../src/generation/pipeline.js');
const { validateExtraction } = await import('../src/generation/validation.js');
const { runParallelFullBuild } = await import('../src/generation/parallel-build.js');
const { renderNarrativeHooks, renderCharacterContinuity } = await import('../src/ui/continuity-view.js');

const settings = getSettings();
getActiveSchema(); // Initialize the persisted profile before editing its toggles.
const profile = getActiveProfile(settings);
const plan = { id: 'repair', goal: 'Repair the radio', status: 'planned', progress: '', location: 'Workshop', condition: 'After lunch', source: 'Alice said she would repair it after lunch.' };
const hook = { id: 'seal', detail: 'The seal on the unopened letter is broken', status: 'open', condition: '', source: 'The narrator described the damaged seal.' };
const prior = { charactersPresent: ['Alice'], characters: [{ name: 'Alice', role: 'Mechanic', activityPlans: [plan] }], narrativeHooks: [hook] };
const original = structuredClone(prior);
const fullSchema = getActiveSchema();
assert.ok(fullSchema.value.properties.narrativeHooks);
assert.ok(fullSchema.value.properties.characters.items.properties.activityPlans);
assert.ok(!fullSchema.value.required.includes('narrativeHooks'));
assert.ok(!fullSchema.value.properties.characters.items.required.includes('activityPlans'));
assert.deepEqual(normalizeTracker(prior).narrativeHooks, [hook]);
assert.deepEqual(normalizeTracker(prior).characters[0].activityPlans, [plan]);
assert.deepEqual(normalizeActivityPlans([plan, plan, { ...plan, id: 'fake', source: '' }]), [plan]);
assert.deepEqual(normalizeNarrativeHooks([hook, { ...hook, id: 'bad', status: 'fired' }]), [hook]);

// No turn ticking, fabricated progress or expiry; absence and [] differ.
let elapsed = prior;
for (let i = 0; i < 15; i++) elapsed = mergeDelta(elapsed, { charactersPresent: [], characters: [] });
assert.deepEqual(elapsed.characters[0].activityPlans, [plan]);
assert.deepEqual(elapsed.narrativeHooks, [hook]);
const revealed = preserveOffSceneEntities({ characters: [{ name: 'Alina', aliases: ['Alice'] }] }, prior);
assert.deepEqual(revealed.characters[0].activityPlans, [plan]);
assert.deepEqual(revealed.narrativeHooks, [hook]);
const cleared = mergeDelta(prior, { characters: [{ name: 'Alice', activityPlans: [] }], narrativeHooks: [] });
assert.deepEqual(cleared.characters[0].activityPlans, []);
assert.deepEqual(cleared.narrativeHooks, []);
const fullCleared = preserveOffSceneEntities({ characters: [{ name: 'Alice', activityPlans: [] }], narrativeHooks: [] }, prior);
assert.deepEqual(fullCleared.characters[0].activityPlans, []);
assert.deepEqual(fullCleared.narrativeHooks, []);
const done = { ...prior, characters: [{ ...prior.characters[0], activityPlans: [{ ...plan, status: 'completed' }] }], narrativeHooks: [{ ...hook, status: 'resolved' }] };
const projected = prepareSnapshotContext(done, fullSchema);
assert.deepEqual(projected.characters[0].activityPlans, []);
assert.deepEqual(projected.narrativeHooks, []);
assert.deepEqual(prepareSnapshotContext({ ...prior, charactersPresent: [] }, fullSchema)._offSceneCharacters[0].activityPlans, [plan]);
assert.deepEqual(prior, original);

saveSnapshot(1, structuredClone(prior), 0);
assert.ok(getActivePrompt().includes('activityPlans:'));
assert.ok(buildInlineTrackerPrompt().includes('narrativeHooks:'));
for (const [toggle, field] of [['char_activityPlans', 'activityPlans'], ['narrativeHooks', 'narrativeHooks']]) {
    profile.fieldToggles[toggle] = false;
    const schema = getActiveSchema();
    assert.ok(!getActivePrompt().includes(`- ${field}:`));
    assert.ok(!buildInlineTrackerPrompt().includes(`"${field}"`));
    assert.ok(!JSON.stringify(prepareSnapshotContext(prior, schema)).includes(`"${field}"`));
    assert.ok(field === 'activityPlans' ? schema.value.properties.narrativeHooks : schema.value.properties.characters.items.properties.activityPlans, 'switches are independent');
    profile.fieldToggles[toggle] = true;
}
assert.deepEqual(getSnapshotFor(1).characters[0].activityPlans, [plan], 'switches preserve saved history');

// Exercise the real extraction→normalize→save pipeline with a focused schema.
const schema = { type: 'object', properties: {
    elapsed: { type: 'string' },
    narrativeHooks: fullSchema.value.properties.narrativeHooks,
    characters: { type: 'array', items: { type: 'object', properties: {
        name: { type: 'string' }, activityPlans: fullSchema.value.properties.characters.items.properties.activityPlans,
    }, required: ['name'] } },
}, required: ['elapsed', 'characters'] };
assert.ok(!validateExtraction({ elapsed: '1m', characters: [], narrativeHooks: [{ ...hook, status: 'fired' }] }, { schema }).valid);
const saved = await processExtraction(1, { elapsed: '1m', characters: [{ name: 'Alice', activityPlans: [{ ...plan, status: 'active', progress: 'Opened the case', source: 'Alice opened the case.' }] }], narrativeHooks: [hook] }, 'auto:together', {
    frozenDeltaMode: false, frozenRequestSchema: schema, baseSnapshot: prior,
});
assert.equal(saved.characters[0].activityPlans[0].status, 'active');
assert.deepEqual(getSnapshotFor(1).narrativeHooks, [hook]);
assert.ok(buildRequestSchema({ value: schema }, { mode: 'section', fields: ['narrativeHooks'] }).value.properties.narrativeHooks);

const requests = [];
const request = async args => {
    requests.push(args);
    const props = args.jsonSchema.value.properties;
    return { value: Object.hasOwn(props, 'charactersPresent') ? { elapsed: '1m', charactersPresent: ['Alice'] }
        : Object.hasOwn(props, 'characters') ? { characters: [{ name: 'Alice', ...(props.characters.items.properties.activityPlans ? { activityPlans: [plan] } : {}) }] }
        : { narrativeHooks: [hook] } };
};
const built = await runParallelFullBuild({ fullSchema: { value: schema }, systemPrompt: getActivePrompt(), contextText: 'Alice describes her plan.', previousSnapshot: prior, profileId: 'p', maxRetries: 0, request });
assert.deepEqual(built.value.characters[0].activityPlans, [plan]);
assert.deepEqual(built.value.narrativeHooks, [hook]);
assert.equal(requests.filter(r => r.jsonSchema.value.properties.narrativeHooks).length, 1, 'only Global owns hooks');
const disabledSchema = structuredClone(schema);
delete disabledSchema.properties.characters.items.properties.activityPlans;
delete disabledSchema.properties.narrativeHooks;
requests.length = 0;
await runParallelFullBuild({ fullSchema: { value: disabledSchema }, systemPrompt: 'Track', contextText: 'Alice waits.', previousSnapshot: prior, profileId: 'p', maxRetries: 0, request });
assert.ok(!JSON.stringify(requests).includes('Repair the radio'), 'disabled plans cannot leak through lane previous state');
assert.ok(!JSON.stringify(requests).includes('damaged seal'), 'disabled hooks cannot leak through lane previous state');

assert.ok(renderCharacterContinuity(prior.characters[0]).includes('Repair the radio'));
assert.ok(!renderCharacterContinuity(prior.characters[0], { char_activityPlans: false }).includes('Repair the radio'));
assert.equal(renderNarrativeHooks([hook], { narrativeHooks: false }), '');
assert.ok(!renderNarrativeHooks([{ ...hook, detail: '<img src=x onerror=alert(1)>' }]).includes('<img'));
assert.ok(!renderCharacterContinuity({ activityPlans: [{ ...plan, source: '<script>bad()</script>' }] }).includes('<script>'));
assert.ok(!(await import('../src/logger.js')).debugLog.some(line => line.includes('panel update failed')), 'ordinary extraction renders without UI errors');
console.log('PASS plans/hooks schema, switches, lifecycle, context, persistence, lanes and escaping');
