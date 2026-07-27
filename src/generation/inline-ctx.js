// Expected swipe-generation rebind for Together/inline ownership.
// ST freezes swipe_id at interceptor start; after a new sibling finishes,
// active swipe advances (typically frozen+1). Rebind so extract/save land
// on the final swipe. Real mid-flight branch switches still discard.

import { log } from '../logger.js';
import { getActiveSwipeId } from '../settings.js';
import { currentChatFingerprint, currentChatKey, captureOperationOwner } from '../message-fingerprint.js';
import {
    setInlineGenerationContext,
    getActivePromptInjectionRun,
    setActivePromptInjectionRun,
    getLastPromptInjectionMetrics,
    setLastPromptInjectionMetrics,
} from '../state.js';
import { rebindSceneBuildSwipe } from './scene-build-controller.js';
import { rebindSceneSourceTraceOwner } from '../scene-source-trace.js';

/**
 * Keep PromptInjectionPlan + last runtime metrics keyed to the final swipe.
 * Implemented here (via long-lived state.js APIs) instead of a new named
 * import from prompt-injection.js — mixed ESM cache after extension update
 * can otherwise link a new importer against an old dependency and reject the
 * whole module graph before APP_READY.
 * @param {{ chatKey?: string|null, messageId?: number|null, targetMessageId?: number|null, swipeId?: number|null }} owner
 * @returns {boolean}
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
 * @param {object|null|undefined} ctx - inlineGenerationContext
 * @param {number} targetIdx - assistant message index after generation
 * @returns {object|null|undefined} rebound or original ctx
 */
export function rebindInlineCtxForExpectedSwipe(ctx, targetIdx) {
    if (!ctx || ctx.mesIdx !== targetIdx) return ctx;
    const active = getActiveSwipeId(targetIdx);
    const frozen = Math.max(0, Number(ctx.swipeId) || 0);
    if (active === frozen) return ctx;
    if (ctx.chatKey != null && currentChatKey() !== ctx.chatKey) return ctx;
    if (ctx.parentFingerprint != null
        && currentChatFingerprint(targetIdx - 1) !== ctx.parentFingerprint) {
        return ctx;
    }
    // Only swipe-generations may advance ownership. A bare frozen+1 while
    // browsing another sibling mid-flight must NOT rebind (that kept scene
    // creation alive after MESSAGE_SWIPED).
    const type = String(ctx.generationType || '');
    if (type !== 'swipe' || active !== frozen + 1 || active < frozen) return ctx;

    const next = {
        ...ctx,
        swipeId: active,
        owner: captureOperationOwner(targetIdx, active, { trackSource: false }),
    };
    setInlineGenerationContext(next);
    if (next.sceneBuildOperationId) {
        rebindSceneBuildSwipe(next.sceneBuildOperationId, active);
    }
    try { rebindPromptInjectionOwner(next.owner); } catch {}
    try { rebindSceneSourceTraceOwner(next.owner); } catch {}
    log('InlineCtx: rebound swipe', frozen, '→', active, 'type=', type || '(none)', 'mesIdx=', targetIdx);
    return next;
}
