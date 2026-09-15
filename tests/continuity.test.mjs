import assert from 'node:assert/strict';

// Reuse the lightweight host surface used by the prompt/snapshot suites.
const ctx = {
    name1: 'User', name2: 'Alice', groupId: null, selected_group: null, groups: [], characters: [],
    chat: [{ is_user: true, mes: 'Hello' }, { is_user: false, mes: 'She makes a promise.', swipe_id: 0, swipes: ['She makes a promise.', 'She declines.'] }],
    chatMetadata: { scenepulse: { snapshots: {} } }, extensionSettings: { scenepulse: {} },
    saveMetadata() {}, saveSettingsDebounced() {},
};
globalThis.SillyTavern = { getContext: () => ctx };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.toastr = { error() {}, warning() {}, info() {}, success() {} };
globalThis.document = {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, contains() { return false; } } }),
    body: { dataset: {}, appendChild() {}, addEventListener() {} },
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
};
globalThis.window = { addEventListener() {} };

const { prepareSnapshotContext, CONTINUITY_RULES, CONTINUITY_CONTEXT_NOTE } = await import('../src/continuity.js');
const { buildDynamicSchema, buildRequestSchema } = await import('../src/schema.js');
const { getSettings, getActiveSchema, getActivePrompt, saveSnapshot, getSnapshotFor, getLatestSnapshot } = await import('../src/settings.js');
const { getActiveProfile } = await import('../src/profiles.js');
const { buildInlineTrackerPrompt, scenePulseInterceptor } = await import('../src/generation/interceptor.js');
const { mergeDelta, preserveOffSceneEntities } = await import('../src/generation/delta-merge.js');
const { normalizeTracker } = await import('../src/normalize.js');
const { validateExtraction } = await import('../src/generation/validation.js');
const { renderStoryThreads, renderCharacterContinuity, renderRelationshipContinuity } = await import('../src/ui/continuity-view.js');

const settings = getSettings();
const profile = getActiveProfile(settings);
const schema = getActiveSchema().value;
assert.ok(schema.properties.storyThreads);
assert.ok(schema.properties.characters.items.properties.knowledge);
assert.ok(schema.properties.relationships.items.properties.changeReason);
assert.ok(!schema.required.includes('storyThreads'), 'existing snapshots need no destructive migration');
assert.ok(!schema.properties.characters.items.required.includes('knowledge'));

const thread = { id: 'papers', summary: 'Bring papers tomorrow', status: 'open', condition: 'Tomorrow morning', source: 'Alice promised at the door.' };
const knowledge = [{ kind: 'belief', detail: 'Boris may have the key', source: 'Alice said she suspects Boris.' }];
const prior = {
    charactersPresent: ['Alice'], witnesses: [], storyThreads: [thread],
    characters: [{ name: 'Alice', role: 'friend', innerThought: 'I should go.', innerThoughtBasis: 'Interpretation: looked at the door.', currentIntent: 'Leave soon', knowledge },
        { name: 'Boris', role: 'neighbor', innerThought: 'OLD PRIVATE THOUGHT', currentIntent: 'OLD INTENT', shortTermGoal: 'Find the key', knowledge: [{ kind: 'known', detail: 'The drawer was empty', source: 'Saw it open.' }] }],
    relationships: [{ name: 'Alice', affection: 30, lastReaction: 'Annoyed', changeReason: 'Insult lowered affection.', relationshipBasis: 'Years of friendship', unresolvedConflicts: ['Unreturned loan'] },
        { name: 'Boris', lastReaction: 'OLD REACTION', relationshipBasis: 'Neighbors', unresolvedConflicts: ['Noise dispute'] }],
};
const original = structuredClone(prior);
const next = mergeDelta(prior, { charactersPresent: ['Alice'], witnesses: [], characters: [{ name: 'Alice', innerThought: 'Now calm.', immediateNeed: '' }], relationships: [{ name: 'Alice', affection: 31 }] });
assert.deepEqual(next.storyThreads, [thread]);
assert.deepEqual(next.characters[0].knowledge, knowledge);
assert.equal(next.characters[0].currentIntent, '');
assert.equal(next.characters[0].innerThoughtBasis, '');
assert.equal(next.relationships[0].lastReaction, '');
assert.equal(next.relationships[0].changeReason, '');
assert.deepEqual(next.relationships[0].unresolvedConflicts, ['Unreturned loan']);
assert.deepEqual(prior, original, 'building the next snapshot must not modify history');

