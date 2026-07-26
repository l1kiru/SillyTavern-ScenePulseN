// tests/reply-token-split.test.mjs
import assert from 'node:assert/strict';
import { estimateReplyTokenSplit, SP_MARKER_START, SP_MARKER_END } from '../src/generation/extraction.js';

const narrative = 'A'.repeat(400);
const trackerBody = '{"time":"12:00"}';
const mes = `${narrative}${SP_MARKER_START}${trackerBody}${SP_MARKER_END}`;
const split = estimateReplyTokenSplit(mes);
assert.equal(split.foundTracker, true);
assert.equal(split.narrativeTokens, Math.round(narrative.length / 4));
assert.equal(split.trackerTokens, Math.round((SP_MARKER_START + trackerBody + SP_MARKER_END).length / 4));
assert.equal(split.totalTokens, Math.round(mes.length / 4));
assert.ok(split.narrativeTokens > split.trackerTokens);

const noTracker = estimateReplyTokenSplit('just story text');
assert.equal(noTracker.foundTracker, false);
assert.equal(noTracker.trackerTokens, 0);
assert.ok(noTracker.narrativeTokens > 0);

console.log('reply-token-split.test.mjs: all tests passed');
