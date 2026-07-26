// Request token ledger — non-blocking measure of completed API requests.
// Separate from SP Context (injection-only) and ST Prompt Manager Total Tokens.

import { log, warn } from '../logger.js';
import { addSessionTokens } from '../state.js';

/** @typedef {'provider'|'st-chat-tokenizer'|'st-text-tokenizer'|'heuristic'} TokenSource */
/** @typedef {'exact'|'messages-only'|'lower-bound'} TokenCoverage */

/**
 * @typedef {object} RequestTokenRecord
 * @property {number} input
 * @property {number} output
 * @property {number} total
 * @property {TokenSource} source
 * @property {TokenCoverage} coverage
 * @property {string} runId
 * @property {number} requestSeq
 * @property {'pending'|'measured'|'terminal'} status
 * @property {string|null} apiKind
 * @property {string|null} chatKey
 * @property {boolean} charged
 * @property {boolean} inputReady
 * @property {boolean} outputReady
 */

const _ledger = new Map(); // key -> RequestTokenRecord
let _lastCoverage = 'exact';

function _getCtx() {
    try { return SillyTavern.getContext?.() || {}; } catch { return {}; }
}

function _messageContentTexts(m) {
    const out = [];
    if (!m || typeof m !== 'object') return out;
    const c = m.content ?? m.mes ?? m.value;
    if (typeof c === 'string') out.push(c);
    else if (Array.isArray(c)) {
        for (const part of c) {
            if (typeof part === 'string') out.push(part);
            else if (part && typeof part.text === 'string') out.push(part.text);
            else if (part && typeof part.content === 'string') out.push(part.content);
        }
    }
    return out;
}

export function ledgerKey(runId, requestSeq) {
    return `${String(runId || '')}:${Number(requestSeq) || 0}`;
}

export function getLedgerRecord(runId, requestSeq) {
    return _ledger.get(ledgerKey(runId, requestSeq)) || null;
}

export function sumLedgerForRun(runId) {
    let sum = 0;
    const id = String(runId || '');
    for (const rec of _ledger.values()) {
        if (rec.runId !== id) continue;
        if (rec.status === 'terminal' || rec.charged) sum += rec.total || 0;
    }
    return sum;
}

export function getLastSessionCoverage() {
    return _lastCoverage;
}

export function resetRequestTokenLedger() {
    _ledger.clear();
    _lastCoverage = 'exact';
}

export function beginLedgerRequest({ runId, requestSeq, apiKind = null, chatKey = null } = {}) {
    if (!runId || requestSeq == null) return null;
    const key = ledgerKey(runId, requestSeq);
    if (_ledger.has(key)) return _ledger.get(key);
    /** @type {RequestTokenRecord} */
    const rec = {
        input: 0,
        output: 0,
        total: 0,
        source: 'heuristic',
        coverage: 'lower-bound',
        runId: String(runId),
        requestSeq: Number(requestSeq) || 0,
        status: 'pending',
        apiKind: apiKind === 'text' || apiKind === 'chat' ? apiKind : null,
        chatKey: chatKey ?? null,
        charged: false,
        pendingCharge: false,
        inputScheduled: false,
        inputReady: false,
        outputReady: false,
    };
    _ledger.set(key, rec);
    return rec;
}

/** Prefer one canonical field: text prompt string XOR chat messages array. */
export function cloneCanonicalPayload(payload, apiKind = null) {
    if (payload == null) return null;
    if (typeof payload === 'string') return { prompt: payload };
    if (apiKind === 'text' || (typeof payload.prompt === 'string' && payload.prompt.length > 0)) {
        if (typeof payload.prompt === 'string') return { prompt: payload.prompt };
    }
    if (Array.isArray(payload.messages)) {
        try { return { messages: structuredClone(payload.messages) }; } catch {
            return { messages: JSON.parse(JSON.stringify(payload.messages)) };
        }
    }
    if (Array.isArray(payload.chat)) {
        try { return { chat: structuredClone(payload.chat) }; } catch {
            return { chat: JSON.parse(JSON.stringify(payload.chat)) };
        }
    }
    if (Array.isArray(payload.prompt)) {
        try { return { messages: structuredClone(payload.prompt) }; } catch {
            return { messages: JSON.parse(JSON.stringify(payload.prompt)) };
        }
    }
    if (typeof payload.prompt === 'string') return { prompt: payload.prompt };
    return null;
}

