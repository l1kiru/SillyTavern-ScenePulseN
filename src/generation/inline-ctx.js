// Expected swipe-generation rebind for Together/inline ownership.
// ST freezes swipe_id at interceptor start; after a new sibling finishes,
// active swipe advances (typically frozen+1). Rebind so extract/save land
// on the final swipe. Real mid-flight branch switches still discard.

import { log } from '../logger.js';
import { getActiveSwipeId } from '../settings.js';
import { currentChatFingerprint, currentChatKey, captureOperationOwner } from '../message-fingerprint.js';
import { setInlineGenerationContext } from '../state.js';

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
    const type = String(ctx.generationType || '');
    const expectedAdvance = type === 'swipe' || active === frozen + 1;
    if (!expectedAdvance || active < frozen) return ctx;

    const next = {
        ...ctx,
        swipeId: active,
        owner: captureOperationOwner(targetIdx, active),
    };
    setInlineGenerationContext(next);
    log('InlineCtx: rebound swipe', frozen, '→', active, 'type=', type || '(none)', 'mesIdx=', targetIdx);
    return next;
}
