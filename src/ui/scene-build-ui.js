// Scene-build status UI: per-message stub + floating toast (no message content edits).

import { t } from '../i18n.js';
import { log } from '../logger.js';
import { esc } from '../utils.js';
import { spDetectMode } from './mobile.js';
import {
    subscribeSceneBuild, getActiveSceneBuilds, getAllSceneBuilds, getSceneBuild,
    cancelSceneBuild, isActiveStatus, disposeSceneBuilds,
} from '../generation/scene-build-controller.js';
import { runSceneBuild } from '../generation/scene-build-runner.js';
import { setLastGenSource } from '../state.js';

const READY_DISMISS_MS = 1200;
const CANCEL_DISMISS_MS = 900;
const _dismissTimers = new Map();
let _subscribed = false;
let _unsubscribe = null;

function _stageCopy(op) {
    const soft = op.softNotified;
    const softSub = t('Taking longer than usual…');
    switch (op.status) {
        case 'pending':
        case 'generating':
            return {
                title: t('Getting scene data…'),
                sub: soft ? softSub : t('This may take a few seconds'),
                busy: true,
            };
        case 'parsing':
            return {
                title: t('Creating scene…'),
                sub: soft ? softSub : t('Response received, processing data'),
                busy: true,
            };
        case 'saving':
            return {
                title: t('Almost ready…'),
                sub: soft ? softSub : t('Saving scene for this swipe'),
                busy: true,
            };
        case 'cancelling':
            return { title: t('Cancelling…'), sub: '', busy: true };
        case 'ready':
            return { title: t('Scene ready'), sub: '', busy: false };
        case 'cancelled':
            return {
                title: op.cancellationReason === 'reply-stopped'
                    ? t('Scene not created: reply was stopped')
                    : t('Scene creation cancelled'),
                sub: '',
                busy: false,
            };
        case 'error':
            return {
                title: t('Could not create scene'),
                sub: op.error?.message ? String(op.error.message).slice(0, 120) : '',
                busy: false,
                retry: true,
                close: true,
            };
        case 'expired':
            return {
                title: t('Scene creation did not finish'),
                sub: t('You can retry or dismiss'),
                busy: false,
                retry: true,
                close: true,
            };
        case 'superseded':
            return { title: t('Replaced by a newer build'), sub: '', busy: false };
        default:
            return { title: t('Creating scene…'), sub: '', busy: true };
    }
}

function _mesEl(messageId) {
    return document.querySelector(`.mes[mesid="${messageId}"]`);
}

function _stubId(operationId) {
    return `sp-scene-build-${operationId}`;
}

function _clearDismiss(operationId) {
    const tmr = _dismissTimers.get(operationId);
    if (tmr) clearTimeout(tmr);
    _dismissTimers.delete(operationId);
}

function _scheduleRemove(operationId, ms) {
    _clearDismiss(operationId);
    _dismissTimers.set(operationId, setTimeout(() => {
        _dismissTimers.delete(operationId);
        document.getElementById(_stubId(operationId))?.remove();
        _syncFloating();
        _syncMesButtons();
        _syncToolbar();
    }, ms));
}

/** Place stub after message body so it never sits above streaming text. */
function _mountPoint(mes) {
    if (!mes) return null;
    const text = mes.querySelector('.mes_text');
    if (text?.parentElement) return { parent: text.parentElement, before: text.nextSibling };
    return { parent: mes, before: null };
}

/**
 * Together starts the op at inject time; wait until parse/save (reply finished)
 * so the stub appears under the completed message. Manual/recover: text already there.
 */
function _shouldShowStub(op) {
    if (op.status === 'superseded') return false;
    const mes = _mesEl(op.messageId);
    if (!mes?.querySelector('.mes_text')) return false;
    const src = String(op.source || '');
    if (src.startsWith('manual') || src.includes('recover') || src.includes('fallback')) return true;
    return !['pending', 'generating'].includes(op.status);
}

function _clearSiblingStubs(op) {
    document.querySelectorAll(`.sp-scene-build[data-sp-mes="${op.messageId}"]`).forEach(el => {
        if (el.dataset.spOp === op.operationId) return;
        if (el.dataset.spSwipe != null && el.dataset.spSwipe !== String(op.swipeId)) return;
        el.remove();
        _clearDismiss(el.dataset.spOp);
    });
}

function _ensureStub(op) {
    let el = document.getElementById(_stubId(op.operationId));
    const mes = _mesEl(op.messageId);
    if (!mes) return null;
    if (!el) {
        el = document.createElement('div');
        el.id = _stubId(op.operationId);
        el.className = 'sp-scene-build';
        el.dataset.spOp = op.operationId;
        el.dataset.spMes = String(op.messageId);
        el.dataset.spSwipe = String(op.swipeId);
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        const mount = _mountPoint(mes);
        if (!mount) return null;
        mount.parent.insertBefore(el, mount.before);
    } else if (el.dataset.spSwipe !== String(op.swipeId)) {
        el.dataset.spSwipe = String(op.swipeId);
    }
    _clearSiblingStubs(op);
    return el;
}

