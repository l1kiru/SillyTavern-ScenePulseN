// src/generation/pipeline.js — Shared extraction→normalize→save→updatePanel pipeline
// Eliminates duplication between index.js GENERATION_ENDED, message.js onCharMsg, and engine.js

import { log, warn } from '../logger.js';
import {
    setCurrentSnapshotMesIdx, setLastGenSource, setLastRawResponse, setLastDeltaPayload,
    addSessionTokens, setLastDeltaSavings, _lastDeltaSavings, setLastExtractionFailure
} from '../state.js';
import { getSettings, getActiveSchema, getPrevSnapshot, getActiveSwipeId, saveSnapshot, ensureChatSaved, shouldUseDelta, clearForceFullState, hasStaleSnapshotBefore } from '../settings.js';
import { normalizeTracker } from '../normalize.js';
import { mergeDelta, preserveOffSceneEntities } from './delta-merge.js';
import { updatePanel } from '../ui/update-panel.js';
import { spPostGenShow, spSetGenerating } from '../ui/mobile.js';
import { addMesButton } from '../ui/message.js';
import { stopStreamingHider } from './streaming.js';
import { validateExtraction } from './validation.js';
import { recordExtractionFailure } from './extraction.js';
import { buildRequestSchema } from '../schema.js';
import { classifyTimeChange } from '../temporal-check.js';
import { currentChatFingerprint, currentChatKey, validateOperationOwner } from '../message-fingerprint.js';
import { finishSceneSourceTrace } from '../scene-source-trace.js';

/**
 * Process extracted tracker data through the full pipeline:
 * delta merge → normalize → log summary → attach metadata → save snapshot → update panel → save chat
 *
 * @param {number} mesIdx - Message index
 * @param {object} extracted - Raw extracted tracker data
 * @param {string} source - Generation source identifier (e.g., 'auto:together')
 * @param {object} opts - Options
 * @param {number} opts.promptTokens - Estimated prompt tokens
 * @param {number} opts.completionTokens - Estimated completion tokens
 * @param {number} opts.elapsed - Generation time in seconds
 * @param {boolean} opts.stopHider - Whether to stop the streaming hider
 * @param {boolean} opts.unlockGen - Whether to set generating=false
 * @returns {object|null} - Normalized tracker data, or null on failure
 */
