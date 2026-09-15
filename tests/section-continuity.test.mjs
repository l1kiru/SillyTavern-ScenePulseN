import assert from 'node:assert/strict';
import { installThoughtDom } from './helpers/thought-dom.mjs';
installThoughtDom();
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.toastr = { error() {}, warning() {}, info() {}, success() {} };
globalThis.getComputedStyle = () => ({ display: 'none', visibility: 'hidden' });
const ctx = {
    name1: 'User', name2: 'Alice', chatId: 'section', characterId: 0, characters: [], groups: [],
    chat: [{ is_user: true, mes: 'Hello' }, { is_user: false, mes: 'The stranger reveals her name.', swipe_id: 0 }],
    chatMetadata: { scenepulse: { snapshots: {} } }, extensionSettings: { scenepulse: { enabled: true, injectionMethod: 'separate', deltaMode: false, maxRetries: 0, showThoughts: false } },
    saveMetadata() {}, saveSettingsDebounced() {},
};
globalThis.SillyTavern = { getContext: () => ctx };
const { getSettings, getActiveSchema, saveSnapshot, getSnapshotFor } = await import('../src/settings.js');
const { getActiveProfile } = await import('../src/profiles.js');
const { CHARACTER_STATE_FIELDS } = await import('../src/state-records.js');
const { generateTracker } = await import('../src/generation/engine.js');
const { mergeDelta } = await import('../src/generation/delta-merge.js');
assert.equal(mergeDelta({ characters: [{ name: 'Alice', custom_note: 'Old note' }] }, { characters: [{ name: 'Alice', custom_note: '' }] }, { sectionFields: ['characters'] }).characters[0].custom_note, '', 'section permits explicit clearing of text custom fields');
const state = await import('../src/state.js');
getActiveSchema();
const profile = getActiveProfile(getSettings());
profile.schema = JSON.stringify({ type: 'object', properties: {
    elapsed: { type: 'string' }, sceneSummary: { type: 'string' },
    characters: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, aliases: { type: 'array', items: { type: 'string' } }, emotionalState: CHARACTER_STATE_FIELDS.emotionalState.schema, conditions: CHARACTER_STATE_FIELDS.conditions.schema }, required: ['name'] } },
}, required: ['elapsed', 'characters'] });
const emotion = { detail: 'Old fear', valence: 'negative', activation: 'high', control: 'overwhelmed', basis: 'observed', source: 'She trembled.' };
const condition = { id: 'wrist', detail: 'Bruised wrist', status: 'active', limitation: '', source: 'She bruised her wrist.' };
const prior = { charactersPresent: ['Stranger'], witnesses: ['Guard'], characters: [{ name: 'Stranger', emotionalState: [emotion], conditions: [condition] }], relationships: [{ name: 'Stranger', lastReaction: 'Still here' }], trackedItems: [{ id: 'key', name: 'Key', ownerType: 'npc', owner: 'Stranger', location: 'Pocket', condition: '', quantity: 1, status: 'held', source: 'She holds it.' }], sceneSummary: 'Before' };
let calls = 0;
let response;
ctx.generateRawData = async () => { calls++; return JSON.stringify(response); };
saveSnapshot(1, structuredClone(prior), 0);
response = { characters: [{ name: 'Alice', aliases: ['Stranger'] }] };
let result = await generateTracker(1, 'characters');
assert.deepEqual(result.characters.map(ch => ch.name), ['Alice']);
assert.deepEqual(result.charactersPresent, ['Alice']);
assert.deepEqual(result.characters[0].emotionalState, []);
assert.deepEqual(result.characters[0].conditions, [condition]);
assert.equal(result.relationships[0].name, 'Alice');
assert.equal(result.relationships[0].lastReaction, 'Still here');
assert.equal(result.trackedItems[0].owner, 'Alice');
assert.equal(result.sceneSummary, 'Before');
assert.deepEqual(getSnapshotFor(1).characters[0].emotionalState, []);

response = { characters: [{ name: 'Alice', conditions: [] }] };
result = await generateTracker(1, 'characters');
assert.deepEqual(result.characters[0].conditions, []);
saveSnapshot(1, structuredClone(prior), 0);
response = { sceneSummary: 'After' };
result = await generateTracker(1, 'scene');
assert.deepEqual(result.characters[0].emotionalState, [emotion], 'scene-only refresh leaves character state intact');
assert.deepEqual(result.witnesses, ['Guard']);

// Exercise the engine's post-save error boundary, beyond the pipeline check.
getSettings().showThoughts = true;
const raf = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = () => { throw new Error('Broken panel'); };
state.set_lastPanelUpdate(-Infinity);
result = await generateTracker(1, 'scene');
globalThis.requestAnimationFrame = raf;
assert.ok(result);
assert.equal(calls, 4, 'a UI exception never causes another provider call');
assert.equal(getSnapshotFor(1).sceneSummary, 'After');
saveSnapshot(1, structuredClone(prior), 0);
response = { elapsed: '1m', characters: [{ name: 'Stranger' }], sceneSummary: 'New full' };
result = await generateTracker(1);
assert.deepEqual(result.trackedItems, prior.trackedItems, 'full re-extraction preserves omitted durable records from this same trusted reply');
assert.deepEqual(result.characters[0].conditions, [condition]);
response = { ...response, trackedItems: [] };
result = await generateTracker(1);
assert.deepEqual(result.trackedItems, [], 'explicit empty list still clears durable state');
saveSnapshot(1, structuredClone(prior), 0);
ctx.chat[1].mes = 'A different scene after editing';
response = { elapsed: '1m', characters: [{ name: 'Stranger' }], sceneSummary: 'Edited scene' };
result = await generateTracker(1);
assert.ok(!result.trackedItems, 'an edited narrative cannot reuse stale same-message records');
saveSnapshot(1, structuredClone(prior), 0);
ctx.chat[1].swipe_id = 1;
ctx.chat[1].swipes = [ctx.chat[1].mes, 'A different swipe'];
ctx.chat[1].mes = 'A different swipe';
result = await generateTracker(1);
assert.ok(!result.trackedItems, 'a different swipe cannot borrow same-message records');
console.log('section-continuity.test.mjs: passed');
