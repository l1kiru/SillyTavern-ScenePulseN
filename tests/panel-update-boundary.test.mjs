import assert from 'node:assert/strict';
import { installThoughtDom } from './helpers/thought-dom.mjs';

const host = installThoughtDom();
globalThis.localStorage = { getItem: () => null, setItem() {} };
const ctx = {
    name1: 'User', name2: 'Alice', chatId: 'ui-boundary', characters: [], groups: [],
    chat: [{ is_user: true, mes: 'Hello' }, { is_user: false, mes: 'Alice waits.', swipe_id: 0 }],
    chatMetadata: { scenepulse: { snapshots: {} } }, extensionSettings: { scenepulse: {} },
    saveMetadata() {}, saveSettingsDebounced() {},
};
globalThis.SillyTavern = { getContext: () => ctx };
globalThis.toastr = { error() {}, warning() {}, info() {}, success() {} };
let now = 1000;
Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
const { updatePanel } = await import('../src/ui/update-panel.js');
const state = await import('../src/state.js');
const { getSnapshotFor } = await import('../src/settings.js');
const { processExtraction } = await import('../src/generation/pipeline.js');
const { debugLog } = await import('../src/logger.js');

state.set_lastPanelUpdate(0);
updatePanel({ characters: [], time: 'first' });
assert.ok(host.ids.has('sp-thought-panel'), 'the real thought-panel creation path ran');
assert.equal(state._cachedNormData.time, 'first');
now = 1100;
updatePanel({ characters: [], time: 'skipped' });
assert.equal(state._cachedNormData.time, 'first', 'debounce skips the render');
now = 1200;
updatePanel({ characters: [], time: 'next' });
assert.equal(state._cachedNormData.time, 'next', 'render resumes after debounce');
now = 1400;
const createdBeforeCharacter = host.created;
updatePanel({ charactersPresent: ['Alice'], characters: [{ name: 'Alice', innerThought: 'Wait here.' }] });
assert.ok(host.created > createdBeforeCharacter, 'a visible character renders a thought card');
assert.ok(!debugLog.some(line => line.includes('panel update failed')));

// Timeline navigation must render thoughts from the selected snapshot, including
// Jump to latest and historical scenes with no present characters.
const thoughtBody = document.getElementById('sp-tp-body');
let renderedThought = '';
thoughtBody.appendChild = card => { renderedThought += card.innerHTML; };
state.set_isTimelineScrub(true);
now = 1600;
updatePanel({ charactersPresent: ['Alice'], characters: [{ name: 'Alice', innerThought: 'Historical thought.' }] });
assert.ok(renderedThought.includes('Historical thought.'), 'scrubbing updates the actual thought card');
renderedThought = '';
now = 1800;
updatePanel({ charactersPresent: ['Alice'], characters: [{ name: 'Alice', innerThought: 'Current thought.' }] });
assert.ok(renderedThought.includes('Current thought.'), 'Jump to latest restores current thoughts');
now = 2000;
updatePanel({ charactersPresent: [], characters: [] });
assert.equal(thoughtBody.innerHTML, '', 'empty historical scene clears previous thoughts');
assert.equal(document.getElementById('sp-thought-panel').classList.contains('sp-tp-visible'), false);
state.set_isTimelineScrub(false);

now = 2300;
const lookup = document.getElementById;
document.getElementById = id => { if (id === 'sp-thought-panel') throw new Error('Broken panel'); return lookup(id); };
const result = await processExtraction(1, { elapsed: '1 minute', characters: [] }, 'test', {
    frozenRequestSchema: { type: 'object', properties: { elapsed: { type: 'string' }, characters: { type: 'array' } } },
});
assert.ok(result, 'a presentation exception does not reject a saved extraction');
assert.ok(getSnapshotFor(1), 'the saved snapshot survives presentation failure');
document.getElementById = lookup;
console.log('panel-update-boundary.test.mjs: passed');