const cleared = mergeDelta(prior, { charactersPresent: ['Alice'], storyThreads: [], characters: [{ name: 'Alice', knowledge: [] }], relationships: [{ name: 'Alice', unresolvedConflicts: [] }] });
assert.deepEqual(cleared.storyThreads, []);
assert.deepEqual(cleared.characters[0].knowledge, []);
assert.deepEqual(cleared.relationships[0].unresolvedConflicts, []);
const emptyScalars = mergeDelta(prior, {
    charactersPresent: ['Alice'], characters: [{ name: 'Alice', currentIntent: '', innerThoughtBasis: '' }],
    relationships: [{ name: 'Alice', lastReaction: '', changeReason: '', relationshipBasis: '' }],
});
assert.equal(emptyScalars.characters[0].currentIntent, '', 'explicit empty intention means completed/unknown');
assert.equal(emptyScalars.characters[0].innerThoughtBasis, '');
assert.equal(emptyScalars.relationships[0].lastReaction, '');
assert.equal(emptyScalars.relationships[0].changeReason, '');
assert.equal(emptyScalars.relationships[0].relationshipBasis, '');
const revealPrior = { characters: [{ name: 'Stranger', currentIntent: 'Leave', knowledge }], relationships: [{ name: 'Stranger', relationshipBasis: 'Old alliance', unresolvedConflicts: ['Loan'], lastReaction: 'Angry' }] };
const revealed = mergeDelta(revealPrior, {
    charactersPresent: ['Alice'], characters: [{ name: 'Alice', aliases: ['Stranger'], currentIntent: '', knowledge: [] }],
    relationships: [{ name: 'Alice', relationshipBasis: 'Reconciled alliance', unresolvedConflicts: [], lastReaction: 'Relieved' }],
});
assert.equal(revealed.characters[0].currentIntent, '');
assert.deepEqual(revealed.characters[0].knowledge, []);
assert.equal(revealed.relationships.length, 1);
assert.equal(revealed.relationships[0].relationshipBasis, 'Reconciled alliance');
assert.deepEqual(revealed.relationships[0].unresolvedConflicts, []);
assert.equal(revealed.relationships[0].lastReaction, 'Relieved');
const staleAlias = mergeDelta(revealed, {
    charactersPresent: ['Stranger'], characters: [{ name: 'Stranger', currentIntent: 'Stay' }],
    relationships: [{ name: 'Stranger', relationshipBasis: '', unresolvedConflicts: ['New dispute'], changeReason: 'New argument' }],
});
assert.equal(staleAlias.characters[0].name, 'Alice');
assert.equal(staleAlias.characters[0].currentIntent, 'Stay');
assert.equal(staleAlias.relationships[0].relationshipBasis, '');
assert.deepEqual(staleAlias.relationships[0].unresolvedConflicts, ['New dispute']);
assert.equal(staleAlias.relationships[0].changeReason, 'New argument');
const resolved = mergeDelta(prior, { charactersPresent: [], storyThreads: [{ ...thread, status: 'resolved' }] });
assert.equal(resolved.storyThreads[0].status, 'resolved');
assert.deepEqual(mergeDelta(resolved, { charactersPresent: [] }).storyThreads, []);

const full = preserveOffSceneEntities({ charactersPresent: ['Alina'], characters: [{ name: 'Alina', aliases: ['Alice'] }], relationships: [{ name: 'Alina' }] }, prior);
assert.deepEqual(full.characters[0].knowledge, knowledge, 'full refresh and name reveal preserve knowledge');
assert.deepEqual(full.relationships[0].unresolvedConflicts, ['Unreturned loan']);
assert.deepEqual(full.storyThreads, [thread]);
const fullCleared = preserveOffSceneEntities({ characters: [{ name: 'Alice', knowledge: [] }], relationships: [{ name: 'Alice', unresolvedConflicts: [] }], storyThreads: [] }, prior);
assert.deepEqual(fullCleared.characters[0].knowledge, []);
assert.deepEqual(fullCleared.storyThreads, []);

const norm = normalizeTracker(prior);
assert.deepEqual(norm.storyThreads, [thread]);
assert.deepEqual(norm.characters.find(ch => ch.name === 'Alice').knowledge, knowledge);
assert.equal(norm.characters.find(ch => ch.name === 'Alice').currentIntent, 'Leave soon');
assert.equal(norm.relationships.find(rel => rel.name === 'Alice').relationshipBasis, 'Years of friendship');
assert.deepEqual(normalizeTracker(norm), norm, 'normalization preserves continuity on repeat reads');

const projection = prepareSnapshotContext(prior, schema);
assert.deepEqual(projection._offSceneCharacters[0].knowledge, prior.characters[1].knowledge);
assert.equal(projection._offSceneCharacters[0].shortTermGoal, 'Find the key');
assert.ok(!JSON.stringify(projection).includes('OLD PRIVATE THOUGHT'));
assert.ok(!JSON.stringify(projection).includes('OLD INTENT'));
assert.ok(!JSON.stringify(projection).includes('OLD REACTION'));
assert.deepEqual(projection._offSceneRelationships[0].unresolvedConflicts, ['Noise dispute']);
assert.deepEqual(prior, original);
assert.deepEqual(prepareSnapshotContext(resolved, schema).storyThreads, []);

