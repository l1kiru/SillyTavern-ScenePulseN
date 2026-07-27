// SceneBuildController — registry + FSM for per-message/swipe scene builds.
// UI and generation runners subscribe; DOM is never the source of truth.

import { log, warn } from '../logger.js';
import { currentChatKey } from '../message-fingerprint.js';
import { getActiveSwipeId } from '../settings.js';

export const SCENE_BUILD_SOFT_MS = 40000;
export const SCENE_BUILD_EXPIRED_MS = 90000;
export const SCENE_BUILD_WATCHDOG_MS = 5000;

export const ACTIVE_STATUSES = Object.freeze(['pending', 'generating', 'parsing', 'saving', 'cancelling']);
export const TERMINAL_STATUSES = Object.freeze(['ready', 'cancelled', 'error', 'superseded', 'expired']);

const _ops = new Map(); // operationId -> operation
const _targetIndex = new Map(); // targetKey -> operationId
const _listeners = new Set();

let _opSeq = 0;
let _watchdogTimer = null;
let _nowFn = () => Date.now();
let _stGeneratingFn = () => {
    try {
        const ctx = SillyTavern.getContext();
        return !!(ctx?.isStreaming || ctx?.generationInProgress || document.getElementById('mes_stop')?.offsetParent);
    } catch {
        return false;
    }
};

export function _setSceneBuildNow(fn) { _nowFn = fn || (() => Date.now()); }
export function _setSceneBuildStGenerating(fn) { _stGeneratingFn = fn || (() => false); }
export function _resetSceneBuildRegistryForTests() {
    _ops.clear();
    _targetIndex.clear();
    stopSceneBuildWatchdog();
    _opSeq = 0;
}

export function targetKey(chatKey, messageId, swipeId) {
    return `${chatKey}|${Number(messageId)}|${Math.max(0, Number(swipeId) || 0)}`;
}

export function isTerminalStatus(status) {
    return TERMINAL_STATUSES.includes(status);
}

export function isActiveStatus(status) {
    return ACTIVE_STATUSES.includes(status);
}

export function subscribeSceneBuild(listener) {
    if (typeof listener === 'function') _listeners.add(listener);
    return () => _listeners.delete(listener);
}

function _emit(op, reason) {
    for (const fn of _listeners) {
        try { fn(op, reason); } catch (e) { warn('SceneBuild listener:', e); }
    }
}

function _newId() {
    _opSeq += 1;
    return `spb-${_opSeq}-${(_nowFn() % 1e9).toString(36)}`;
}

/**
 * @param {{messageId:number,swipeId?:number,source?:string,chatKey?:string}} opts
 */
export function startSceneBuild(opts = {}) {
    const messageId = Number(opts.messageId);
    const swipeId = Math.max(0, Number(opts.swipeId ?? getActiveSwipeId(messageId)) || 0);
    const chatKey = opts.chatKey ?? currentChatKey();
    const source = String(opts.source || 'manual');
    const key = targetKey(chatKey, messageId, swipeId);
    const now = _nowFn();

    const prevId = _targetIndex.get(key);
    if (prevId) supersedeSceneBuild(prevId, 'replaced');

    // Error/expired leave the targetIndex, so a retry would stack stubs.
    // Drop those same-target terminals now and notify UI to remove their DOM.
    for (const [id, existing] of [..._ops.entries()]) {
        if (existing.chatKey !== chatKey || existing.messageId !== messageId || existing.swipeId !== swipeId) continue;
        if (existing.status !== 'error' && existing.status !== 'expired') continue;
        dismissSceneBuild(id, 'replace-terminal');
    }

    const abortController = typeof AbortController !== 'undefined' ? new AbortController() : { signal: { aborted: false }, abort() {} };
    const op = {
        operationId: _newId(),
        chatKey,
        messageId,
        swipeId,
        source,
        status: 'pending',
        startedAt: now,
        updatedAt: now,
        abortController,
        cancellationReason: '',
        error: null,
        softNotified: false,
        // Soft "longer than usual" clock: from start for manual; for Together,
        // from first parsing/saving (reply already on screen).
        softBaseAt: (source.startsWith('manual') || source.includes('recover') || source.includes('fallback')) ? now : null,
        requestInFlight: false,
        stopStOnAbort: opts.stopStOnAbort === true,
    };
    _ops.set(op.operationId, op);
    _targetIndex.set(key, op.operationId);
    ensureSceneBuildWatchdog();
    log('SceneBuild: start', op.operationId, 'mes=', messageId, 'swipe=', swipeId, 'source=', source);
    _emit(op, 'start');
    return op;
}

export function getSceneBuild(operationId) {
    return _ops.get(operationId) || null;
}

export function getActiveSceneBuilds(chatKey = currentChatKey()) {
    const out = [];
    for (const op of _ops.values()) {
        if (op.chatKey === chatKey && isActiveStatus(op.status)) out.push(op);
    }
    return out;
}

