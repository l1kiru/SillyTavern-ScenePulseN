// Shared helpers for Together extract → processExtraction under SceneBuild.

import {
    updateSceneBuild, settleSceneBuild, failSceneBuild, cancelSceneBuild,
    cancelTogetherSceneBuilds, isOperationCurrent, getActiveSceneBuilds,
} from './scene-build-controller.js';
import { processExtraction } from './pipeline.js';
import { rebindInlineCtxForExpectedSwipe } from './inline-ctx.js';
import {
    inlineGenerationContext, setInlineGenerationContext,
    setInlineGenStartMs, setInlineExtractionDone, setPendingInlineIdx,
    setGenerating, setGenNonce, setCancelRequested, setGenerationTargetMesIdx,
    getGenerationTargetMesIdx, genNonce, generating,
    getActivePromptInjectionRun,
} from '../state.js';
import { clearPromptInjection } from './prompt-injection.js';
import { cancelSceneSourceTrace } from '../scene-source-trace.js';
import { stopStreamingHider } from './streaming.js';
import { cleanupGenUI } from '../ui/loading.js';
import { spSetGenerating } from '../ui/mobile.js';
import { setBrandState } from '../ui/panel.js';
import { log } from '../logger.js';
import { rearmForceFullAfterFailedFullRun } from '../settings.js';

let _processExtractionFn = processExtraction;
/** @param {typeof processExtraction|null} fn */
export function _setTogetherProcessExtractionForTests(fn) {
    _processExtractionFn = fn || processExtraction;
}

function _rearmIfFailedFullTogether(inlineCtx, baseOpts = {}) {
    const ranAsDelta = !!(Object.hasOwn(baseOpts, 'frozenDeltaMode')
        ? baseOpts.frozenDeltaMode
        : inlineCtx?.frozenDeltaMode);
    rearmForceFullAfterFailedFullRun(ranAsDelta);
}

export async function processTogetherExtraction(mesIdx, extracted, source, inlineCtx, baseOpts = {}) {
    const opId = inlineCtx?.sceneBuildOperationId || null;
    if (opId && isOperationCurrent(opId)) {
        updateSceneBuild(opId, { status: 'parsing' });
    }
    try {
        const result = await _processExtractionFn(mesIdx, extracted, source, {
            ...baseOpts,
            swipeId: baseOpts.swipeId ?? inlineCtx?.swipeId,
            expectedSwipeId: baseOpts.expectedSwipeId ?? inlineCtx?.swipeId,
            baseSnapshot: Object.hasOwn(baseOpts, 'baseSnapshot') ? baseOpts.baseSnapshot : (inlineCtx?.baseSnapshot ?? null),
            expectedChatKey: baseOpts.expectedChatKey ?? inlineCtx?.chatKey,
            expectedParentFingerprint: baseOpts.expectedParentFingerprint ?? inlineCtx?.parentFingerprint,
            owner: baseOpts.owner ?? inlineCtx?.owner,
            sceneBuildOperationId: opId,
            frozenRequestSchema: baseOpts.frozenRequestSchema ?? inlineCtx?.frozenRequestSchema,
            frozenDeltaMode: baseOpts.frozenDeltaMode ?? inlineCtx?.frozenDeltaMode,
            frozenCharacterCustomFieldSpecs: baseOpts.frozenCharacterCustomFieldSpecs
                ?? inlineCtx?.frozenCharacterCustomFieldSpecs,
        });
        if (opId && isOperationCurrent(opId)) {
            if (result) settleSceneBuild(opId, 'ready');
            else failSceneBuild(opId, new Error('Together extraction pipeline failed'), 'pipeline');
        }
        if (!result) _rearmIfFailedFullTogether(inlineCtx, baseOpts);
        return result;
    } catch (error) {
        if (opId && isOperationCurrent(opId)) {
            failSceneBuild(opId, error, 'pipeline');
        }
        _rearmIfFailedFullTogether(inlineCtx, baseOpts);
        throw error;
    }
}

