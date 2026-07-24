// runSceneBuild — wraps async scene construction with currency checks + FSM updates.

import { log, warn } from '../logger.js';
import { getActiveSwipeId } from '../settings.js';
import {
    startSceneBuild, updateSceneBuild, settleSceneBuild, failSceneBuild,
    isOperationCurrent, getSceneBuild, isTerminalStatus,
} from './scene-build-controller.js';

/**
 * @param {object} opts
 * @param {number} opts.messageId
 * @param {number} [opts.swipeId]
 * @param {string} [opts.source]
 * @param {string} [opts.chatKey]
 * @param {boolean} [opts.stopStOnAbort]
 * @param {(ctx:{
 *   operation: object,
 *   signal: AbortSignal,
 *   isCurrent: ()=>boolean,
 *   setStatus: (status:string, patch?:object)=>object|null,
 *   markRequest: (inFlight:boolean)=>void,
 * }) => Promise<*>} opts.run
 */
export async function runSceneBuild(opts) {
    const messageId = Number(opts.messageId);
    const swipeId = opts.swipeId ?? getActiveSwipeId(messageId);
    const op = startSceneBuild({
        messageId,
        swipeId,
        source: opts.source || 'manual',
        chatKey: opts.chatKey,
        stopStOnAbort: opts.stopStOnAbort === true,
    });
    const operationId = op.operationId;
    const isCurrent = () => isOperationCurrent(operationId);
    const setStatus = (status, patch = {}) => {
        if (!isCurrent()) return null;
        return updateSceneBuild(operationId, { status, ...patch });
    };
    const markRequest = (inFlight) => {
        if (!isOperationCurrent(operationId) && !getSceneBuild(operationId)) return;
        updateSceneBuild(operationId, { requestInFlight: !!inFlight });
    };

    setStatus('generating');
    let settled = false;
    try {
        const result = await opts.run({
            operation: getSceneBuild(operationId),
            signal: op.abortController.signal,
            isCurrent,
            setStatus,
            markRequest,
        });
        if (!isCurrent()) {
            log('SceneBuild: late result ignored', operationId);
            return null;
        }
        if (result == null && opts.treatNullAsCancel) {
            settleSceneBuild(operationId, 'cancelled', { cancellationReason: 'null-result' });
            settled = true;
            return null;
        }
        if (result == null) {
            // generateTracker / extract paths return null for cancel, validation, busy
            const live = getSceneBuild(operationId);
            if (live && !isTerminalStatus(live.status)) {
                failSceneBuild(operationId, new Error('Scene build returned no data'), 'empty');
                settled = true;
            }
            return null;
        }
        settleSceneBuild(operationId, 'ready');
        settled = true;
        return result;
    } catch (e) {
        const aborted = e?.name === 'AbortError' || String(e?.message || '').toLowerCase().includes('abort');
        if (!isCurrent()) {
            log('SceneBuild: error after supersede/cancel ignored', operationId);
            return null;
        }
        if (aborted || getSceneBuild(operationId)?.status === 'cancelling') {
            settleSceneBuild(operationId, 'cancelled', { cancellationReason: e?.message || 'aborted' });
            settled = true;
            return null;
        }
        warn('SceneBuild: failed', operationId, e?.message || e);
        failSceneBuild(operationId, e);
        settled = true;
        return null;
    } finally {
        const live = getSceneBuild(operationId);
        if (live && !settled && !isTerminalStatus(live.status)) {
            failSceneBuild(operationId, new Error('Scene build ended without settle'), 'finally');
        }
    }
}