export function getAllSceneBuilds() {
    return [..._ops.values()];
}

export function getSceneBuildForTarget(messageId, swipeId, chatKey = currentChatKey()) {
    const id = _targetIndex.get(targetKey(chatKey, messageId, swipeId));
    return id ? _ops.get(id) || null : null;
}

export function isOperationCurrent(operationId) {
    const op = _ops.get(operationId);
    if (!op) return false;
    if (isTerminalStatus(op.status)) return false;
    const key = targetKey(op.chatKey, op.messageId, op.swipeId);
    return _targetIndex.get(key) === operationId;
}

export function updateSceneBuild(operationId, patch = {}) {
    const op = _ops.get(operationId);
    if (!op || isTerminalStatus(op.status)) return op;
    const now = _nowFn();
    if (patch.status != null) {
        op.status = patch.status;
        if ((patch.status === 'parsing' || patch.status === 'saving') && op.softBaseAt == null) {
            op.softBaseAt = now;
        }
    }
    if (patch.error !== undefined) op.error = patch.error;
    if (patch.cancellationReason != null) op.cancellationReason = patch.cancellationReason;
    if (patch.requestInFlight != null) op.requestInFlight = !!patch.requestInFlight;
    if (patch.softNotified != null) op.softNotified = !!patch.softNotified;
    if (patch.swipeId != null && Number.isFinite(Number(patch.swipeId))) {
        const oldKey = targetKey(op.chatKey, op.messageId, op.swipeId);
        if (_targetIndex.get(oldKey) === operationId) _targetIndex.delete(oldKey);
        op.swipeId = Math.max(0, Number(patch.swipeId) || 0);
        _targetIndex.set(targetKey(op.chatKey, op.messageId, op.swipeId), operationId);
    }
    op.updatedAt = now;
    _emit(op, patch.status ? 'status' : 'update');
    return op;
}

function _settle(operationId, status, extra = {}) {
    const op = _ops.get(operationId);
    if (!op) return null;
    if (isTerminalStatus(op.status) && op.status !== 'cancelling') return op;
    op.status = status;
    op.updatedAt = _nowFn();
    op.requestInFlight = false;
    if (extra.cancellationReason != null) op.cancellationReason = extra.cancellationReason;
    if (extra.error !== undefined) op.error = extra.error;
    const key = targetKey(op.chatKey, op.messageId, op.swipeId);
    if (_targetIndex.get(key) === operationId) _targetIndex.delete(key);
    log('SceneBuild: settle', operationId, status, extra.cancellationReason || '');
    _emit(op, 'settle');
    if (!getActiveSceneBuilds(op.chatKey).length && ![..._ops.values()].some(o => isActiveStatus(o.status))) {
        stopSceneBuildWatchdog();
    }
    return op;
}

export function settleSceneBuild(operationId, status = 'ready', extra = {}) {
    if (!TERMINAL_STATUSES.includes(status)) {
        warn('SceneBuild: settle with non-terminal', status);
        status = 'ready';
    }
    return _settle(operationId, status, extra);
}

export function cancelSceneBuild(operationId, reason = 'user') {
    const op = _ops.get(operationId);
    if (!op || isTerminalStatus(op.status)) return op;
    updateSceneBuild(operationId, { status: 'cancelling', cancellationReason: reason });
    try { op.abortController?.abort?.(reason); } catch {}
    return _settle(operationId, 'cancelled', { cancellationReason: reason });
}

/** Remove op with one emit. Active: abort only — do not settle cancelled. */
export function dismissSceneBuild(operationId, reason = 'dismiss') {
    const op = _ops.get(operationId);
    if (!op) return null;
    if (isActiveStatus(op.status)) {
        try { op.abortController?.abort?.(reason); } catch {}
    }
    const key = targetKey(op.chatKey, op.messageId, op.swipeId);
    if (_targetIndex.get(key) === operationId) _targetIndex.delete(key);
    _ops.delete(operationId);
    _emit(op, reason);
    if (![..._ops.values()].some(o => isActiveStatus(o.status))) stopSceneBuildWatchdog();
    return op;
}

export function dismissSceneBuildsForChat(chatKey, reason = 'chat-changed') {
    for (const op of [..._ops.values()]) {
        if (op.chatKey !== chatKey) continue;
        dismissSceneBuild(op.operationId, reason);
    }
}

export function dismissSceneBuildsForMessage(messageId, chatKey = currentChatKey(), reason = 'message-deleted') {
    const mid = Number(messageId);
    for (const op of [..._ops.values()]) {
        if (op.chatKey !== chatKey || op.messageId !== mid) continue;
        dismissSceneBuild(op.operationId, reason);
    }
}

export function supersedeSceneBuild(operationId, reason = 'superseded') {
    const op = _ops.get(operationId);
    if (!op || isTerminalStatus(op.status)) return op;
    try { op.abortController?.abort?.(reason); } catch {}
    return _settle(operationId, 'superseded', { cancellationReason: reason });
}

