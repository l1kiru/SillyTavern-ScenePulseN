import assert from 'node:assert/strict';
import {
    createBuildTiming,
    getBuildTimings,
    _resetBuildTimingsForTests,
} from '../src/generation/build-timing.js';

_resetBuildTimingsForTests();
let clock = 100;
const recorder = createBuildTiming({
    generationId: 'separate-7',
    chatKey: 'chat-a',
    messageId: 12,
    swipeId: 2,
    mode: 'full',
    source: 'manual:full',
}, {
    now: () => clock,
    timestamp: () => '2026-08-24T20:00:00.000Z',
});

const prepare = recorder.startStage('prepare');
clock += 8;
recorder.finishStage(prepare);

const attempt = recorder.startAttempt({ attempt: 1, laneId: 'characters-0', characterNames: ['Alice', 'Bob'], promptMode: 'native', responseBudget: 16384, inputTokensEstimate: 1200 });
clock += 40;
recorder.markAttemptResponse(attempt, { strategy: 'quiet', outputChars: 800 });
clock += 5;
recorder.finishAttempt(attempt, 'ok', { outputTokensEstimate: 200 });

const save = recorder.startStage('save');
clock += 2;
recorder.finishStage(save);
clock += 1;
const result = recorder.finish('ok', { validationWarnings: 0 });

assert.equal(result.wallMs, 56);
assert.equal(result.stages.prepare.durationMs, 8);
assert.equal(result.stages.save.durationMs, 2);
assert.equal(result.attempts.length, 1);
assert.equal(result.attempts[0].requestMs, 40);
assert.equal(result.attempts[0].durationMs, 45);
assert.equal(result.attempts[0].status, 'ok');
assert.equal(result.attempts[0].responseBudget, 16384);
assert.equal(result.attempts[0].laneId, 'characters-0');
assert.deepEqual(result.attempts[0].characterNames, ['Alice', 'Bob']);
assert.equal(getBuildTimings().length, 1);

// Completion is idempotent and must not duplicate the ring-buffer entry.
recorder.finish('failed');
assert.equal(getBuildTimings().length, 1);
assert.equal(result.status, 'ok');

// Stage/attempt completion is also idempotent.
clock += 100;
recorder.finishStage(save, 'failed');
recorder.finishAttempt(attempt, 'failed');
assert.equal(result.stages.save.durationMs, 2);
assert.equal(result.attempts[0].status, 'ok');

console.log('build-timing.test.mjs: all tests passed');