function _renderStub(op) {
    if (!_shouldShowStub(op)) {
        document.getElementById(_stubId(op.operationId))?.remove();
        return;
    }
    const el = _ensureStub(op);
    if (!el) return;
    const copy = _stageCopy(op);
    el.setAttribute('aria-busy', copy.busy ? 'true' : 'false');
    el.classList.toggle('sp-scene-build-terminal', !copy.busy);
    el.classList.toggle('sp-scene-build-error', op.status === 'error' || op.status === 'expired');
    const spinner = copy.busy
        ? '<span class="sp-scene-build-spinner" aria-hidden="true"></span>'
        : '<span class="sp-scene-build-dot" aria-hidden="true"></span>';
    let actions = '';
    if (copy.busy) {
        actions = `<button type="button" class="sp-scene-build-cancel" data-sp-cancel="${op.operationId}">${t('Cancel')}</button>`;
    } else if (copy.retry) {
        actions = `<button type="button" class="sp-scene-build-retry" data-sp-retry="${op.operationId}">${t('Retry')}</button>`;
        if (copy.close) {
            actions += `<button type="button" class="sp-scene-build-close" data-sp-close="${op.operationId}">${t('Close')}</button>`;
        }
    }
    el.innerHTML = `<div class="sp-scene-build-row">${spinner}<div class="sp-scene-build-text"><div class="sp-scene-build-title">${esc(copy.title)}</div>${copy.sub ? `<div class="sp-scene-build-sub">${esc(copy.sub)}</div>` : ''}</div>${actions}</div>`;
}

function _syncFloating() {
    const active = getActiveSceneBuilds();
    let toast = document.getElementById('sp-scene-build-toast');
    if (!active.length) {
        toast?.remove();
        return;
    }
    const op = active[active.length - 1];
    const mobile = spDetectMode() === 'mobile';
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'sp-scene-build-toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        document.body.appendChild(toast);
    }
    toast.className = 'sp-scene-build-toast' + (mobile ? ' sp-scene-build-toast-mobile' : '');
    toast.setAttribute('aria-busy', 'true');
    const label = mobile
        ? t('Creating scene for the current reply')
        : t('ScenePulse is creating a scene');
    const cancelBtn = mobile
        ? `<button type="button" class="sp-scene-build-toast-close" data-sp-cancel="${op.operationId}" aria-label="${t('Cancel scene creation')}">×</button>`
        : `<button type="button" class="sp-scene-build-cancel" data-sp-cancel="${op.operationId}">${t('Cancel')}</button>`;
    toast.innerHTML = `<span class="sp-scene-build-spinner" aria-hidden="true"></span><span class="sp-scene-build-toast-label">${label}</span>${cancelBtn}`;
}

function _syncMesButtons() {
    const activeByMes = new Map();
    for (const op of getActiveSceneBuilds()) {
        activeByMes.set(op.messageId, op);
    }
    document.querySelectorAll('.sp-mes-btn').forEach(btn => {
        const mes = btn.closest('.mes');
        const id = Number(mes?.getAttribute('mesid'));
        const op = activeByMes.get(id);
        const busy = !!op;
        btn.classList.toggle('sp-generating', busy);
        btn.setAttribute('aria-busy', busy ? 'true' : 'false');
        btn.title = busy
            ? t('Creating…')
            : t('ScenePulse: Regenerate scene from this message');
        btn.setAttribute('aria-label', btn.title);
        if (busy) btn.setAttribute('aria-disabled', 'true');
        else btn.removeAttribute('aria-disabled');
    });
}

function _syncToolbar() {
    const regen = document.getElementById('sp-tb-regen');
    if (!regen) return;
    const busy = getActiveSceneBuilds().length > 0;
    regen.disabled = busy;
    regen.setAttribute('aria-busy', busy ? 'true' : 'false');
    regen.title = busy ? t('Creating…') : t('Regenerate all');
    regen.classList.toggle('sp-generating', busy);
}

async function _retryFromOp(operationId) {
    const op = getSceneBuild(operationId);
    if (!op) return;
    document.getElementById(_stubId(operationId))?.remove();
    const { generateTracker } = await import('../generation/engine.js');
    setLastGenSource('manual:scene-build-retry');
    await runSceneBuild({
        messageId: op.messageId,
        swipeId: op.swipeId,
        source: 'manual:scene-build-retry',
        run: async ({ signal, operation, markRequest, isCurrent, setStatus }) => {
            markRequest(true);
            try {
                setStatus('generating');
                const r = await generateTracker(op.messageId, null, {
                    signal,
                    stopStOnAbort: false,
                    sceneBuildOperationId: operation.operationId,
                });
                if (!isCurrent()) return null;
                setStatus('saving');
                return r;
            } finally {
                markRequest(false);
            }
        },
    });
}

