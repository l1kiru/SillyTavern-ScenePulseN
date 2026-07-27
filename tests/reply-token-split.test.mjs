// tests/reply-token-split.test.mjs
import assert from 'node:assert/strict';
import {
    estimateReplyTokenSplit,
    resolveReplyTokenTipParts,
    SP_MARKER_START,
    SP_MARKER_END,
} from '../src/generation/extraction.js';

const narrative = 'A'.repeat(400);
const trackerBody = '{"time":"12:00"}';
const mes = `${narrative}${SP_MARKER_START}${trackerBody}${SP_MARKER_END}`;
const split = estimateReplyTokenSplit(mes);
assert.equal(split.foundTracker, true);
assert.equal(split.narrativeTokens, Math.round(narrative.length / 4));
assert.equal(split.trackerTokens, Math.round((SP_MARKER_START + trackerBody + SP_MARKER_END).length / 4));
assert.equal(split.totalTokens, Math.round(mes.length / 4));
assert.ok(split.narrativeTokens > split.trackerTokens);
assert.ok(Math.abs(split.narrativeTokens + split.trackerTokens - split.totalTokens) <= 1);

// Post-strip narrative-only (callers must NOT use this for saving split)
const stripped = estimateReplyTokenSplit(narrative);
assert.equal(stripped.foundTracker, false);
assert.equal(stripped.trackerTokens, 0);
assert.equal(stripped.narrativeTokens, Math.round(narrative.length / 4));

// Tip: good pre-strip meta
const goodTip = resolveReplyTokenTipParts({
    narrativeTokens: split.narrativeTokens,
    trackerTokens: split.trackerTokens,
    completionTokens: split.totalTokens,
});
assert.deepEqual(goodTip, {
    narrativeTokens: split.narrativeTokens,
    trackerTokens: split.trackerTokens,
});

// Tip: bad post-strip meta (tracker=0, completion=full) → remainder tracker
const badTip = resolveReplyTokenTipParts({
    narrativeTokens: 378,
    trackerTokens: 0,
    completionTokens: 2804,
    liveMes: narrative, // stripped — foundTracker false, must not overwrite
});
assert.ok(badTip);
assert.equal(badTip.narrativeTokens, 378);
assert.equal(badTip.trackerTokens, 2804 - 378);

// Tip: live mes with markers still present (historical missing fields)
const liveTip = resolveReplyTokenTipParts({
    completionTokens: split.totalTokens,
    liveMes: mes,
});
assert.equal(liveTip.narrativeTokens, split.narrativeTokens);
assert.equal(liveTip.trackerTokens, split.trackerTokens);

// Tip: stripped live mes + no meta → no fake 0-tracker tip
assert.equal(
    resolveReplyTokenTipParts({ completionTokens: 2804, liveMes: narrative }),
    null,
);

console.log('reply-token-split.test.mjs: all tests passed');