export async function processExtraction(mesIdx, extracted, source, opts = {}) {
    const s = getSettings();
    const { promptTokens = 0, completionTokens = 0, elapsed = 0 } = opts;

    setLastGenSource(source);
    setLastRawResponse(JSON.stringify(extracted, null, 2));
    addSessionTokens(promptTokens + completionTokens);

    // Delta merge — v6.8.50: use shouldUseDelta() which respects the
    // periodic full-state refresh counter.
    const targetSwipeId = opts.swipeId ?? getActiveSwipeId(mesIdx);
    if(opts.owner){const ownerCheck=validateOperationOwner(opts.owner,{requireSource:!!opts.owner.sourceFingerprint});if(!ownerCheck.valid){warn('Pipeline: owner changed; discarding result for',mesIdx,ownerCheck.code);return null}}
    if (opts.expectedSwipeId !== undefined && getActiveSwipeId(mesIdx) !== opts.expectedSwipeId) {
        warn('Pipeline: active swipe changed before extraction; discarding result for', mesIdx, '/', opts.expectedSwipeId);
        return null;
    }
    if (opts.expectedChatKey !== undefined && currentChatKey() !== opts.expectedChatKey) {
        warn('Pipeline: chat changed before extraction; discarding result for', mesIdx);
        return null;
    }
    if (opts.expectedParentFingerprint !== undefined && currentChatFingerprint(mesIdx - 1) !== opts.expectedParentFingerprint) {
        warn('Pipeline: parent context changed before extraction; discarding result for', mesIdx);
        return null;
    }
    if (opts.expectedSourceFingerprint !== undefined && currentChatFingerprint(mesIdx, targetSwipeId) !== opts.expectedSourceFingerprint) {
        warn('Pipeline: source message changed before extraction; discarding result for', mesIdx);
        return null;
    }
    const prevSnap = Object.hasOwn(opts, 'baseSnapshot') ? opts.baseSnapshot : getPrevSnapshot(mesIdx);
    const _useDelta = !hasStaleSnapshotBefore(mesIdx)&&shouldUseDelta(prevSnap);
    clearForceFullState();
    const requestSchema=buildRequestSchema(getActiveSchema(),{mode:_useDelta?'delta':'full'}).value;
    if(!Object.hasOwn(requestSchema.properties||{},'plotBranches'))delete extracted.plotBranches;
    const _validation=validateExtraction(extracted,{schema:requestSchema});
    if(!_validation.valid){
        warn('Pipeline: rejecting invalid tracker payload:',_validation.errors.join('; '));
        recordExtractionFailure('SEMANTIC_INVALID','Tracker JSON failed schema validation',JSON.stringify(extracted),mesIdx,{stage:'validate',owner:opts.owner,validationErrors:_validation.errors});
        return null;
    }
    if (_useDelta && prevSnap) {
        setLastDeltaPayload(extracted);
        const fullEstimate = Math.round(JSON.stringify(prevSnap).length / 4);
        if (fullEstimate > 0) {
            setLastDeltaSavings(Math.max(0, Math.round((1 - (completionTokens / fullEstimate)) * 100)));
        }
        extracted = mergeDelta(prevSnap, extracted);
        log('Pipeline: delta merge applied');
    } else {
        setLastDeltaPayload(null);
        setLastDeltaSavings(0);
        // Full-state mode (no prev OR periodic-refresh / deltaMode=off):
        // preserve off-scene characters/relationships from the previous snapshot.
        // The LLM only returns characters in the current scene; without this
        // block, every periodic full-state refresh (default every 15 turns)
        // permanently drops the off-scene roster from the saved snapshot.
        // Shared with engine.js through preserveOffSceneEntities. (Issue #11)
        preserveOffSceneEntities(extracted, prevSnap);
    }

    // Normalize
    const norm = normalizeTracker(extracted);
    setCurrentSnapshotMesIdx(mesIdx);

    // Attach validation warnings for Inspector
    if (_validation.warnings.length) norm._validationWarnings = _validation.warnings;

    // v6.24.0: Temporal validation. Detects LLM-emitted time regressions and
    // implausible jumps; rewrites in-place when the model contradicts its own
    // `elapsed` field or goes backward without a flashback signal. User edits
    // (`_spMeta.userEdited`), group chats, cold start, and previously-rewritten
    // anchors all skip cleanly. Pure call — see src/temporal-check.js.
    let _isGroupChat = false;
    try { _isGroupChat = !!SillyTavern.getContext().groupId; } catch {}
    const _tc = classifyTimeChange({ prev: prevSnap, next: norm, isGroupChat: _isGroupChat });
    if (_tc.action === 'rewrite') {
        const _from = _tc.signals.nextTime;
        warn('TemporalCheck: rewriting time', _from, '→', _tc.newTime, '(' + _tc.reason + ')');
        norm.time = _tc.newTime;
        norm._temporal = {
            action: 'rewrite',
            rewrittenFrom: _from,
            rewrittenTo: _tc.newTime,
            reason: _tc.reason,
            _v: 1,
        };
    }

    // Log summary
    _logSummary(norm, source);

    // Attach metadata (persists per-snapshot for historical browsing)
    // v6.8.50: track deltaTurnsSinceFull for the periodic refresh counter.
    const _prevCounter = (prevSnap?._spMeta?.deltaTurnsSinceFull ?? 0);
    // Attach metadata to the NORMALIZED data (not raw extracted) so the
    // saved snapshot matches what the panel displays. This aligns with
    // engine.js which also saves normalized data.
    norm._spMeta = {
        promptTokens,
        completionTokens,
        elapsed,
        source,
        injectionMethod: s.injectionMethod || 'inline',
        deltaSavings: _lastDeltaSavings || 0,
        deltaMode: _useDelta,
        deltaTurnsSinceFull: _useDelta ? _prevCounter + 1 : 0,
    };
    if (s.sceneSourceTrace === true && source.startsWith('auto:together')) {
        const trace = finishSceneSourceTrace(opts.owner, { forceEmpty: true });
        if (trace) norm._spMeta.sceneSourceTrace = trace;
    }
    // Save normalized snapshot (consistent with engine.js path)
    saveSnapshot(mesIdx, norm, targetSwipeId);
    setLastExtractionFailure(null);

    // Update panel
    updatePanel(norm);
    spPostGenShow();

    if (opts.stopHider) stopStreamingHider();
    if (opts.unlockGen) spSetGenerating(false);

    // Add message button
    const el = document.querySelector(`.mes[mesid="${mesIdx}"]`);
    if (el) addMesButton(el);

    // Save chat
    try {
        await ensureChatSaved();
        log('Pipeline: chat saved for mesIdx=', mesIdx);
    } catch (e) {
        log('Pipeline: chat save failed:', e?.message);
    }

    return norm;
}

function _logSummary(norm, source) {
    log('=== PIPELINE SUMMARY === source=', source);
    log('  chars:', norm.characters?.length || 0, 'rels:', norm.relationships?.length || 0);
    log('  quests: main=', norm.mainQuests?.length || 0, 'side=', norm.sideQuests?.length || 0);
    log('  ideas:', norm.plotBranches?.length || 0, 'northStar:', JSON.stringify(norm.northStar || '').substring(0, 50));
    log('  scene: topic=' + (norm.sceneTopic ? '✓' : '✗'), 'mood=' + (norm.sceneMood ? '✓' : '✗'), 'tension=' + (norm.sceneTension ? '✓' : '✗'));
    if (norm.characters?.length) {
        for (const c of norm.characters) log('  char:', c.name, 'role=', c.role ? '✓' : '✗', 'thought=', c.innerThought ? '✓' : '✗');
    }
    if (norm.relationships?.length) {
        for (const r of norm.relationships) log('  rel:', r.name, 'aff=', r.affection, 'trust=', r.trust, 'desire=', r.desire, 'compat=', r.compatibility);
    }
}