export function discardTogetherSceneBuild(inlineCtx, reason = 'discarded') {
    const opId = inlineCtx?.sceneBuildOperationId;
    if (opId && isOperationCurrent(opId)) cancelSceneBuild(opId, reason);
    // Terminal cancel of a forced-full Together run must keep the debt.
    if (inlineCtx) _rearmIfFailedFullTogether(inlineCtx);
}

/** Same threshold as historical onCharMsg short-message wait gate. */
export const TOGETHER_SHORT_REPLY_CHARS = 100;

export function isShortTogetherReply(rawMes) {
    return String(rawMes || '').length < TOGETHER_SHORT_REPLY_CHARS;
}

/**
 * Empty/short chat reply: cancel scene-build and block recovery/fallback.
 * @returns {true}
 */
export function abortShortTogetherReply(inlineCtx, reason = 'empty-reply') {
    log('Together: short/empty reply — aborting scene build', reason);
    setCancelRequested(true);
    try { cancelTogetherSceneBuilds(reason); } catch {}
    discardTogetherSceneBuild(inlineCtx, reason);
    try { cancelSceneSourceTrace(); } catch {}
    try { clearPromptInjection(getActivePromptInjectionRun()?.runId || null); } catch {}
    setInlineGenerationContext(null);
    setInlineGenStartMs(0);
    setInlineExtractionDone(false);
    setPendingInlineIdx(-1);
    spSetGenerating(false);
    try { stopStreamingHider({ abort: true }); } catch {}
    try { cleanupGenUI(); } catch {}
    return true;
}

/**
 * MESSAGE_SWIPED: drop mid-flight Together scene ownership when the user
 * browses to another swipe. Expected swipe-generation advance (type=swipe,
 * frozen→frozen+1) rebinds instead.
 * @returns {'rebound'|'aborted'|'noop'}
 */
export function handleTogetherSwipeChange(messageId, newSwipeId) {
    const ctx = inlineGenerationContext;
    const id = Number(messageId);
    if (!ctx || ctx.mesIdx !== id) return 'noop';
    const frozen = Math.max(0, Number(ctx.swipeId) || 0);
    const next = Math.max(0, Number(newSwipeId) || 0);
    if (frozen === next) return 'noop';
    const expectedSwipeGen = String(ctx.generationType || '') === 'swipe' && next === frozen + 1;
    if (expectedSwipeGen) {
        rebindInlineCtxForExpectedSwipe(ctx, id);
        return 'rebound';
    }
    log('Together: swipe browse cancelled scene build mes=', id, 'swipe', frozen, '→', next);
    discardTogetherSceneBuild(ctx, 'swipe-changed');
    try { cancelSceneSourceTrace(); } catch {}
    try { clearPromptInjection(getActivePromptInjectionRun()?.runId || null); } catch {}
    setInlineGenerationContext(null);
    setInlineGenStartMs(0);
    setInlineExtractionDone(false);
    setPendingInlineIdx(-1);
    spSetGenerating(false);
    try { stopStreamingHider({ abort: true }); } catch {}
    try { cleanupGenUI(); } catch {}
    return 'aborted';
}

/**
 * Unlock Separate/`generateTracker` busy state only when this swipe cancelled
 * work for the same message (supersede, Together abort, or bare gen target).
 */
export function unlockAfterSwipeCancel({ messageId, supersededCount = 0, togetherResult = 'noop' } = {}) {
    if (!generating) return;
    const id = Number(messageId);
    const sameBareTarget = getGenerationTargetMesIdx() === id;
    const cancelledHere = (Number(supersededCount) > 0) || togetherResult === 'aborted' || sameBareTarget;
    if (!cancelledHere) return;
    if (getActiveSceneBuilds().some(op => op.messageId === id)) return;
    setGenNonce(genNonce + 1);
    setCancelRequested(true);
    setGenerating(false);
    setGenerationTargetMesIdx(null);
    spSetGenerating(false);
    try { setBrandState('idle'); } catch {}
    try { cleanupGenUI(); } catch {}
    log('SceneBuild: unlocked after swipe cancelled in-flight generation for mes=', id);
}
