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
    inlineGenStartMs,
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
    // SillyTavern CHAT_COMPLETION_PROMPT_READY uses { chat: [...], dryRun }
    if (Array.isArray(payload.chat)) {
        for (const m of payload.chat) texts.push(..._messageToTexts(m));
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

/** Map ST chat-message flags / role field → system|user|assistant. */
function _messageRoleName(m) {
    if (!m || typeof m !== 'object') return null;
    const fromRole = normalizePromptRoleName(m.role);
    if (fromRole) return fromRole;
    if (m.is_system) return 'system';
    if (m.is_user) return 'user';
    // Neither flag → assistant turn in ST chat arrays
    if (m.is_user === false && m.is_system === false) return 'assistant';
    return null;
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

/**
 * True only for real Text Completion combine payloads (non-empty string prompt).
 * ST OpenAI Chat emits GENERATE_AFTER_COMBINE_PROMPTS({ prompt: '' }) — must not claim text.
 */
export function isTextCombinePromptPayload(eventData) {
    return typeof eventData?.prompt === 'string' && eventData.prompt.length > 0;
}

/** Validate begin/end marker runId + source digest against the active plan. */
function _checkMainMarkerIntegrity(begins, ends, plan) {
    const beginRun = begins[0][1];
    const beginDigest = begins[0][2];
    const endRun = ends[0][1];
    const endDigest = ends[0][2];
    if (beginRun !== plan.runId) {
        return { ok: false, code: 'SP_PROMPT_FOREIGN_RUN', foreignRunId: beginRun };
    }
    if (endRun !== plan.runId) {
        return { ok: false, code: 'SP_PROMPT_FOREIGN_RUN', foreignRunId: endRun };
    }
    if (beginDigest !== plan.main.digest || endDigest !== plan.main.digest) {
        return { ok: false, code: 'SP_PROMPT_DIGEST_MISMATCH' };
    }
    return { ok: true };
}

export function hasAnySpPromptMarkers(flatText) {
    const s = String(flatText || '');
    return s.includes('SP_PROMPT_BEGIN') || s.includes('SP_PROMPT_END') || s.includes('SP_PROMPT_TAIL');
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

/** Full main block including begin/end integrity markers (for token footprint). */
export function extractMainBlock(flatText, runId) {
    const begin = `<!--SP_PROMPT_BEGIN run="${runId}"`;
    const endTag = `<!--SP_PROMPT_END run="${runId}"`;
    const bIdx = flatText.indexOf(begin);
    if (bIdx < 0) return null;
    const eIdx = flatText.indexOf(endTag, bIdx);
    if (eIdx < 0) return null;
    const afterEnd = flatText.indexOf('-->', eIdx);
    if (afterEnd < 0) return null;
    return normalizeNewlines(flatText.slice(bIdx, afterEnd + 3));
}

export function findTail(flatText, runId) {
    const re = new RegExp(`<!--SP_PROMPT_TAIL\\s+run="${runId}"\\s*-->`);
    return re.test(flatText);
}

export function findEffectiveMainRole(payload, runId) {
    if (!payload || typeof payload !== 'object') return null;
    const lists = [];
    if (Array.isArray(payload.messages)) lists.push(payload.messages);
    if (Array.isArray(payload.prompt)) lists.push(payload.prompt);
    if (Array.isArray(payload.chat)) lists.push(payload.chat);
    const needle = `<!--SP_PROMPT_BEGIN run="${runId}"`;
    for (const messages of lists) {
        for (const m of messages) {
            const texts = _messageToTexts(m);
            if (texts.some(t => t.includes(needle))) {
                return _messageRoleName(m);
            }
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
    promptParts = null,
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
    const instructionsRaw = promptParts?.instructions != null ? String(promptParts.instructions) : '';
    const previousStateRaw = promptParts?.previousState != null ? String(promptParts.previousState) : '';
    const instructionsText = instructionsRaw
        ? normalizeNewlines(_substituteParams(instructionsRaw, ctx))
        : '';
    const previousStateText = previousStateRaw
        ? normalizeNewlines(_substituteParams(previousStateRaw, ctx))
        : '';

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
            instructionsText,
            previousStateText,
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

export function beginRequest(apiKind = null, plan = getActivePromptInjectionRun()) {
    if (!plan) return null;
    const prev = plan.currentRequest?.seq || 0;
    // apiKind is claimed by the matching intermediate hook (or first authority fallback).
    const kind = apiKind === 'text' || apiKind === 'chat' ? apiKind : null;
    plan.currentRequest = {
        seq: prev + 1,
        apiKind: kind,
        phase: 'awaiting-intermediate',
        materializedDigest: null,
    };
    plan.verification.main = 'pending';
    plan.verification.tail = 'pending';
    plan.verification.finalHook = null;
    plan.materializedText = null;
    plan.materializedBlock = null;
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

export function shouldHandlePromptHook(eventData = {}, {
    requirePhase = null,
    requireApiKind = null,
    dryRunArg = undefined,
} = {}) {
    if (eventData?.dryRun || dryRunArg === true) return false;
    if (eventData?.quiet || eventData?.type === 'quiet') return false;
    const plan = getActivePromptInjectionRun();
    if (!plan || !plan.currentRequest) return false;
    // Together must be mid-flight with an owner context.
    if (!(inlineGenStartMs > 0 && inlineGenerationContext && inlineGenerationContext.chatKey != null)) {
        return false;
    }
    if (requirePhase && plan.currentRequest.phase !== requirePhase) return false;
    // Enforce only once intermediate (or authority) has claimed an apiKind.
    if (requireApiKind && plan.currentRequest.apiKind != null
        && plan.currentRequest.apiKind !== requireApiKind) return false;
    return true;
}

/** Owner match for attaching runtime / plan metrics to a saved message. */
export function promptInjectionOwnerMatches(candidate, { chatKey, messageId, swipeId } = {}) {
    if (!candidate || chatKey == null || messageId == null) return false;
    const cKey = candidate.chatKey ?? candidate.owner?.chatKey;
    const cMes = candidate.messageId ?? candidate.owner?.messageId;
    const cSwipe = candidate.swipeId ?? candidate.owner?.swipeId;
    return cKey === chatKey
        && Number(cMes) === Number(messageId)
        && Number(cSwipe) === Number(swipeId ?? 0);
}

/**
 * Keep PromptInjectionPlan + last runtime metrics keyed to the final swipe
 * when Together rebinds expected advance (frozen → frozen+1).
 * @param {{ chatKey?: string|null, messageId?: number|null, targetMessageId?: number|null, swipeId?: number|null }} owner
 * @returns {boolean} true if plan and/or metrics swipeId changed
 */
export function rebindPromptInjectionOwner(owner) {
    if (!owner) return false;
    const chatKey = owner.chatKey ?? null;
    const messageId = owner.targetMessageId ?? owner.messageId ?? null;
    const swipeId = Math.max(0, Number(owner.swipeId) || 0);
    if (chatKey == null || messageId == null) return false;

    let changed = false;
    const plan = getActivePromptInjectionRun();
    if (plan?.owner
        && plan.owner.chatKey === chatKey
        && Number(plan.owner.messageId) === Number(messageId)
        && Number(plan.owner.swipeId ?? 0) !== swipeId) {
        plan.owner = { ...plan.owner, swipeId };
        setActivePromptInjectionRun(plan);
        changed = true;
    }

    const rt = getLastPromptInjectionMetrics();
    if (rt
        && rt.chatKey === chatKey
        && Number(rt.messageId) === Number(messageId)
        && Number(rt.swipeId ?? 0) !== swipeId) {
        setLastPromptInjectionMetrics({ ...rt, swipeId });
        changed = true;
    }
    return changed;
}

/**
 * Intermediate materialize: trust candidate only if it matches sourceText under allowlist.
 */
export function materializePromptInjection(payload, plan = getActivePromptInjectionRun(), {
    expectedApiKind = null,
} = {}) {
    if (!plan?.currentRequest) {
        return { ok: false, fatal: false, code: 'SP_PROMPT_NO_ACTIVE_REQUEST' };
    }
    const flat = flattenPayloadText(payload);
    if (!flat) {
        // Empty payload on a foreign/unexpected event → ignore; expected hook → fatal.
        if (expectedApiKind && plan.currentRequest.apiKind === expectedApiKind) {
            return { ok: false, fatal: true, code: 'SP_PROMPT_UNREADABLE_PAYLOAD', observed: { begin: 0, end: 0 } };
        }
        return { ok: false, fatal: false, code: 'SP_PROMPT_NOT_OURS', observed: { begin: 0, end: 0 } };
    }
    const { beginCount, endCount, begins, ends } = findMainBlocks(flat);
    const observed = { begin: beginCount, end: endCount };
    if (beginCount === 0 && endCount === 0 && !hasAnySpPromptMarkers(flat)) {
        return { ok: false, fatal: false, code: 'SP_PROMPT_NOT_OURS', observed };
    }
    if (beginCount === 0 || endCount === 0) {
        return { ok: false, fatal: true, code: 'SP_PROMPT_MISSING_MAIN', observed };
    }
    if (beginCount > 1 || endCount > 1) {
        return { ok: false, fatal: true, code: 'SP_PROMPT_DUPLICATE_MAIN', observed };
    }
    const markerCheck = _checkMainMarkerIntegrity(begins, ends, plan);
    if (!markerCheck.ok) {
        return {
            ok: false,
            fatal: true,
            code: markerCheck.code,
            observed,
            foreignRunId: markerCheck.foreignRunId,
        };
    }
    const inner = extractMainInner(flat, plan.runId);
    if (inner == null) {
        return { ok: false, fatal: true, code: 'SP_PROMPT_MISSING_MAIN', observed };
    }
    const match = matchAllowlistedTransform(plan.main.sourceText, inner);
    if (!match.ok) {
        return { ok: false, fatal: true, code: 'SP_PROMPT_DIGEST_MISMATCH', observed, detail: 'candidate_not_allowlisted' };
    }
    const fullBlock = extractMainBlock(flat, plan.runId);
    plan.materializedText = match.transformed;
    plan.materializedBlock = fullBlock || plan.main.text;
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
                return {
                    ok: false,
                    fatal: true,
                    code: 'SP_PROMPT_ROLE_MISMATCH',
                    observed,
                    registeredRole: plan.registeredRole,
                    effectiveRole: eff,
                };
            }
            plan.effectiveRole = eff;
        }
    }
    setActivePromptInjectionRun(plan);
    return {
        ok: true,
        fatal: false,
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
        return { ok: false, code: 'SP_PROMPT_NO_ACTIVE_REQUEST', fatal: false };
    }
    // Already verified this request seq — idempotent.
    if (plan.currentRequest.phase === 'verified') {
        return {
            ok: true,
            fatal: false,
            alreadyVerified: true,
            tailFound: plan.verification.tail === 'verified',
            warning: plan.verification.tail === 'missing' ? 'SP_PROMPT_TAIL_MISSING' : null,
            observed: null,
            authority: plan.verification.finalHook,
        };
    }
    if (plan.currentRequest.phase !== 'materialized') {
        const mat = materializePromptInjection(payload, plan, {
            expectedApiKind: plan.currentRequest.apiKind,
        });
        if (!mat.ok) return { ...mat, fatal: mat.fatal !== false };
    }
    const flat = flattenPayloadText(payload);
    if (!flat) {
        // Authority empty payload after claiming apiKind → delivery failure.
        return { ok: false, code: 'SP_PROMPT_UNREADABLE_PAYLOAD', fatal: true, observed: { begin: 0, end: 0 } };
    }
    const { beginCount, endCount, begins, ends } = findMainBlocks(flat);
    const observed = { begin: beginCount, end: endCount };
    // Authority: missing main is always fatal (do not ship markerless prompts).
    if (beginCount === 0 && endCount === 0 && !hasAnySpPromptMarkers(flat)) {
        return { ok: false, fatal: true, code: 'SP_PROMPT_MISSING_MAIN', observed };
    }
    if (beginCount !== 1 || endCount !== 1) {
        return {
            ok: false,
            code: beginCount === 0 ? 'SP_PROMPT_MISSING_MAIN' : 'SP_PROMPT_DUPLICATE_MAIN',
            fatal: true,
            observed,
        };
    }
    const markerCheck = _checkMainMarkerIntegrity(begins, ends, plan);
    if (!markerCheck.ok) {
        return {
            ok: false,
            fatal: true,
            code: markerCheck.code,
            observed,
            foreignRunId: markerCheck.foreignRunId,
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
    const fullBlock = extractMainBlock(flat, plan.runId);
    if (fullBlock) plan.materializedBlock = fullBlock;
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
    if (!plan?.materializedText && !plan?.materializedBlock) return null;
    const mainText = plan.materializedBlock || plan.main.text || plan.materializedText;
    const main = await countTokens(mainText);
    let tailTokens = 0;
    let estimateSource = main.source;
    if (tailFound) {
        const tail = await countTokens(plan.tail.text);
        tailTokens = tail.tokens;
        if (tail.source === 'heuristic') estimateSource = 'heuristic';
    }
    if (main.source === 'heuristic') estimateSource = 'heuristic';
    let instructionsInput = 0;
    let previousStateInput = 0;
    if (plan.main.instructionsText || plan.main.previousStateText) {
        const [instr, prev] = await Promise.all([
            countTokens(plan.main.instructionsText || ''),
            countTokens(plan.main.previousStateText || ''),
        ]);
        instructionsInput = instr.tokens;
        previousStateInput = prev.tokens;
        if (instr.source === 'heuristic' || prev.source === 'heuristic') estimateSource = 'heuristic';
    }
    const metrics = {
        chatKey: plan.owner?.chatKey ?? null,
        messageId: plan.owner?.messageId ?? null,
        swipeId: plan.owner?.swipeId ?? null,
        runId: plan.runId,
        requestSeq: plan.currentRequest?.seq ?? null,
        tokens: {
            mainInput: main.tokens,
            instructionsInput,
            previousStateInput,
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
        instructionsInput: 0,
        previousStateInput: 0,
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
            instructionsInput: tokens.instructionsInput || 0,
            previousStateInput: tokens.previousStateInput || 0,
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
