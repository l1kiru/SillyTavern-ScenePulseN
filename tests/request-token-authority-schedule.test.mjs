// Authority path must schedule input measure without awaiting tokenization.
import assert from 'node:assert/strict';
import {
    beginLedgerRequest,
    scheduleRequestInputMeasure,
    getLedgerRecord,
    resetRequestTokenLedger,
} from '../src/generation/request-token-ledger.js';
import { resetSessionTokens } from '../src/state.js';

resetRequestTokenLedger();
resetSessionTokens();

console.log('\n── afterVerifyScheduleMeasure returns before slow tokenizer ──');
{
    let finished = false;
    globalThis.SillyTavern = {
        getContext: () => ({
            async getTokenCountAsync(s) {
                await new Promise(r => setTimeout(r, 200));
                finished = true;
                return Math.round(String(s).length / 4);
            },
        }),
    };

    /** Mirrors index.js _authorityVerify post-ok path (no await on schedule). */
    function afterVerifyScheduleMeasure({ runId, requestSeq, payload, apiKind }) {
        scheduleRequestInputMeasure({ runId, requestSeq, payload, apiKind });
    }

    beginLedgerRequest({ runId: 'auth-1', requestSeq: 1, apiKind: 'text' });
    const t0 = Date.now();
    afterVerifyScheduleMeasure({
        runId: 'auth-1',
        requestSeq: 1,
        apiKind: 'text',
        payload: { prompt: 'P'.repeat(400) },
    });
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 50, `authority schedule must not await tokenize (took ${elapsed}ms)`);
    assert.equal(finished, false);
    await new Promise(r => setTimeout(r, 250));
    assert.equal(finished, true);
    assert.equal(getLedgerRecord('auth-1', 1)?.input, 100);
    globalThis.SillyTavern = { getContext: () => ({}) };
}

console.log('\n── chat path uses messages array (not flatten join as primary) ──');
{
    resetRequestTokenLedger();
    let sawMessages = false;
    globalThis.SillyTavern = {
        getContext: () => ({
            async countTokensOpenAIAsync(messages) {
                sawMessages = Array.isArray(messages);
                return 42;
            },
            async getTokenCountAsync() { return 999; },
        }),
    };
    beginLedgerRequest({ runId: 'auth-chat', requestSeq: 1, apiKind: 'chat' });
    scheduleRequestInputMeasure({
        runId: 'auth-chat',
        requestSeq: 1,
        apiKind: 'chat',
        payload: {
            messages: [
                { role: 'system', content: 'sys' },
                { role: 'user', content: 'hi' },
            ],
        },
    });
    await new Promise(r => setTimeout(r, 20));
    assert.equal(sawMessages, true);
    assert.equal(getLedgerRecord('auth-chat', 1)?.input, 42);
    assert.equal(getLedgerRecord('auth-chat', 1)?.source, 'st-chat-tokenizer');
    globalThis.SillyTavern = { getContext: () => ({}) };
}

resetRequestTokenLedger();
resetSessionTokens();
console.log('request-token-authority-schedule.test.mjs: ok');