export async function measureTextPrompt(text) {
    const s = String(text ?? '');
    const ctx = _getCtx();
    try {
        if (typeof ctx.getTokenCountAsync === 'function') {
            const n = await ctx.getTokenCountAsync(s);
            if (Number.isFinite(n) && n >= 0) {
                return { tokens: Math.round(n), source: /** @type {TokenSource} */ ('st-text-tokenizer'), coverage: /** @type {TokenCoverage} */ ('exact') };
            }
        }
    } catch {}
    return { tokens: Math.round(s.length / 4), source: 'heuristic', coverage: 'lower-bound' };
}

export async function measureChatMessages(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const ctx = _getCtx();
    try {
        if (typeof ctx.countTokensOpenAIAsync === 'function') {
            const n = await ctx.countTokensOpenAIAsync(list, true);
            if (Number.isFinite(n) && n >= 0) {
                return { tokens: Math.round(n), source: 'st-chat-tokenizer', coverage: 'messages-only' };
            }
        }
    } catch {}
    // Sum per-message content via ST text tokenizer (no role/tool overhead).
    let sum = 0;
    let usedSt = false;
    try {
        if (typeof ctx.getTokenCountAsync === 'function') {
            for (const m of list) {
                const parts = _messageContentTexts(m);
                const blob = parts.join('\n');
                if (!blob) continue;
                const n = await ctx.getTokenCountAsync(blob);
                if (Number.isFinite(n) && n >= 0) {
                    sum += Math.round(n);
                    usedSt = true;
                } else {
                    sum += Math.round(blob.length / 4);
                }
            }
            if (usedSt) return { tokens: sum, source: 'st-text-tokenizer', coverage: 'messages-only' };
        }
    } catch {}
    let chars = 0;
    for (const m of list) chars += _messageContentTexts(m).join('\n').length;
    return { tokens: Math.round(chars / 4), source: 'heuristic', coverage: 'lower-bound' };
}

async function _measurePayload(payload, apiKind) {
    if (!payload) return { tokens: 0, source: 'heuristic', coverage: 'lower-bound' };
    if (typeof payload.prompt === 'string' && (apiKind === 'text' || !Array.isArray(payload.messages))) {
        return measureTextPrompt(payload.prompt);
    }
    const messages = Array.isArray(payload.messages) ? payload.messages
        : (Array.isArray(payload.chat) ? payload.chat : null);
    if (messages) return measureChatMessages(messages);
    if (typeof payload.prompt === 'string') return measureTextPrompt(payload.prompt);
    return { tokens: 0, source: 'heuristic', coverage: 'lower-bound' };
}

function _mergeSource(a, b) {
    const rank = { heuristic: 0, 'st-text-tokenizer': 1, 'st-chat-tokenizer': 2, provider: 3 };
    return (rank[a] || 0) <= (rank[b] || 0) ? a : b;
}

function _mergeCoverage(a, b) {
    const rank = { 'lower-bound': 0, 'messages-only': 1, exact: 2 };
    return (rank[a] ?? 0) <= (rank[b] ?? 0) ? a : b;
}

/**
 * Async input measure. Safe after plan clear if ledger row exists (pending).
 */
export async function enqueuePayloadMeasure({ runId, requestSeq, payload, apiKind = null } = {}) {
    const key = ledgerKey(runId, requestSeq);
    let rec = _ledger.get(key);
    if (!rec) {
        warn('TokenLedger: enqueue without begin', key);
        return null;
    }
    if (rec.inputReady || rec.charged) return rec;
    rec.inputScheduled = true;
    _ledger.set(key, rec);
    try {
        const measured = await _measurePayload(payload, apiKind || rec.apiKind);
        // Re-read: row may have been reset mid-await
        rec = _ledger.get(key);
        if (!rec || rec.charged) return rec;
        rec.input = measured.tokens;
        rec.inputReady = true;
        // Input measure replaces unset defaults; do not keep begin()'s heuristic.
        rec.source = measured.source;
        rec.coverage = measured.coverage;
        if (rec.outputReady) {
            rec.total = rec.input + rec.output;
            rec.status = 'terminal';
            _ledger.set(key, rec);
            if (rec.pendingCharge && !rec.charged) addCompletedRequestToSession(rec);
        } else {
            rec.status = 'measured';
            _ledger.set(key, rec);
        }
        return _ledger.get(key) || rec;
    } catch (e) {
        warn('TokenLedger: input measure failed', e?.message || e);
        return _ledger.get(key) || null;
    }
}

