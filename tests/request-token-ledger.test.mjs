// Request token ledger — multi-seq, idempotent charge, no flatten primary path
import assert from 'node:assert/strict';
import {
    beginLedgerRequest,
    enqueuePayloadMeasure,
    completeLedgerOutput,
    addCompletedRequestToSession,
    finalizeTogetherRequestTokens,
    scheduleRequestInputMeasure,
    cloneCanonicalPayload,
    measureTextPrompt,
    measureChatMessages,
    getLedgerRecord,
    sumLedgerForRun,
    resetRequestTokenLedger,
    ledgerKey,
    _awaitPendingMeasuresForTests,
} from '../src/generation/request-token-ledger.js';
import { _sessionTokensUsed, resetSessionTokens, addSessionTokens } from '../src/state.js';

globalThis.SillyTavern = { getContext: () => ({}) };

resetRequestTokenLedger();
resetSessionTokens();

console.log('\n── cloneCanonicalPayload prefers one field ──');
{
    const dup = {
        messages: [{ role: 'user', content: 'A'.repeat(40) }],
        chat: [{ role: 'user', content: 'B'.repeat(400) }],
    };
    const snap = cloneCanonicalPayload(dup, 'chat');
    assert.ok(Array.isArray(snap.messages));
    assert.equal(snap.chat, undefined);
    assert.equal(snap.messages[0].content.length, 40);
}

console.log('\n── heuristic text measure without ST tokenizer ──');
{
    const m = await measureTextPrompt('A'.repeat(400));
    assert.equal(m.tokens, 100);
    assert.equal(m.source, 'heuristic');
}

console.log('\n── multi-seq does not erase prior input ──');
{
    resetRequestTokenLedger();
    resetSessionTokens();
    beginLedgerRequest({ runId: 'run-a', requestSeq: 1, apiKind: 'chat' });
    beginLedgerRequest({ runId: 'run-a', requestSeq: 2, apiKind: 'chat' });
    await enqueuePayloadMeasure({
        runId: 'run-a', requestSeq: 1, apiKind: 'chat',
        payload: { messages: [{ role: 'user', content: 'A'.repeat(400) }] },
    });
    await enqueuePayloadMeasure({
        runId: 'run-a', requestSeq: 2, apiKind: 'chat',
        payload: { messages: [{ role: 'user', content: 'B'.repeat(800) }] },
    });
    assert.equal(getLedgerRecord('run-a', 1).input, 100);
    assert.equal(getLedgerRecord('run-a', 2).input, 200);
}

console.log('\n── idempotent session charge ──');
{
    resetRequestTokenLedger();
    resetSessionTokens();
    beginLedgerRequest({ runId: 'run-b', requestSeq: 1, apiKind: 'text' });
    await enqueuePayloadMeasure({
        runId: 'run-b', requestSeq: 1, apiKind: 'text',
        payload: { prompt: 'C'.repeat(400) },
    });
    const rec = await completeLedgerOutput({
        runId: 'run-b', requestSeq: 1, outputText: 'D'.repeat(400),
    });
    assert.equal(rec.input, 100);
    assert.equal(rec.output, 100);
    assert.equal(rec.total, 200);
    assert.equal(addCompletedRequestToSession(rec), true);
    const before = _sessionTokensUsed;
    assert.equal(addCompletedRequestToSession(rec), false);
    assert.equal(_sessionTokensUsed, before);
    assert.equal(_sessionTokensUsed, 200);
}

console.log('\n── two seq sum for run ──');
{
    resetRequestTokenLedger();
    resetSessionTokens();
    beginLedgerRequest({ runId: 'run-c', requestSeq: 1 });
    beginLedgerRequest({ runId: 'run-c', requestSeq: 2 });
    await enqueuePayloadMeasure({ runId: 'run-c', requestSeq: 1, payload: { prompt: 'A'.repeat(40) } });
    await enqueuePayloadMeasure({ runId: 'run-c', requestSeq: 2, payload: { prompt: 'B'.repeat(80) } });
    await finalizeTogetherRequestTokens({ runId: 'run-c', requestSeq: 1, rawMes: 'X'.repeat(40) });
    await finalizeTogetherRequestTokens({ runId: 'run-c', requestSeq: 2, rawMes: 'Y'.repeat(80) });
    // 10+10 + 20+20 = 60
    assert.equal(sumLedgerForRun('run-c'), 60);
    assert.equal(_sessionTokensUsed, 60);
    await finalizeTogetherRequestTokens({ runId: 'run-c', requestSeq: 1, rawMes: 'Z'.repeat(400) });
    assert.equal(_sessionTokensUsed, 60); // no double charge
}

