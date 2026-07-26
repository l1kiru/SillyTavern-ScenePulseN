// src/generation/prompt-injection.js — Together PromptInjectionPlan
//
// Run-scoped extension-prompt delivery + request-scoped integrity verification.
// Policy: deliver and measure; never budget-abort, compact, or auto-Separate.

import { fnv1aHex } from '../scene-source-trace/hash.js';
import { log, warn } from '../logger.js';
import {
    getActivePromptRole,
    toExtensionPromptRole,
    normalizePromptRoleName,
    isAllowedRoleTransition,
} from '../prompts/role.js';
import {
    setActivePromptInjectionRun,
    getActivePromptInjectionRun,
    setLastPromptInjectionMetrics,
    getLastPromptInjectionMetrics,
    setLastPromptInjectionFailure,
    setPromptAbortReason,
    clearPromptAbortReason,
    getPromptAbortReason,
    inlineGenerationContext,
} from '../state.js';

export const MAIN_KEY_PREFIX = 'scenepulse-main-';
export const TAIL_KEY_PREFIX = 'scenepulse-tail-';

const BEGIN_RE = /<!--SP_PROMPT_BEGIN\s+run="([^"]+)"\s+digest="([^"]+)"\s*-->/;
const END_RE = /<!--SP_PROMPT_END\s+run="([^"]+)"\s+digest="([^"]+)"\s*-->/;
const TAIL_RE = /<!--SP_PROMPT_TAIL\s+run="([^"]+)"\s*-->/;

const DEFAULT_TAIL =
    'End with <!--SP_TRACKER_START-->{tracker JSON}<!--SP_TRACKER_END--> only \u2014 no markdown fences, no commentary after the end marker. Do not repeat these instructions in the narrative.';

let _suspendDepth = 0;
let _authorityHandlersWired = false;
let _authorityReposition = null;

function _deepClone(value) {
    if (value == null) return value;
    try {
        if (typeof structuredClone === 'function') return structuredClone(value);
    } catch {}
    return JSON.parse(JSON.stringify(value));
}

