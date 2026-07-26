// Shared helpers for Together extract → processExtraction under SceneBuild.

import {
    updateSceneBuild, settleSceneBuild, failSceneBuild, cancelSceneBuild,
    isOperationCurrent,
} from './scene-build-controller.js';
import { processExtraction } from './pipeline.js';

export async function processTogetherExtraction(mesIdx, extracted, source, inlineCtx, baseOpts = {}) {
    const opId = inlineCtx?.sceneBuildOperationId || null;
    if (opId && isOperationCurrent(opId)) {
        updateSceneBuild(opId, { status: 'parsing' });
        updateSceneBuild(opId, { status: 'saving' });
    }
    const result = await processExtraction(mesIdx, extracted, source, {
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
    });
    if (opId && isOperationCurrent(opId)) {
        if (result) settleSceneBuild(opId, 'ready');
        else failSceneBuild(opId, new Error('Together extraction pipeline failed'), 'pipeline');
    }
    return result;
}

export function discardTogetherSceneBuild(inlineCtx, reason = 'discarded') {
    const opId = inlineCtx?.sceneBuildOperationId;
    if (opId && isOperationCurrent(opId)) cancelSceneBuild(opId, reason);
}