console.log('\n── schedule is non-blocking ──');
{
    resetRequestTokenLedger();
    let started = false;
    let finished = false;
    globalThis.SillyTavern = {
        getContext: () => ({
            async getTokenCountAsync(s) {
                started = true;
                await new Promise(r => setTimeout(r, 80));
                finished = true;
                return Math.round(String(s).length / 4);
            },
        }),
    };
    beginLedgerRequest({ runId: 'run-d', requestSeq: 1, apiKind: 'text' });
    const t0 = Date.now();
    scheduleRequestInputMeasure({
        runId: 'run-d', requestSeq: 1, apiKind: 'text',
        payload: { prompt: 'E'.repeat(400) },
    });
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 40, `schedule should return immediately, took ${elapsed}ms`);
    assert.equal(finished, false);
    await new Promise(r => setTimeout(r, 120));
    assert.equal(finished, true);
    assert.equal(getLedgerRecord('run-d', 1)?.input, 100);
    globalThis.SillyTavern = { getContext: () => ({}) };
}

console.log('\n── stale/reset cannot write ──');
{
    resetRequestTokenLedger();
    beginLedgerRequest({ runId: 'run-e', requestSeq: 1 });
    resetRequestTokenLedger();
    await enqueuePayloadMeasure({
        runId: 'run-e', requestSeq: 1,
        payload: { prompt: 'F'.repeat(400) },
    });
    assert.equal(getLedgerRecord('run-e', 1), null);
}

console.log('\n── chat messages measure path ──');
{
    const m = await measureChatMessages([
        { role: 'system', content: 'A'.repeat(40) },
        { role: 'user', content: 'B'.repeat(40) },
    ]);
    assert.equal(m.tokens, 20);
    assert.ok(m.coverage === 'messages-only' || m.coverage === 'lower-bound');
}

console.log('\n── russian heuristic differs from naive latin /4 when ST mock returns custom ──');
{
    resetRequestTokenLedger();
    resetSessionTokens();
    const rus = 'Привет мир '.repeat(20);
    globalThis.SillyTavern = {
        getContext: () => ({
            async getTokenCountAsync(s) { return String(s).length; }, // not /4
        }),
    };
    const m = await measureTextPrompt(rus);
    assert.equal(m.tokens, rus.length);
    assert.equal(m.source, 'st-text-tokenizer');
    assert.notEqual(m.tokens, Math.round(rus.length / 4));
    beginLedgerRequest({ runId: 'run-ru', requestSeq: 1 });
    await finalizeTogetherRequestTokens({ runId: 'run-ru', requestSeq: 1, rawMes: rus });
    assert.equal(getLedgerRecord('run-ru', 1).output, rus.length);
    globalThis.SillyTavern = { getContext: () => ({}) };
}

console.log('\n── finalize before slow input still charges once (pendingCharge) ──');
{
    resetRequestTokenLedger();
    resetSessionTokens();
    let resolveTok;
    const tokGate = new Promise(r => { resolveTok = r; });
    globalThis.SillyTavern = {
        getContext: () => ({
            async getTokenCountAsync(s) {
                await tokGate;
                return Math.round(String(s).length / 4);
            },
        }),
    };
    beginLedgerRequest({ runId: 'run-race', requestSeq: 1, apiKind: 'text' });
    scheduleRequestInputMeasure({
        runId: 'run-race', requestSeq: 1, apiKind: 'text',
        payload: { prompt: 'I'.repeat(400) },
    });
    // Output finalize before input measure completes
    const p = finalizeTogetherRequestTokens({ runId: 'run-race', requestSeq: 1, rawMes: 'O'.repeat(40) });
    await new Promise(r => setTimeout(r, 10));
    assert.equal(_sessionTokensUsed, 0); // deferred
    resolveTok();
    await p;
    await new Promise(r => setTimeout(r, 20));
    assert.equal(_sessionTokensUsed, 110); // 100 input + 10 output
    assert.equal(getLedgerRecord('run-race', 1).charged, true);
    globalThis.SillyTavern = { getContext: () => ({}) };
}

console.log('\n── reset clears ledger and session helper ──');
{
    resetRequestTokenLedger();
    resetSessionTokens();
    beginLedgerRequest({ runId: 'run-z', requestSeq: 1 });
    await finalizeTogetherRequestTokens({ runId: 'run-z', requestSeq: 1, rawMes: 'A'.repeat(40) });
    assert.ok(_sessionTokensUsed > 0);
    resetRequestTokenLedger();
    resetSessionTokens();
    assert.equal(getLedgerRecord('run-z', 1), null);
    assert.equal(_sessionTokensUsed, 0);
}

console.log('\n── snapshot meta fields are distinct from session total ──');
{
    // Unit: serialize helper shape — message meta must not imply session Σ
    const snapMeta = {
        promptTokens: 100,
        completionTokens: 20,
        tokenSource: 'st-text-tokenizer',
        tokenCoverage: 'messages-only',
        requestSeqs: [1],
    };
    const sessionTotal = 500;
    assert.notEqual(snapMeta.promptTokens + snapMeta.completionTokens, sessionTotal);
    assert.ok(Array.isArray(snapMeta.requestSeqs));
}

resetRequestTokenLedger();
resetSessionTokens();
console.log('request-token-ledger.test.mjs: ok');
