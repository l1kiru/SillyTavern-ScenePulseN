import assert from 'node:assert/strict';
import { estimateTokens, countTextTokens } from '../src/token-count.js';

assert.equal(estimateTokens(''), 0);
assert.equal(estimateTokens(null), 0);
assert.equal(estimateTokens('a'.repeat(335)), 100);
assert.equal(estimateTokens('я'.repeat(335)), 200);
assert.equal(estimateTokens('界'.repeat(335)), 300);
assert.equal(estimateTokens('😀'.repeat(335)), 400);
assert.deepEqual(await countTextTokens('text', { getTokenCountAsync: async () => 7 }), { tokens: 7, source: 'st-tokenizer' });
for (const value of [NaN, -1, undefined, '7']) {
    assert.deepEqual(await countTextTokens('text', { getTokenCountAsync: async () => value }), { tokens: 2, source: 'heuristic' });
}
assert.deepEqual(await countTextTokens('text', { getTokenCountAsync: async () => { throw new Error('offline'); } }), { tokens: 2, source: 'heuristic' });
assert.deepEqual(await countTextTokens('text', null), { tokens: 2, source: 'heuristic' });
console.log('token-count: passed');