function _onClick(e) {
    const cancel = e.target.closest?.('[data-sp-cancel]');
    if (cancel) {
        e.preventDefault();
        e.stopPropagation();
        cancelSceneBuild(cancel.getAttribute('data-sp-cancel'), 'user');
        return;
    }
    const retry = e.target.closest?.('[data-sp-retry]');
    if (retry) {
        e.preventDefault();
        e.stopPropagation();
        void _retryFromOp(retry.getAttribute('data-sp-retry'));
        return;
    }
    const close = e.target.closest?.('[data-sp-close]');
    if (close) {
        e.preventDefault();
        e.stopPropagation();
        const id = close.getAttribute('data-sp-close');
        document.getElementById(_stubId(id))?.remove();
        _syncFloating();
    }
}

function _onChange(op, reason) {
    if (reason === 'dispose') {
        document.querySelectorAll('.sp-scene-build').forEach(n => n.remove());
        document.getElementById('sp-scene-build-toast')?.remove();
        _dismissTimers.forEach(clearTimeout);
        _dismissTimers.clear();
        _syncMesButtons();
        _syncToolbar();
        return;
    }
    if (reason === 'replace-terminal' && op) {
        document.getElementById(_stubId(op.operationId))?.remove();
        _clearDismiss(op.operationId);
        _syncFloating();
        _syncMesButtons();
        _syncToolbar();
        return;
    }
    if (!op) {
        _syncFloating();
        _syncMesButtons();
        _syncToolbar();
        return;
    }
    _renderStub(op);
    _syncFloating();
    _syncMesButtons();
    _syncToolbar();
    if (op.status === 'ready') _scheduleRemove(op.operationId, READY_DISMISS_MS);
    else if (op.status === 'cancelled') _scheduleRemove(op.operationId, CANCEL_DISMISS_MS);
    else if (op.status === 'superseded') _clearDismiss(op.operationId);
}

function _onVisibilityChange() {
    if (document.visibilityState === 'visible') reconcileSceneBuildUi();
}

function _onPageHide() {
    try { disposeSceneBuilds(); } catch {}
}

export function initSceneBuildUi() {
    if (_subscribed) return;
    _subscribed = true;
    _unsubscribe = subscribeSceneBuild(_onChange);
    document.addEventListener('click', _onClick, true);
    document.addEventListener('visibilitychange', _onVisibilityChange);
    window.addEventListener('pagehide', _onPageHide);
    log('SceneBuild UI: initialized');
}

export function reconcileSceneBuildUi() {
    const liveIds = new Set();
    for (const op of getAllSceneBuilds()) {
        const keep = isActiveStatus(op.status)
            || op.status === 'error'
            || op.status === 'expired'
            || op.status === 'ready'
            || op.status === 'cancelled';
        if (!keep) continue;
        liveIds.add(op.operationId);
        _renderStub(op);
        if (op.status === 'ready' && !_dismissTimers.has(op.operationId)) {
            _scheduleRemove(op.operationId, READY_DISMISS_MS);
        } else if (op.status === 'cancelled' && !_dismissTimers.has(op.operationId)) {
            _scheduleRemove(op.operationId, CANCEL_DISMISS_MS);
        }
    }
    document.querySelectorAll('.sp-scene-build').forEach(el => {
        const id = el.dataset.spOp;
        if (!liveIds.has(id)) el.remove();
    });
    _syncFloating();
    _syncMesButtons();
    _syncToolbar();
}

export function disposeSceneBuildUi() {
    if (_unsubscribe) {
        try { _unsubscribe(); } catch {}
        _unsubscribe = null;
    }
    document.removeEventListener('click', _onClick, true);
    document.removeEventListener('visibilitychange', _onVisibilityChange);
    window.removeEventListener('pagehide', _onPageHide);
    document.querySelectorAll('.sp-scene-build').forEach(n => n.remove());
    document.getElementById('sp-scene-build-toast')?.remove();
    _dismissTimers.forEach(clearTimeout);
    _dismissTimers.clear();
    _subscribed = false;
}

/** Helper for entry points: run generateTracker under SceneBuild. */
export async function runManualSceneBuild(messageId, source, partKey = null, extraOpts = {}) {
    const { generateTracker } = await import('../generation/engine.js');
    setLastGenSource(source);
    return runSceneBuild({
        messageId,
        source,
        run: async ({ signal, operation, markRequest, isCurrent, setStatus }) => {
            markRequest(true);
            try {
                setStatus('generating');
                const r = await generateTracker(messageId, partKey, {
                    ...extraOpts,
                    signal,
                    stopStOnAbort: false,
                    sceneBuildOperationId: operation.operationId,
                });
                if (!isCurrent()) return null;
                if (r) setStatus('saving');
                return r;
            } finally {
                markRequest(false);
            }
        },
    });
}