/** Normalize newlines to \n for stable digests. */
export function normalizeNewlines(text) {
    return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Collapse consecutive newlines (SillyTavern Text Completion collapse_newlines). */
export function collapseNewlines(text) {
    return normalizeNewlines(text).replace(/\n{2,}/g, '\n');
}

export function digestText(text) {
    return fnv1aHex(normalizeNewlines(text));
}

function _newRunId() {
    const hex = Math.random().toString(16).slice(2, 8);
    return `sp-${hex}`;
}

function _getCtx() {
    try {
        return SillyTavern.getContext?.() || {};
    } catch {
        return {};
    }
}

function _extensionPromptTypes(ctx = _getCtx()) {
    return ctx.extension_prompt_types || ctx.extensionPromptTypes || {
        IN_PROMPT: 0,
        IN_CHAT: 1,
        BEFORE_PROMPT: 2,
    };
}

function _substituteParams(text, ctx = _getCtx()) {
    try {
        if (typeof ctx.substituteParams === 'function') return String(ctx.substituteParams(text) ?? text);
    } catch {}
    return String(text ?? '');
}

function _wrapMain(runId, sourceText, sourceDigest) {
    return `<!--SP_PROMPT_BEGIN run="${runId}" digest="${sourceDigest}"-->\n${sourceText}\n<!--SP_PROMPT_END run="${runId}" digest="${sourceDigest}"-->`;
}

function _wrapTail(runId, tailBody = DEFAULT_TAIL) {
    return `<!--SP_PROMPT_TAIL run="${runId}"-->\n${tailBody}`;
}

/**
 * Apply one allowlisted ST transform to sourceText and compare to candidate.
 * @returns {{ ok: boolean, transform: string|null, transformed: string|null }}
 */
export function matchAllowlistedTransform(sourceText, candidate) {
    const src = normalizeNewlines(sourceText);
    const cand = normalizeNewlines(candidate);
    if (cand === src) return { ok: true, transform: 'identity', transformed: cand };
    const collapsed = collapseNewlines(src);
    if (cand === collapsed) return { ok: true, transform: 'collapse_newlines', transformed: cand };
    // Re-macro: ST may substitute again; compare after substituting candidate back is not possible,
    // so accept candidate if substituteParams(source) equals candidate.
    const ctx = _getCtx();
    const reSub = normalizeNewlines(_substituteParams(src, ctx));
    if (cand === reSub) return { ok: true, transform: 're_macro', transformed: cand };
    const reSubCollapsed = collapseNewlines(reSub);
    if (cand === reSubCollapsed) return { ok: true, transform: 're_macro_collapse_newlines', transformed: cand };
    return { ok: false, transform: null, transformed: null };
}

/** Extract text blobs from Chat/Text completion event payloads. */
export function extractPayloadTexts(payload) {
    const texts = [];
    if (payload == null) return texts;
    if (typeof payload === 'string') {
        texts.push(payload);
        return texts;
    }
    const prompt = payload.prompt ?? payload.input ?? null;
    if (typeof prompt === 'string') texts.push(prompt);
    else if (Array.isArray(prompt)) {
        for (const m of prompt) texts.push(..._messageToTexts(m));
    }
    if (Array.isArray(payload.messages)) {
        for (const m of payload.messages) texts.push(..._messageToTexts(m));
    }
    if (payload.chat_completion_source != null && Array.isArray(payload.messages) === false && payload.prompt == null) {
        // settings-ready may nest chat body
        if (payload.chat?.messages) {
            for (const m of payload.chat.messages) texts.push(..._messageToTexts(m));
        }
    }
    return texts;
}

function _messageToTexts(m) {
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

/** Flatten all payload text for marker scanning. */
export function flattenPayloadText(payload) {
    return extractPayloadTexts(payload).join('\n');
}

export function findMainBlocks(flatText) {
    const begins = [...String(flatText).matchAll(new RegExp(BEGIN_RE.source, 'g'))];
    const ends = [...String(flatText).matchAll(new RegExp(END_RE.source, 'g'))];
    return { begins, ends, beginCount: begins.length, endCount: ends.length };
}

export function extractMainInner(flatText, runId) {
    const begin = `<!--SP_PROMPT_BEGIN run="${runId}"`;
    const end = `<!--SP_PROMPT_END run="${runId}"`;
    const bIdx = flatText.indexOf(begin);
    if (bIdx < 0) return null;
    const afterBegin = flatText.indexOf('-->', bIdx);
    if (afterBegin < 0) return null;
    const eIdx = flatText.indexOf(end, afterBegin);
    if (eIdx < 0) return null;
    const inner = flatText.slice(afterBegin + 3, eIdx).replace(/^\n/, '').replace(/\n$/, '');
    return normalizeNewlines(inner);
}

export function findTail(flatText, runId) {
    const re = new RegExp(`<!--SP_PROMPT_TAIL\\s+run="${runId}"\\s*-->`);
    return re.test(flatText);
}

export function findEffectiveMainRole(payload, runId) {
    if (!payload || typeof payload !== 'object') return null;
    const messages = payload.messages || payload.prompt;
    if (!Array.isArray(messages)) return null;
    const needle = `<!--SP_PROMPT_BEGIN run="${runId}"`;
    for (const m of messages) {
        const texts = _messageToTexts(m);
        if (texts.some(t => t.includes(needle))) {
            return normalizePromptRoleName(m.role);
        }
    }
    return null;
}

/**
 * Build a PromptInjectionPlan from Together builder text + frozen inputs.
 */
export function buildPromptInjectionPlan({
    text,
    role,
    owner,
    frozenRequestSchema,
    frozenDeltaMode,
    baseSnapshot,
    chatKey,
    messageId,
    swipeId,
} = {}) {
    clearPromptAbortReason();
    setLastPromptInjectionFailure(null);
    const runId = _newRunId();
    const registeredRole = role || getActivePromptRole();
    const ctx = _getCtx();
    const raw = String(text ?? '');
    const substituted = normalizeNewlines(_substituteParams(raw, ctx));
    const sourceText = substituted;
    const sourceDigest = digestText(sourceText);
    const mainText = _wrapMain(runId, sourceText, sourceDigest);
    const tailText = _wrapTail(runId);

    const plan = {
        runId,
        owner: owner || {
            chatKey: chatKey ?? null,
            messageId: messageId ?? null,
            swipeId: swipeId ?? null,
        },
        status: 'registered',
        main: {
            key: `${MAIN_KEY_PREFIX}${runId}`,
            position: 'IN_PROMPT',
            role: registeredRole,
            text: mainText,
            sourceText,
            digest: sourceDigest,
            tokens: null,
        },
        tail: {
            key: `${TAIL_KEY_PREFIX}${runId}`,
            position: 'IN_CHAT',
            depth: 0,
            role: registeredRole,
            text: tailText,
            tokens: null,
        },
        verification: {
            main: 'pending',
            tail: 'pending',
            finalHook: null,
        },
        estimateSource: null,
        provisionalTokens: null,
        verifiedTokens: null,
        verifiedRequestCount: 0,
        registeredRole,
        effectiveRole: registeredRole,
        frozenRequestSchema: _deepClone(frozenRequestSchema),
        frozenDeltaMode: !!frozenDeltaMode,
        baseSnapshot: _deepClone(baseSnapshot),
        currentRequest: null,
        suspendDepth: 0,
        materializeTransform: null,
        materializedText: null,
    };
    setActivePromptInjectionRun(plan);
    return plan;
}

export function beginRequest(apiKind, plan = getActivePromptInjectionRun()) {
    if (!plan) return null;
    const prev = plan.currentRequest?.seq || 0;
    plan.currentRequest = {
        seq: prev + 1,
        apiKind: apiKind === 'text' ? 'text' : 'chat',
        phase: 'awaiting-intermediate',
        materializedDigest: null,
    };
    plan.verification.main = 'pending';
    plan.verification.tail = 'pending';
    plan.verification.finalHook = null;
    plan.materializedText = null;
    plan.materializeTransform = null;
    setActivePromptInjectionRun(plan);
    return plan.currentRequest;
}

export async function countTokens(text) {
    const s = String(text ?? '');
    const ctx = _getCtx();
    try {
        if (typeof ctx.getTokenCountAsync === 'function') {
            const n = await ctx.getTokenCountAsync(s);
            if (Number.isFinite(n) && n >= 0) return { tokens: Math.round(n), source: 'st-tokenizer' };
        }
    } catch {}
    return { tokens: Math.round(s.length / 4), source: 'heuristic' };
}

export async function measurePromptInjection(plan = getActivePromptInjectionRun(), { provisional = false } = {}) {
    if (!plan) return null;
    const [main, tail] = await Promise.all([
        countTokens(provisional ? plan.main.sourceText : (plan.materializedText || plan.main.text)),
        countTokens(plan.tail.text),
    ]);
    const estimateSource = (main.source === 'heuristic' || tail.source === 'heuristic') ? 'heuristic' : 'st-tokenizer';
    plan.estimateSource = estimateSource;
    plan.main.tokens = main.tokens;
    plan.tail.tokens = tail.tokens;
    if (provisional) {
        plan.provisionalTokens = {
            mainInput: main.tokens,
            tailInput: tail.tokens,
            totalInput: main.tokens + tail.tokens,
            estimateSource,
        };
    }
    setActivePromptInjectionRun(plan);
    return { mainTokens: main.tokens, tailTokens: tail.tokens, estimateSource };
}

function _setExtensionPrompt(key, value, position, depth, scan, roleEnum) {
    const ctx = _getCtx();
    if (typeof ctx.setExtensionPrompt !== 'function') {
        warn('PromptInjection: setExtensionPrompt unavailable');
        return false;
    }
    ctx.setExtensionPrompt(key, value, position, depth, scan, roleEnum);
    return true;
}

function _unsetExtensionPrompt(key) {
    const ctx = _getCtx();
    try {
        if (typeof ctx.setExtensionPrompt === 'function') {
            // Empty value clears; some ST builds expose unsetExtensionPrompt
            if (typeof ctx.unsetExtensionPrompt === 'function') ctx.unsetExtensionPrompt(key);
            else ctx.setExtensionPrompt(key, '', 0, 0, false, 0);
        }
    } catch (e) {
        warn('PromptInjection: unset failed', key, e?.message);
    }
}

export function purgeStalePromptKeys(exceptRunId = null) {
    const ctx = _getCtx();
    const prompts = ctx.extension_prompts || ctx.extensionPrompts || null;
    const keys = [];
    if (prompts && typeof prompts === 'object') {
        for (const k of Object.keys(prompts)) {
            if (k.startsWith(MAIN_KEY_PREFIX) || k.startsWith(TAIL_KEY_PREFIX)) keys.push(k);
        }
    }
    const active = getActivePromptInjectionRun();
    if (active && (!exceptRunId || active.runId !== exceptRunId)) {
        keys.push(active.main.key, active.tail.key);
    }
    for (const k of new Set(keys)) {
        if (exceptRunId && (k === `${MAIN_KEY_PREFIX}${exceptRunId}` || k === `${TAIL_KEY_PREFIX}${exceptRunId}`)) continue;
        _unsetExtensionPrompt(k);
    }
}

export function registerPromptInjection(plan = getActivePromptInjectionRun()) {
    if (!plan) return false;
    const types = _extensionPromptTypes();
    const roleEnum = toExtensionPromptRole(plan.registeredRole);
    const okMain = _setExtensionPrompt(
        plan.main.key,
        plan.main.text,
        types.IN_PROMPT ?? 0,
        0,
        false,
        roleEnum,
    );
    const okTail = _setExtensionPrompt(
        plan.tail.key,
        plan.tail.text,
        types.IN_CHAT ?? 1,
        0,
        false,
        roleEnum,
    );
    plan.status = 'registered';
    setActivePromptInjectionRun(plan);
    return okMain && okTail;
}

export function suspendPromptInjection(plan = getActivePromptInjectionRun()) {
    _suspendDepth += 1;
    if (!plan) return _suspendDepth;
    plan.suspendDepth = _suspendDepth;
    if (_suspendDepth === 1) {
        _unsetExtensionPrompt(plan.main.key);
        _unsetExtensionPrompt(plan.tail.key);
    }
    setActivePromptInjectionRun(plan);
    return _suspendDepth;
}

export function restorePromptInjection(plan = getActivePromptInjectionRun()) {
    if (_suspendDepth > 0) _suspendDepth -= 1;
    if (!plan) return _suspendDepth;
    plan.suspendDepth = _suspendDepth;
    if (_suspendDepth === 0) registerPromptInjection(plan);
    setActivePromptInjectionRun(plan);
    return _suspendDepth;
}

export function clearPromptInjection(runId = null) {
    const active = getActivePromptInjectionRun();
    if (runId && active && active.runId !== runId) return false;
    const target = active;
    if (target) {
        _unsetExtensionPrompt(target.main.key);
        _unsetExtensionPrompt(target.tail.key);
    }
    if (!runId || (active && active.runId === runId)) {
        setActivePromptInjectionRun(null);
        _suspendDepth = 0;
    }
    return true;
}

export function shouldHandlePromptHook(eventData = {}, { requirePhase = null } = {}) {
    if (eventData?.dryRun) return false;
    if (eventData?.quiet || eventData?.type === 'quiet') return false;
    if (eventData?.generate_raw || eventData?.generateRaw) return false;
    const plan = getActivePromptInjectionRun();
    if (!plan || !plan.currentRequest) return false;
    // Together owner must be mid-flight
    if (!(inlineGenerationContext && inlineGenerationContext.chatKey != null)) {
        // still allow if plan owner matches and inline ctx briefly null — prefer plan presence
    }
    if (requirePhase && plan.currentRequest.phase !== requirePhase) return false;
    return true;
}

/**
 * Intermediate materialize: trust candidate only if it matches sourceText under allowlist.
 */
export function materializePromptInjection(payload, plan = getActivePromptInjectionRun()) {
    if (!plan?.currentRequest) {
        return { ok: false, code: 'SP_PROMPT_NO_ACTIVE_REQUEST' };
    }
    const flat = flattenPayloadText(payload);
    if (!flat) {
        return { ok: false, code: 'SP_PROMPT_UNREADABLE_PAYLOAD', observed: { begin: 0, end: 0 } };
    }
    const { beginCount, endCount, begins } = findMainBlocks(flat);
    const observed = { begin: beginCount, end: endCount };
    if (beginCount === 0 || endCount === 0) {
        return { ok: false, code: 'SP_PROMPT_MISSING_MAIN', observed };
    }
    if (beginCount > 1 || endCount > 1) {
        return { ok: false, code: 'SP_PROMPT_DUPLICATE_MAIN', observed };
    }
    const markerRun = begins[0][1];
    if (markerRun !== plan.runId) {
        return { ok: false, code: 'SP_PROMPT_FOREIGN_RUN', observed, foreignRunId: markerRun };
    }
    const digestInMarker = begins[0][2];
    if (digestInMarker !== plan.main.digest) {
        return { ok: false, code: 'SP_PROMPT_DIGEST_MISMATCH', observed };
    }
    const inner = extractMainInner(flat, plan.runId);
    if (inner == null) {
        return { ok: false, code: 'SP_PROMPT_MISSING_MAIN', observed };
    }
    const match = matchAllowlistedTransform(plan.main.sourceText, inner);
    if (!match.ok) {
        return { ok: false, code: 'SP_PROMPT_DIGEST_MISMATCH', observed, detail: 'candidate_not_allowlisted' };
    }
    plan.materializedText = match.transformed;
    plan.materializeTransform = match.transform;
    plan.currentRequest.materializedDigest = digestText(match.transformed);
    plan.currentRequest.phase = 'materialized';
    plan.verification.main = 'materialized';
    const tailFound = findTail(flat, plan.runId);
    plan.verification.tail = tailFound ? 'materialized' : 'missing';
    if (plan.currentRequest.apiKind === 'chat') {
        const eff = findEffectiveMainRole(payload, plan.runId);
        if (eff) {
            if (!isAllowedRoleTransition(plan.registeredRole, eff)) {
                return { ok: false, code: 'SP_PROMPT_ROLE_MISMATCH', observed, registeredRole: plan.registeredRole, effectiveRole: eff };
            }
            plan.effectiveRole = eff;
        }
    }
    setActivePromptInjectionRun(plan);
    return {
        ok: true,
        transform: match.transform,
        materializedDigest: plan.currentRequest.materializedDigest,
        tailFound,
        observed,
    };
}

/**
 * Authoritative verify: exact match to materialized baseline.
 */
export function verifyPromptInjection(payload, { authority = null, plan = getActivePromptInjectionRun() } = {}) {
    if (!plan?.currentRequest) {
        return { ok: false, code: 'SP_PROMPT_NO_ACTIVE_REQUEST', fatal: true };
    }
    if (plan.currentRequest.phase !== 'materialized' && plan.currentRequest.phase !== 'verified') {
        // Allow authority to run materialize+verify if intermediate was skipped (rare)
        const mat = materializePromptInjection(payload, plan);
        if (!mat.ok) return { ...mat, fatal: true };
    }
    const flat = flattenPayloadText(payload);
    if (!flat) {
        return { ok: false, code: 'SP_PROMPT_UNREADABLE_PAYLOAD', fatal: true, observed: { begin: 0, end: 0 } };
    }
    const { beginCount, endCount } = findMainBlocks(flat);
    const observed = { begin: beginCount, end: endCount };
    if (beginCount !== 1 || endCount !== 1) {
        return {
            ok: false,
            code: beginCount === 0 ? 'SP_PROMPT_MISSING_MAIN' : 'SP_PROMPT_DUPLICATE_MAIN',
            fatal: true,
            observed,
        };
    }
    const inner = extractMainInner(flat, plan.runId);
    if (inner == null) {
        return { ok: false, code: 'SP_PROMPT_MISSING_MAIN', fatal: true, observed };
    }
    const matDigest = plan.currentRequest.materializedDigest;
    const nowDigest = digestText(inner);
    if (!matDigest || nowDigest !== matDigest || normalizeNewlines(inner) !== normalizeNewlines(plan.materializedText || '')) {
        return { ok: false, code: 'SP_PROMPT_DIGEST_MISMATCH', fatal: true, observed };
    }
    if (plan.currentRequest.apiKind === 'chat') {
        const eff = findEffectiveMainRole(payload, plan.runId);
        if (eff) {
            if (!isAllowedRoleTransition(plan.registeredRole, eff)) {
                return {
                    ok: false,
                    code: 'SP_PROMPT_ROLE_MISMATCH',
                    fatal: true,
                    observed,
                    registeredRole: plan.registeredRole,
                    effectiveRole: eff,
                };
            }
            plan.effectiveRole = eff;
        }
    }
    const tailFound = findTail(flat, plan.runId);
    plan.verification.main = 'verified';
    plan.verification.tail = tailFound ? 'verified' : 'missing';
    plan.verification.finalHook = authority || plan.verification.finalHook;
    plan.currentRequest.phase = 'verified';
    plan.status = 'verified';
    plan.verifiedRequestCount = (plan.verifiedRequestCount || 0) + 1;
    setActivePromptInjectionRun(plan);
    return {
        ok: true,
        fatal: false,
        tailFound,
        warning: tailFound ? null : 'SP_PROMPT_TAIL_MISSING',
        observed,
        authority: plan.verification.finalHook,
    };
}

export async function commitVerifiedFootprint(plan = getActivePromptInjectionRun(), { tailFound = true } = {}) {
    if (!plan?.materializedText) return null;
    const main = await countTokens(plan.materializedText);
    let tailTokens = 0;
    let estimateSource = main.source;
    if (tailFound) {
        const tail = await countTokens(plan.tail.text);
        tailTokens = tail.tokens;
        if (tail.source === 'heuristic') estimateSource = 'heuristic';
    }
    if (main.source === 'heuristic') estimateSource = 'heuristic';
    const metrics = {
        chatKey: plan.owner?.chatKey ?? null,
        messageId: plan.owner?.messageId ?? null,
        swipeId: plan.owner?.swipeId ?? null,
        runId: plan.runId,
        requestSeq: plan.currentRequest?.seq ?? null,
        tokens: {
            mainInput: main.tokens,
            tailInput: tailFound ? tailTokens : 0,
            totalInput: main.tokens + (tailFound ? tailTokens : 0),
            estimateSource,
        },
        integrity: {
            main: 'verified',
            tail: tailFound ? 'verified' : 'missing',
            hook: plan.verification.finalHook,
        },
        registeredRole: plan.registeredRole,
        effectiveRole: plan.effectiveRole,
        apiKind: plan.currentRequest?.apiKind || null,
        verifiedAt: Date.now(),
    };
    plan.verifiedTokens = metrics.tokens;
    plan.estimateSource = estimateSource;
    plan.main.tokens = main.tokens;
    plan.tail.tokens = tailFound ? tailTokens : 0;
    setLastPromptInjectionMetrics(metrics);
    setActivePromptInjectionRun(plan);
    return metrics;
}

export function serializePromptInjectionMeta(plan = getActivePromptInjectionRun(), status = 'verified') {
    if (!plan) return null;
    const tokens = plan.verifiedTokens || {
        mainInput: plan.main.tokens || 0,
        tailInput: plan.tail.tokens || 0,
        totalInput: (plan.main.tokens || 0) + (plan.tail.tokens || 0),
        estimateSource: plan.estimateSource || 'heuristic',
    };
    return {
        v: 1,
        status,
        apiKind: plan.currentRequest?.apiKind || null,
        registeredRole: plan.registeredRole,
        effectiveRole: plan.effectiveRole,
        tokens: {
            mainInput: tokens.mainInput,
            tailInput: tokens.tailInput,
            totalInput: tokens.totalInput,
            estimateSource: tokens.estimateSource,
        },
        integrity: {
            main: plan.verification.main,
            tail: plan.verification.tail,
            hook: plan.verification.finalHook,
        },
        output: {
            dedicatedReserve: 0,
            sharesMainResponse: true,
        },
        verifiedRequestCount: plan.verifiedRequestCount || 0,
        // hashes only — never sourceText / prompt body
        digests: {
            source: plan.main.digest,
            materialized: plan.currentRequest?.materializedDigest || null,
        },
    };
}

export function recordPromptInjectionFailure(failure) {
    setLastPromptInjectionFailure(failure || null);
}

/**
 * Integrity abort: set reason, clear this run's keys, stop generation — no throw.
 */
export function abortPromptInjection({
    code = 'SP_PROMPT_INTEGRITY_FAILURE',
    runId = null,
    observed = null,
    detail = null,
} = {}) {
    const plan = getActivePromptInjectionRun();
    const id = runId || plan?.runId || null;
    const reason = { code, runId: id, observed, detail, at: Date.now() };
    setPromptAbortReason(reason);
    recordPromptInjectionFailure(reason);
    if (plan) {
        plan.status = 'aborted';
        plan.verification.main = 'failed';
        setActivePromptInjectionRun(plan);
    }
    clearPromptInjection(id);

    try {
        const ctx = _getCtx();
        if (typeof ctx.stopGeneration === 'function') ctx.stopGeneration();
        else {
            const btn = typeof document !== 'undefined' ? document.getElementById('mes_stop') : null;
            if (btn) btn.click();
        }
    } catch (e) {
        warn('PromptInjection abort stopGeneration failed:', e?.message);
    }

    try {
        const msg = code === 'SP_PROMPT_ROLE_MISMATCH'
            ? 'ScenePulse prompt role was rewritten unexpectedly — generation stopped before send.'
            : 'ScenePulse prompt integrity check failed — generation stopped before send.';
        toastr?.error?.(msg, 'ScenePulse');
    } catch {}

    log('PromptInjection aborted:', code, id);
    return reason;
}

/** Store reposition callback used by index.js to re-makeLast on each new run. */
export function setAuthorityReposition(fn) {
    _authorityReposition = typeof fn === 'function' ? fn : null;
}

export function repositionAuthorityHandlers() {
    try { _authorityReposition?.(); } catch (e) { warn('PromptInjection makeLast reposition failed:', e?.message); }
}

export function markAuthorityHandlersWired(v = true) {
    _authorityHandlersWired = !!v;
}

export function areAuthorityHandlersWired() {
    return _authorityHandlersWired;
}

export function getSuspendDepth() {
    return _suspendDepth;
}

/** Test helper — reset module-local counters. */
export function _resetPromptInjectionModuleForTests() {
    _suspendDepth = 0;
    setActivePromptInjectionRun(null);
    setLastPromptInjectionMetrics(null);
    setLastPromptInjectionFailure(null);
    clearPromptAbortReason();
}

export { getPromptAbortReason, clearPromptAbortReason, DEFAULT_TAIL };