/** Fire-and-forget schedule after sync verify (must not block ST fetch). */
export function scheduleRequestInputMeasure({ runId, requestSeq, payload, apiKind = null } = {}) {
    const snap = cloneCanonicalPayload(payload, apiKind);
    if (!snap) return;
    if (!_ledger.has(ledgerKey(runId, requestSeq))) {
        beginLedgerRequest({ runId, requestSeq, apiKind });
    }
    void enqueuePayloadMeasure({ runId, requestSeq, payload: snap, apiKind });
}

export async function completeLedgerOutput({
    runId, requestSeq, outputText = '', outputTokens = null,
    outputSource = null, outputCoverage = null,
} = {}) {
    const key = ledgerKey(runId, requestSeq);
    let rec = _ledger.get(key);
    if (!rec) {
        // Allow late terminal without begin (e.g. Separate) — create shell
        rec = beginLedgerRequest({ runId, requestSeq });
    }
    if (!rec || rec.charged) return rec;
    let out = outputTokens;
    let outSource = outputSource;
    let outCoverage = outputCoverage;
    if (out == null || !Number.isFinite(out) || !outSource) {
        const measured = await measureTextPrompt(outputText);
        if (out == null || !Number.isFinite(out)) out = measured.tokens;
        outSource = outSource || measured.source;
        outCoverage = outCoverage || measured.coverage;
    }
    rec = _ledger.get(key);
    if (!rec || rec.charged) return rec;
    rec.output = Math.max(0, Math.round(out));
    rec.outputReady = true;
    // Prefer measured sides over begin() defaults; keep worse coverage for honesty.
    rec.source = rec.inputReady ? _mergeSource(rec.source, outSource) : outSource;
    rec.coverage = rec.inputReady ? _mergeCoverage(rec.coverage, outCoverage) : (outCoverage || rec.coverage);
    rec.total = (rec.input || 0) + rec.output;
    rec.status = 'terminal';
    _ledger.set(key, rec);
    return rec;
}

/** Idempotent session charge once input+output sides are filled (output may be 0). */
export function addCompletedRequestToSession(record) {
    if (!record) return false;
    const key = ledgerKey(record.runId, record.requestSeq);
    const rec = _ledger.get(key) || record;
    if (rec.charged) return false;
    if (!rec.outputReady) return false;
    if (!rec.inputReady) {
        // Finalize raced ahead of async input measure — charge when input lands.
        rec.pendingCharge = true;
        rec.status = 'terminal';
        _ledger.set(key, rec);
        return false;
    }
    const total = Math.max(0, Math.round((rec.input || 0) + (rec.output || 0)));
    rec.total = total;
    rec.status = 'terminal';
    rec.charged = true;
    rec.pendingCharge = false;
    _ledger.set(key, rec);
    if (total > 0) addSessionTokens(total);
    _lastCoverage = _mergeCoverage(_lastCoverage, rec.coverage);
    log('TokenLedger: charged', key, 'total=', total, 'source=', rec.source, 'coverage=', rec.coverage);
    return true;
}

/**
 * Finalize Together request tokens (tokenizer output + session charge).
 * Safe to call more than once — second call is a no-op.
 */
export async function finalizeTogetherRequestTokens({ runId, requestSeq, rawMes = '' } = {}) {
    if (!runId || requestSeq == null) return null;
    if (!_ledger.has(ledgerKey(runId, requestSeq))) {
        beginLedgerRequest({ runId, requestSeq, apiKind: null });
    }
    const out = await measureTextPrompt(rawMes);
    let rec = await completeLedgerOutput({
        runId,
        requestSeq,
        outputText: rawMes,
        outputTokens: out.tokens,
        outputSource: out.source,
        outputCoverage: out.coverage,
    });
    if (!rec) return null;
    // If input was never scheduled (no authority verify), charge with input=0.
    // If scheduled but still in flight, pendingCharge waits for enqueue.
    if (!rec.inputReady && !rec.inputScheduled) {
        rec.inputReady = true;
        rec.total = (rec.input || 0) + (rec.output || 0);
        _ledger.set(ledgerKey(runId, requestSeq), rec);
    }
    addCompletedRequestToSession(rec);
    return _ledger.get(ledgerKey(runId, requestSeq)) || rec;
}

/** Wait helper for tests: flush pending input measure. */
export async function _awaitPendingMeasuresForTests() {
    await new Promise(r => setTimeout(r, 0));
}

export function _resetRequestTokenLedgerForTests() {
    resetRequestTokenLedger();
}
