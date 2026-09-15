import assert from 'node:assert/strict';
import { canonicalizeTracker } from '../src/tracker-shape.js';
import { prepareSnapshotContext } from '../src/continuity.js';
import { validateExtraction } from '../src/generation/validation.js';
import { normalizeTracker } from '../src/normalize.js';

const strings = { type: 'array', items: { type: 'string' } };
const record = { type: 'array', items: { type: 'object', properties: { source: { type: 'string' }, status: { type: 'string' } }, required: ['source'] } };
const schema = { type: 'object', properties: {
    elapsed: { type: 'string' }, time: { type: 'string' }, temperature: { type: 'number' },
    sceneSummary: { type: 'string' }, storyThreads: record, narrativeHooks: record, trackedItems: record, worldFacts: record,
    charactersPresent: strings, characters: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, knowledge: record } } },
    mainQuests: strings, sideQuests: strings, northStar: { type: 'string' },
    customScore: { type: 'number' },
}, additionalProperties: false };

for (const name of ['scene', 'sceneDetails', 'sceneInfo', 'sceneAnalysis']) {
    const data = { [name]: { sceneSummary: 'At the station', storyThreads: [], narrativeHooks: [], trackedItems: [{ source: 'Key in pocket' }], worldFacts: [{ source: 'Elevator stops at two', status: 'active' }] } };
    assert.equal(validateExtraction(data, { schema }).valid, true);
    assert.ok(!Object.hasOwn(data, name));
    assert.equal(data.trackedItems[0].source, 'Key in pocket');
    assert.equal(data.worldFacts.length, 1);
    assert.equal(validateExtraction({ [name]: { trackedItems: 'wrong type' } }, { schema }).valid, false);
    assert.equal(validateExtraction({ [name]: { worldFacts: [{}] } }, { schema }).valid, false);
}
for (const name of ['questJournal', 'quests']) {
    assert.deepEqual(canonicalizeTracker({ [name]: { mainQuests: ['Find key'] } }, schema), { mainQuests: ['Find key'] });
}
assert.deepEqual(canonicalizeTracker({ time: '', temperature: 0, trackedItems: [], environment: { time: 'wrong', temperature: 25 }, sceneAnalysis: { trackedItems: [{ source: 'old' }] } }, schema), { time: '', temperature: 0, trackedItems: [] });
assert.equal(validateExtraction({ trackedItems: 'invalid root', sceneAnalysis: { trackedItems: [] } }, { schema }).valid, false);

const old = { customScore: 7, sceneAnalysis: { trackedItems: [{ source: 'Key' }], worldFacts: [{ source: 'Fact', status: 'active' }], narrativeHooks: [{ source: 'Envelope', status: 'open' }], storyThreads: [{ source: 'Promise' }] }, arbitraryEnvelope: { trackedItems: [{ source: 'Leak' }] }, _spMeta: { source: 'internal' } };
const copy = structuredClone(old);
assert.equal(prepareSnapshotContext(old, schema).trackedItems.length, 1);
const disabled = structuredClone(schema);
for (const field of ['trackedItems', 'worldFacts', 'narrativeHooks', 'storyThreads']) delete disabled.properties[field];
assert.deepEqual(prepareSnapshotContext(old, disabled), { customScore: 7 });
assert.deepEqual(old, copy, 'historical data is never rewritten');

const customSchema = { type: 'object', properties: { sceneAnalysis: { type: 'object', properties: { customNote: { type: 'string' } } } } };
const custom = { sceneAnalysis: { customNote: 'Declared custom data' } };
assert.deepEqual(canonicalizeTracker(structuredClone(custom), customSchema), custom);
assert.deepEqual(prepareSnapshotContext(custom, customSchema), custom);
assert.deepEqual(normalizeTracker(custom, { schema: customSchema }).sceneAnalysis, custom.sceneAnalysis);

// A hidden operational roster still governs off-scene filtering, but is not sent.
const noRoster = structuredClone(schema);
delete noRoster.properties.charactersPresent;
const projected = prepareSnapshotContext({ charactersPresent: ['Alice'], characters: [{ name: 'Alice', hidden: 'no' }, { name: 'Ben', knowledge: [{ source: 'last known', hidden: 'no' }] }] }, noRoster);
assert.ok(!Object.hasOwn(projected, 'charactersPresent'));
assert.deepEqual(projected.characters, [{ name: 'Alice' }]);
assert.deepEqual(projected._offSceneCharacters, [{ name: 'Ben', knowledge: [{ source: 'last known' }] }]);
assert.deepEqual(prepareSnapshotContext({ sceneAnalysis: { charactersPresent: [] }, characters: [{ name: 'Ben', knowledge: [{ source: 'last known' }] }] }, noRoster), { characters: [], _offSceneCharacters: [{ name: 'Ben', knowledge: [{ source: 'last known' }] }] });
console.log('tracker-shape.test.mjs: passed');