const disabledSettings = { panels: { scene: true, characters: true, relationships: true }, fieldToggles: { storyThreads: false, char_knowledge: false, char_currentIntent: false, rel_unresolvedConflicts: false }, customPanels: [] };
const disabledSchema = buildDynamicSchema(disabledSettings);
assert.ok(!disabledSchema.properties.storyThreads);
assert.ok(!disabledSchema.properties.characters.items.properties.knowledge);
assert.ok(!disabledSchema.properties.relationships.items.properties.unresolvedConflicts);
const disabledContext = prepareSnapshotContext(prior, disabledSchema);
assert.ok(!Object.hasOwn(disabledContext, 'storyThreads'));
assert.ok(!Object.hasOwn(disabledContext.characters[0], 'knowledge'));
assert.ok(!Object.hasOwn(disabledContext._offSceneCharacters[0], 'knowledge'));
assert.ok(!Object.hasOwn(disabledContext._offSceneRelationships[0], 'unresolvedConflicts'));

const deltaSchema = buildRequestSchema({ value: schema }, { mode: 'delta' }).value;
const validPayload = { time: '12:00', date: '09/15/2026', elapsed: '1m', charactersPresent: [], witnesses: [], plotBranches: [], storyThreads: [thread] };
delete deltaSchema.properties.plotBranches; deltaSchema.required = deltaSchema.required.filter(key => key !== 'plotBranches'); delete validPayload.plotBranches;
assert.ok(validateExtraction(validPayload, { schema: deltaSchema }).valid);
const threadSchema = buildRequestSchema({ value: schema }, { mode: 'section', fields: ['storyThreads'] }).value;
assert.ok(!validateExtraction({ storyThreads: [{ ...thread, status: 'predicted' }] }, { schema: threadSchema }).valid);

saveSnapshot(1, structuredClone(prior), 0);
assert.ok(getActivePrompt().includes(CONTINUITY_RULES), 'Separate receives extraction-only continuity rules');
let together = buildInlineTrackerPrompt();
assert.ok(together.includes(CONTINUITY_RULES), 'Together keeps rules below FIELD SPECIFICATIONS');
assert.ok(together.includes(CONTINUITY_CONTEXT_NOTE));
assert.ok(together.includes('storyThreads'));
assert.ok(together.includes('Boris may have the key'));
assert.ok(!together.includes('OLD PRIVATE THOUGHT'));
for (const style of ['compatible', 'full']) {
    profile.trackerPromptStyle = style;
    together = buildInlineTrackerPrompt();
    assert.ok(together.includes(CONTINUITY_RULES));
}
settings.injectionMethod = 'separate';
settings.parallelFullGeneration = true;
const outgoing = [{ is_user: true, mes: 'Continue' }];
await scenePulseInterceptor(outgoing, 10000, () => assert.fail('narrative must not be aborted for continuity'), 'normal');
assert.ok(outgoing.some(message => message.mes.includes(CONTINUITY_CONTEXT_NOTE)), 'Separate forwards descriptive state to the next story');
assert.equal(ctx.chat[1].mes, 'She makes a promise.', 'the original narrative remains untouched');

ctx.chat[1].swipe_id = 1; ctx.chat[1].mes = 'She declines.';
assert.equal(getSnapshotFor(1), null, 'a different swipe cannot borrow the promise');
saveSnapshot(1, { charactersPresent: [], characters: [], relationships: [], storyThreads: [] }, 1);
assert.deepEqual(getLatestSnapshot().storyThreads, []);
ctx.chat[1].swipe_id = 0; ctx.chat[1].mes = 'She makes a promise.';
assert.deepEqual(getSnapshotFor(1).storyThreads, [thread]);

const html = renderStoryThreads([{ ...thread, summary: '<img src=x onerror=alert(1)>' }]);
assert.ok(!html.includes('<img'));
assert.ok(html.includes('&lt;img'));
assert.equal(renderStoryThreads([thread], { storyThreads: false }), '');
assert.ok(renderCharacterContinuity(prior.characters[0]).includes('Alice said she suspects Boris.'));
assert.ok(!renderCharacterContinuity(prior.characters[0], { char_knowledge: false }).includes('Boris may have the key'));
assert.ok(renderRelationshipContinuity(prior.relationships[0]).includes('Unreturned loan'));
assert.equal(renderCharacterContinuity({}), '');
assert.equal(renderRelationshipContinuity({}), '');
console.log('PASS: descriptive continuity schema, lifecycle, context, swipe ownership and rendering');