export function failSceneBuild(operationId, error, reason = 'error') {
    const op = _ops.get(operationId);
    if (!op || isTerminalStatus(op.status)) return op;
    try { op.abortController?.abort?.(reason); } catch {}
    return _settle(operationId, 'error', {
        cancellationReason: reason,
        error: error instanceof Error ? { message: error.message, code: error.code || '' } : { message: String(error || reason), code: '' },
    });
}

export function expireSceneBuild(operationId, reason = 'expired') {
    return _settle(operationId, 'expired', { cancellationReason: reason });
}

/** Rebind a live together-op onto the final swipe after ST advances. */
export function rebindSceneBuildSwipe(operationId, newSwipeId) {
    const op = _ops.get(operationId);
    if (!op || isTerminalStatus(op.status)) return op;
    const next = Math.max(0, Number(newSwipeId) || 0);
    if (next === op.swipeId) return op;
    const otherId = _targetIndex.get(targetKey(op.chatKey, op.messageId, next));
    if (otherId && otherId !== operationId) supersedeSceneBuild(otherId, 'swipe-rebind');
    return updateSceneBuild(operationId, { swipeId: next });
}

export function supersedeSceneBuildsForMessageExceptSwipe(messageId, keepSwipeId, chatKey = currentChatKey()) {
    const keep = Math.max(0, Number(keepSwipeId) || 0);
    let count = 0;
    for (const op of [..._ops.values()]) {
        if (op.chatKey !== chatKey || op.messageId !== Number(messageId)) continue;
        if (!isActiveStatus(op.status)) continue;
        if (op.swipeId === keep) continue;
        supersedeSceneBuild(op.operationId, 'swipe-changed');
        count += 1;
    }
    return count;
}

export function cancelSceneBuildsForChat(chatKey, reason = 'chat-changed') {
    for (const op of [..._ops.values()]) {
        if (op.chatKey !== chatKey || !isActiveStatus(op.status)) continue;
        cancelSceneBuild(op.operationId, reason);
    }
}

export function cancelSceneBuildsForMessage(messageId, chatKey = currentChatKey(), reason = 'message-deleted') {
    for (const op of [..._ops.values()]) {
        if (op.chatKey !== chatKey || op.messageId !== Number(messageId) || !isActiveStatus(op.status)) continue;
        cancelSceneBuild(op.operationId, reason);
    }
}

export function cancelTogetherSceneBuilds(reason = 'reply-stopped') {
    for (const op of [..._ops.values()]) {
        if (!isActiveStatus(op.status)) continue;
        const src = String(op.source || '');
        if (src === 'together' || src.startsWith('auto:together') || src === 'inline') {
            cancelSceneBuild(op.operationId, reason);
        }
    }
}

export function pruneTerminalSceneBuilds(maxAgeMs = 120000) {
    const now = _nowFn();
    for (const [id, op] of [..._ops.entries()]) {
        if (!isTerminalStatus(op.status)) continue;
        if (now - op.updatedAt > maxAgeMs) dismissSceneBuild(id, 'prune');
    }
}

export function ensureSceneBuildWatchdog() {
    if (_watchdogTimer != null) return;
    _watchdogTimer = setInterval(() => {
        try { tickSceneBuildWatchdog(); } catch (e) { warn('SceneBuild watchdog:', e); }
    }, SCENE_BUILD_WATCHDOG_MS);
    if (typeof _watchdogTimer === 'object' && _watchdogTimer.unref) _watchdogTimer.unref();
}

export function stopSceneBuildWatchdog() {
    if (_watchdogTimer != null) {
        clearInterval(_watchdogTimer);
        _watchdogTimer = null;
    }
}

export function tickSceneBuildWatchdog() {
    const now = _nowFn();
    const stBusy = !!_stGeneratingFn();
    for (const op of [..._ops.values()]) {
        if (!isActiveStatus(op.status)) continue;
        if (!op.softNotified && op.softBaseAt != null && now - op.softBaseAt >= SCENE_BUILD_SOFT_MS) {
            op.softNotified = true;
            op.updatedAt = now;
            _emit(op, 'soft');
        }
        const age = now - (op.softBaseAt ?? op.startedAt);
        if (age < SCENE_BUILD_EXPIRED_MS) continue;
        if (op.status !== 'saving' && (op.requestInFlight || stBusy)) continue;
        expireSceneBuild(op.operationId, 'watchdog');
    }
    pruneTerminalSceneBuilds();
}

export function disposeSceneBuilds() {
    for (const op of [..._ops.values()]) {
        if (isActiveStatus(op.status)) {
            try { op.abortController?.abort?.('dispose'); } catch {}
        }
    }
    _ops.clear();
    _targetIndex.clear();
    stopSceneBuildWatchdog();
    _emit(null, 'dispose');
}
