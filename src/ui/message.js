// src/ui/message.js — Message Integration (per-message buttons, onCharMsg, renderExisting)
import { log, warn, err } from '../logger.js';
import { t } from '../i18n.js';
import { MES_ICON_SVG } from '../constants.js';
import { SP_MARKER_START, extractInlineTracker, extractInlineTrackerWithReplySplit } from '../generation/extraction.js';
import { getSettings } from '../settings.js';
import { getTrackerData, getLatestSnapshotEntry, getSnapshotEntryForMessage, getTrustedSnapshotFor, getActiveSwipeId, getPrevSnapshot, reconcileSnapshotsAfterChatMutation, saveSnapshot, resolveScrubMesIdx } from '../settings.js';
import { normalizeTracker } from '../normalize.js';
import {
    generating, genNonce, setLastGenSource,
    genMeta, setGenMeta,
    currentSnapshotMesIdx, setCurrentSnapshotMesIdx,
    inlineExtractionDone, setInlineExtractionDone,
    inlineGenerationContext, setInlineGenerationContext,
    inlineGenStartMs, setInlineGenStartMs,
    pendingInlineIdx, setPendingInlineIdx,
    getLastExtractionFailure, shouldSkipAutoSceneRecovery,
    getActivePromptInjectionRun,
} from '../state.js';
import { clearPromptInjection } from '../generation/prompt-injection.js';
import { continuationReprompt } from '../generation/engine.js';
import { stopStreamingHider } from '../generation/streaming.js';
import { processExtraction } from '../generation/pipeline.js';
import { processTogetherExtraction, discardTogetherSceneBuild, abortShortTogetherReply, isShortTogetherReply } from '../generation/together-scene-build.js';
import { rebindInlineCtxForExpectedSwipe } from '../generation/inline-ctx.js';
import { cancelSceneSourceTrace, finishSceneSourceTrace } from '../scene-source-trace.js';
import { ensureChatSaved, anyPanelsActive } from '../settings.js';
import { spAutoShow, spPostGenShow, spSetGenerating } from './mobile.js';
import { showLoadingOverlay, clearLoadingOverlay, showStopButton, hideStopButton, startElapsedTimer, stopElapsedTimer, showThoughtLoading, showChatBanner, clearThoughtLoading, clearInlineWaitBanner } from './loading.js';
import { updatePanel } from './update-panel.js';
import { updateThoughts } from './thoughts.js';
import { createPanel, hidePanel } from './panel.js';
import { renderTimeline } from './timeline.js';
import { captureOperationOwner, validateOperationOwner } from '../message-fingerprint.js';
import { renderEmptyState } from './empty-state.js';
import { runManualSceneBuild, reconcileSceneBuildUi } from './scene-build-ui.js';
import { runSceneBuild } from '../generation/scene-build-runner.js';

/** Prefer this message+swipe snapshot after manual gen fails — never a foreign latest. */
function restorePanelAfterManualFail(mesIdx){
    const failure=getLastExtractionFailure();
    if(failure)warn('Manual generation failed:',failure.code,failure.message||'','mesIdx=',failure.mesIdx,'swipe=',failure.swipeId);
    const trusted=Number.isFinite(mesIdx)?getTrustedSnapshotFor(mesIdx):null;
    const body=document.getElementById('sp-panel-body');
    if(trusted){updatePanel(normalizeTracker(trusted));return}
    if(body)body.innerHTML='<div class="sp-error"><div style="font-weight:700;margin-bottom:4px">'+t('Generation Failed')+'</div><div style="font-size:10px">'+t('Network timeout or API issue. Try \u27F3 Regen or check debug log.')+'</div></div>';
}

async function _refreshAfterChatMutation(summary,label){
    log(label+': removed=',summary.removed,'restamped=',summary.restamped,'cutoff=',summary.cutoff);
    spSetGenerating(false);
    try{renderTimeline()}catch(e){warn(label+' timeline:',e)}
    await renderExisting();
    try{await ensureChatSaved()}catch(e){warn(label+' save:',e)}
}

let _chatMutationQueue=Promise.resolve();
function _queueChatMutation(work){
    _chatMutationQueue=_chatMutationQueue.then(work,work);
    return _chatMutationQueue;
}

// SillyTavern passes the new chat length here, not the deleted message id.
export function spOnMessageDeleted(){
    return _queueChatMutation(async()=>{
        // Scene-build wipe is sync in index.js MESSAGE_DELETED (before this queue).
        const summary=reconcileSnapshotsAfterChatMutation({type:'message-delete'});
        await _refreshAfterChatMutation(summary,'Message deletion');
        reconcileSceneBuildUi();
    });
}

export function spOnSwipeDeleted(payload,activeChanged){
    return _queueChatMutation(async()=>{
        // Scene-build wipe is sync in index.js MESSAGE_SWIPE_DELETED (before this queue).
        const summary=reconcileSnapshotsAfterChatMutation({
            type:'swipe-delete',messageId:payload?.messageId,swipeId:payload?.swipeId,activeChanged
        });
        await _refreshAfterChatMutation(summary,'Swipe deletion');
        reconcileSceneBuildUi();
    });
}

export function addMesButton(el){
    if(el.querySelector('.sp-mes-btn'))return;
    const btns=el.querySelector('.mes_buttons .extraMesButtons')||el.querySelector('.extraMesButtons')||el.querySelector('.mes_buttons');
    if(!btns){log('No button container for mesid',el.getAttribute('mesid'));return}
    const btn=document.createElement('div');btn.className='sp-mes-btn mes_button';btn.title=t('ScenePulse: Regenerate scene from this message');
    btn.innerHTML=`<span>${MES_ICON_SVG}</span>`;
    btn.addEventListener('click',async function(e){
        e.stopPropagation();e.preventDefault();
        const mes=this.closest('.mes');if(!mes){warn('No .mes parent found');return}
        const id=Number(mes.getAttribute('mesid'));
        log('Mes button clicked for id:',id);
        if(this.classList.contains('sp-generating')||this.getAttribute('aria-busy')==='true'){log('Already generating');return}
        const panel=document.getElementById('sp-panel');
        if(panel){spAutoShow();const body=document.getElementById('sp-panel-body');showLoadingOverlay(body,t('Generating Scene'),t('Analyzing context'));showStopButton();startElapsedTimer()}
        showThoughtLoading(t('Generating Scene'),t('Analyzing context'));
        const preNonce=genNonce;
        try{
            const r=await runManualSceneBuild(id,'manual:message');
            if(genNonce>preNonce+1){log('Mes-btn: stale caller');return}
            hideStopButton();stopElapsedTimer();
            clearLoadingOverlay(document.getElementById('sp-panel-body'));clearThoughtLoading();
            if(!r)restorePanelAfterManualFail(id);
        }catch(ex){
            err('Mes button gen error:',ex);
            hideStopButton();clearLoadingOverlay(document.getElementById('sp-panel-body'));clearThoughtLoading();
        }
    });
    btns.appendChild(btn);
}

export async function onCharMsg(idx){
    const s=getSettings();if(!s.enabled)return;
    if(!anyPanelsActive()){return}  // Nothing to extract/generate for
    const{chat}=SillyTavern.getContext();if(!chat[idx]||chat[idx].is_user)return;
    log('onCharMsg: idx=',idx,'method=',s.injectionMethod,'generating=',generating,'inlineExtDone=',inlineExtractionDone,'pendingIdx=',pendingInlineIdx);
    const el=document.querySelector(`.mes[mesid="${idx}"]`);if(!el)return;
    addMesButton(el);
    // Don't auto-generate on empty/greeting-only chats -- need at least one user message
    const hasUserMsg=chat.some(m=>m.is_user);
    if(!hasUserMsg){log('onCharMsg: no user messages yet, skipping auto-gen');return}

    // ── INLINE/TOGETHER MODE: Extract tracker from AI response ──
    if(s.injectionMethod==='inline'){
        const _inlineCtx=rebindInlineCtxForExpectedSwipe(inlineGenerationContext,idx);
        if(_inlineCtx&&(_inlineCtx.mesIdx!==idx||getActiveSwipeId(idx)!==_inlineCtx.swipeId)){
            warn('onCharMsg [inline]: target swipe changed; discarding tracker for',idx);
            discardTogetherSceneBuild(_inlineCtx,'swipe-changed');
            cancelSceneSourceTrace();
            try { clearPromptInjection(getActivePromptInjectionRun()?.runId || null); } catch {}
            setInlineGenerationContext(null);setInlineGenStartMs(0);spSetGenerating(false);
            return;
        }
        // If GENERATION_ENDED already extracted successfully, skip
        if(inlineExtractionDone){
            log('onCharMsg [inline]: extraction already complete (via GENERATION_ENDED), skipping');
            return;
        }
        // Guard: only extract when ScenePulse actually injected a prompt.
        // Other extensions (e.g. MemoryBooks) may render messages from their own generations.
        if(inlineGenStartMs<=0){
            log('onCharMsg [inline]: skipping — ScenePulse did not inject into this generation cycle (inlineGenStartMs=0)');
            return;
        }
        // FALLBACK: GENERATION_ENDED didn't extract (timing / long reply without tracker).
        // Remove waiting indicators
        clearInlineWaitBanner();
        clearThoughtLoading();
        setPendingInlineIdx(idx);
        log('onCharMsg [inline]: GENERATION_ENDED missed, retrying as fallback');
        // Always split BEFORE extract (extract strips tracker from mes).
        let { extracted, replySplit, rawMes } = extractInlineTrackerWithReplySplit(idx);
        if (!extracted && isShortTogetherReply(rawMes)) {
            log('onCharMsg [inline]: short/empty reply (' + rawMes.length + ' chars), aborting scene build');
            abortShortTogetherReply(_inlineCtx, 'empty-reply');
            spSetGenerating(false);
            return;
        }
        if(extracted){
            const _compTokens=replySplit.totalTokens||Math.round(rawMes.length/4);
            const _elapsed=inlineGenStartMs>0?((Date.now()-inlineGenStartMs)/1000):0;
            setGenMeta({...genMeta, promptTokens:0, completionTokens:_compTokens, elapsed:_elapsed});
            setInlineGenStartMs(0);
            log('onCharMsg [inline]: extracted tracker from message',idx,'keys=',Object.keys(extracted).length,'~tokens:',_compTokens,'narrative=',replySplit.narrativeTokens,'tracker=',replySplit.trackerTokens);
            setInlineExtractionDone(true);setPendingInlineIdx(-1);
            stopStreamingHider();
            await processTogetherExtraction(idx, extracted, 'auto:together', _inlineCtx, {
                promptTokens:0, completionTokens:_compTokens, elapsed:_elapsed,
                narrativeTokens:replySplit.narrativeTokens, trackerTokens:replySplit.trackerTokens,
                stopHider:false, unlockGen:true,
            });
            try { clearPromptInjection(getActivePromptInjectionRun()?.runId || null); } catch {}
            setInlineGenerationContext(null);
            log('onCharMsg [inline]: pipeline complete');
        } else {
            const msgText=chat[idx]?.mes||'';
            const msgReasoning=chat[idx]?.extra?.reasoning||'';
            const msgLen=msgText.length;
            // Distinguish failure modes: markers absent (prompt-following failure) vs markers present
            // but JSON parse failed (sampling/formatting failure). Different root causes, different fixes.
            const _markersPresent=(msgText+msgReasoning).indexOf(SP_MARKER_START)!==-1;
            const _failureKind=_markersPresent?'markers found, JSON unparseable':'no SP markers';
            log('onCharMsg [inline]: no tracker found in message',idx,'('+msgLen+' chars,',_failureKind+')');
            // If the AI wrote content but omitted the tracker, recover.
            if(!isShortTogetherReply(msgText)&&s.autoGenerate&&!generating&&s.fallbackEnabled!==false&&!shouldSkipAutoSceneRecovery()){
                const fbProfile=s.fallbackProfile||s.connectionProfile||'';
                const fbPreset=s.fallbackPreset||s.chatPreset||'';
                // v6.23.9: removed the `if(!fbProfile && !fbPreset) showRecoveryCard`
                // early-return. v6.23.7's "(Same as current)" dropdown made empty a
                // valid configuration meaning "use current preset, no switch" — but
                // this branch still treated empty as "user hasn't configured anything,
                // skip auto-fallback." After v6.23.8's migration cleared stale "0"
                // values to "" the user's auto-fallback stopped firing entirely.
                // withProfileAndPreset('', '', fn) is now a clean no-op pass-through,
                // so always run the recovery chain. Recovery card still appears in
                // the Tier 2 failure branch below.
                {
                    stopStreamingHider(); // Stop the hider since we're switching to recovery
                    const panel=document.getElementById('sp-panel');
                    if(panel){spAutoShow();showLoadingOverlay(document.getElementById('sp-panel-body'),t('Generating Scene'),t('Analyzing context'));showStopButton();startElapsedTimer()}
                    showChatBanner('Generating tracker');

                    // ── Tier 1: cheap continuation re-prompt ──
                    // Only attempt for the "no SP markers" failure mode where the model wrote
                    // a normal narrative but forgot the appendix. This is much cheaper than a
                    // full separate generation: ~600-2500 prompt tokens vs ~6000, ~10-15s vs
                    // ~40s, and the tracker is generated from the *exact* narrative the user
                    // is reading rather than re-derived from message context.
                    //
                    // We skip this tier if markers were present (JSON parse failure) — re-asking
                    // the model wouldn't change the underlying sampling/formatting glitch, so
                    // jump straight to the full separate generation in that case.
                    let result=null;
                    if(!_markersPresent && msgLen>=500 && msgLen<=2500){
                        warn('Together mode: tracker extraction failed ('+msgLen+' chars, '+_failureKind+'). Attempting continuation re-prompt...');
                        setLastGenSource('auto:together:continuation');
                        try{
                            const cont=await continuationReprompt(msgText,{
                                profile:fbProfile,preset:fbPreset,mesIdx:idx,swipeId:_inlineCtx?.swipeId,
                                baseSnapshot:_inlineCtx?.baseSnapshot??null,owner:_inlineCtx?.owner,
                                sceneBuildOperationId:_inlineCtx?.sceneBuildOperationId,
                                stopStOnAbort:false,
                            });
                            if(cont){
                                const meta=cont._spContinuationMeta||{};
                                delete cont._spContinuationMeta;
                                await processTogetherExtraction(idx, cont, 'auto:together:continuation', _inlineCtx, {
                                    promptTokens:meta.promptTokens||0,
                                    completionTokens:meta.completionTokens||0,
                                    elapsed:meta.elapsed||0,
                                    stopHider:false, unlockGen:false,
                                });
                                result=cont;
                                log('Together continuation: succeeded in',(meta.elapsed||0).toFixed(1)+'s — skipped full separate generation');
                            } else {
                                log('Together continuation: failed, escalating to full separate generation');
                            }
                        }catch(e){
                            warn('Together continuation: exception, escalating to full separate generation:',e?.message||String(e));
                        }
                    }

                    // ── Tier 2: full separate generation (if continuation skipped or failed) ──
                    // v6.23.7: skip Tier 2 if the user cancelled during Tier 1.
                    // Pre-v6.23.7 the cancel flag was only consulted by individual
                    // generation functions, so cancelling continuation immediately
                    // kicked off a fresh full-context separate-generation call —
                    // and that one ALSO did the visible preset switch via
                    // withProfileAndPreset, which the user reasonably read as "I
                    // cancelled but it kept going AND swapped my preset." Treat
                    // a manual cancel as a hard stop on the whole recovery chain.
                    if(!result && shouldSkipAutoSceneRecovery()){
                        log('Together fallback: Tier 2 skipped — user cancelled during Tier 1');
                        cancelSceneSourceTrace();
                        result=null;
                    } else if(!result){
                        warn('Together mode: falling back to full separate generation ('+msgLen+' chars, '+_failureKind+')');
                        // Clear Together extension prompts before Separate recovery.
                        try { clearPromptInjection(getActivePromptInjectionRun()?.runId || null); } catch {}
                        // Lore belongs to the original visible generation, not the
                        // separate fallback request. Finish capture before generateTracker
                        // so Tier 2 cannot pollute or drop the active trace.
                        const sourceTrace=s.sceneSourceTrace===true
                            ?finishSceneSourceTrace(_inlineCtx?.owner,{forceEmpty:true})
                            :null;
                        result=await runManualSceneBuild(idx,'auto:together:fallback',null,{
                            profile:fbProfile,
                            preset:fbPreset,
                            sceneSourceTrace:sourceTrace,
                        });
                        if(result){
                            const norm=normalizeTracker(result);
                            updatePanel(norm);spPostGenShow();
                            log('Together fallback: separate generation succeeded via profile=',fbProfile||'(current)');
                        } else {
                            warn('Together fallback: separate generation also failed');
                            discardTogetherSceneBuild(_inlineCtx,'fallback-failed');
                            _showRecoveryCard(idx);
                            const failure=getLastExtractionFailure();
                            if(failure)warn('Together fallback failure:',failure.code,failure.message||'');
                            const prev=getTrustedSnapshotFor(idx);
                            if(prev){const norm=normalizeTracker(prev);updatePanel(norm);spPostGenShow()}
                        }
                    }

                    hideStopButton();stopElapsedTimer();
                    clearLoadingOverlay(document.getElementById('sp-panel-body'));clearThoughtLoading();
                }
            } else if(!isShortTogetherReply(msgText)&&shouldSkipAutoSceneRecovery()){
                log('Together mode: recovery skipped — user stopped generation');
                discardTogetherSceneBuild(_inlineCtx,'reply-stopped');
                stopStreamingHider();
            } else if(!isShortTogetherReply(msgText)&&!s.fallbackEnabled){
                log('Together mode: AI omitted tracker, fallback disabled by user');
                discardTogetherSceneBuild(_inlineCtx,'no-fallback');
                stopStreamingHider();
            } else if(isShortTogetherReply(msgText)){
                // Defensive: short path should have returned earlier; still abort if reached.
                abortShortTogetherReply(_inlineCtx,'empty-reply');
            }
            // Always show existing data for this message+swipe if we didn't generate
            const prev=getTrustedSnapshotFor(idx);
            if(prev){const norm=normalizeTracker(prev);updatePanel(norm);spPostGenShow()}
            // Defensive: clear inline generation ownership state on ALL recovery exit
            // paths — continuation success, continuation→tier2 success, tier2 failure,
            // recovery card shown, and fallback-disabled. The success path above
            // already resets these, but the failure branch previously leaked
            // inlineGenStartMs>0, which could misroute a subsequent message from
            // another extension (e.g. MemoryBooks) into ScenePulse's extraction path.
            setInlineGenStartMs(0);setInlineExtractionDone(false);setPendingInlineIdx(-1);
            setInlineGenerationContext(null);
        }
        spSetGenerating(false); // Pulse off -- inline path complete
        return; // Don't do separate generation in inline mode
    }

    // ── SEPARATE MODE: Auto-generate via separate API call ──
    let snap=getTrustedSnapshotFor(idx);
    if(!snap&&s.autoGenerate){
        if(shouldSkipAutoSceneRecovery()){
            log('onCharMsg [separate]: skipping auto-gen — user stopped generation');
            return;
        }
        // CRITICAL: Save the chat to disk FIRST, then wait for ST to finish all post-save hooks.
        // withProfileAndPreset triggers connection_profile_loaded -> CHAT_CHANGED -> chat reload.
        // If the message isn't saved to disk yet, it gets lost in the reload.
        log('onCharMsg: saving chat and waiting 4s before auto-gen...');
        setLastGenSource('auto:separate');
        const scheduledSwipeId=getActiveSwipeId(idx);
        const scheduledOwner=captureOperationOwner(idx,scheduledSwipeId);
        await ensureChatSaved();
        await new Promise(r=>setTimeout(r,4000));
        // Re-check the exact chat/message/swipe after the delay. A swipe, edit,
        // deletion or chat switch must not let this old timer generate into the
        // new branch. Also avoid a duplicate call if another path already saved it.
        if(shouldSkipAutoSceneRecovery()){log('onCharMsg [separate]: user stopped during delay, aborting');return}
        const{chat:freshChat}=SillyTavern.getContext();
        if(!freshChat[idx]){log('onCharMsg: message gone after delay, aborting');return}
        const ownerCheck=validateOperationOwner(scheduledOwner,{requireSource:true});
        if(!ownerCheck.valid){log('onCharMsg: scheduled owner changed, aborting:',ownerCheck.code);return}
        snap=getTrustedSnapshotFor(idx,scheduledSwipeId);
        if(snap){log('onCharMsg: snapshot appeared during delay, skipping duplicate generation');updatePanel(normalizeTracker(snap));updateThoughts(snap);return}
        if(generating){log('onCharMsg: already generating after delay, skipping');return}
        const panel=document.getElementById('sp-panel');
        if(panel){spAutoShow();showLoadingOverlay(document.getElementById('sp-panel-body'),t('Generating Scene'),t('Analyzing context'));showStopButton();startElapsedTimer()}
        showChatBanner(t('Generating Scene'));
        const preNonce=genNonce;
        snap=await runManualSceneBuild(idx,'auto:separate');
        if(genNonce>preNonce+1){log('Auto-gen: stale caller, cancel handled UI');return}
        hideStopButton();stopElapsedTimer();
        clearLoadingOverlay(document.getElementById('sp-panel-body'));clearThoughtLoading();
        if(snap)updateThoughts(snap);
        else{
            // Cancelled or failed -- restore this message+swipe, not a foreign latest
            const failure=getLastExtractionFailure();
            if(failure)warn('Auto-gen failed:',failure.code,failure.message||'','mesIdx=',failure.mesIdx,'swipe=',failure.swipeId);
            const prev=getTrustedSnapshotFor(idx);const body=document.getElementById('sp-panel-body');
            if(prev){const norm=normalizeTracker(prev);updatePanel(norm)}
            else if(body)renderEmptyState({icon:'⟳'});
        }
    }else if(snap){
        const norm=normalizeTracker(snap);updatePanel(norm);
    }
}

export async function onMessageSwiped(idx){
    const id=Number(idx);
    const trusted=Number.isFinite(id)?getTrustedSnapshotFor(id):null;
    if(trusted){
        try{updateThoughts(normalizeTracker(trusted))}catch{}
        setTimeout(()=>renderExisting(id),0);
        reconcileSceneBuildUi();
        return;
    }
    const s=getSettings();
    if(s.enabled&&s.injectionMethod==='inline'&&Number.isFinite(id)&&anyPanelsActive()){
        try{
            const extracted=extractInlineTracker(id);
            if(extracted){
                const swipeId=getActiveSwipeId(id);
                const owner=captureOperationOwner(id,swipeId,{trackSource:false});
                log('MESSAGE_SWIPED: recovering inline tracker for',id,'swipe',swipeId);
                await runSceneBuild({
                    messageId:id,
                    swipeId,
                    source:'auto:together:swipe-recover',
                    run:async({operation,setStatus,isCurrent,markRequest})=>{
                        markRequest(true);
                        try{
                            setStatus('parsing');
                            setStatus('saving');
                            const result=await processExtraction(id,extracted,'auto:together:swipe-recover',{
                                swipeId,expectedSwipeId:swipeId,
                                baseSnapshot:getPrevSnapshot(id),
                                expectedChatKey:owner.chatKey,
                                expectedParentFingerprint:owner.parentFingerprint,
                                owner,
                                stopHider:false,unlockGen:true,
                                sceneBuildOperationId:operation.operationId,
                            });
                            if(!isCurrent())return null;
                            return result;
                        }finally{markRequest(false)}
                    },
                });
                const snap=getTrustedSnapshotFor(id);
                try{updateThoughts(snap?normalizeTracker(snap):null)}catch{}
                setTimeout(()=>renderExisting(id),0);
                return;
            }
        }catch(e){warn('MESSAGE_SWIPED swipe recover:',e)}
    }
    try{updateThoughts(null)}catch{}
    setTimeout(()=>renderExisting(id),0);
    reconcileSceneBuildUi();
}

export async function renderExisting(targetMessageId){
    if(!getSettings().enabled){hidePanel();return}
    // If a generation is active, don't touch the panel -- the overlay is showing
    if(generating){log('renderExisting: generation active, skipping panel update');return}
    try{
    createPanel(); // Ensure panel exists
    const all=getTrackerData();const sorted=Object.keys(all.snapshots).map(Number).sort((a,b)=>a-b);
    log('renderExisting:',sorted.length,'snapshots');
    let latestRaw=null;let latestKey=null;
    for(const k of sorted){
        const el=document.querySelector(`.mes[mesid="${k}"]`);
        if(el){try{addMesButton(el)}catch(e){warn('addMesButton:',e)}}
    }
    const targetId=Number(targetMessageId);
    const latestEntry=Number.isFinite(targetId)?getSnapshotEntryForMessage(targetId):getLatestSnapshotEntry();
    const latestStatus=latestEntry?.status??'missing';
    latestRaw=latestStatus==='stale'?null:(latestEntry?.snapshot??null);
    latestKey=latestEntry?.id??null;
    // Scrub tracks the open *stored* scene. Never point it at a missing swipe
    // target — that falsely triggers "not the current scene" → Jump to older msg.
    const scrubTo=resolveScrubMesIdx({entry:latestEntry,mirrorIds:sorted,currentScrub:currentSnapshotMesIdx});
    setCurrentSnapshotMesIdx(scrubTo);
    let latest=null;
    if(latestRaw){
        try{
            log('renderExisting: normalizing latest snapshot',latestKey,'raw keys=',Object.keys(latestRaw||{}).join(','));
            latest=normalizeTracker(latestRaw);
        }catch(e){warn('normalize snapshot',latestKey,':',e)}
    }
    // RECOVERY: If no snapshots found, walk every AI message that contains
    // an inline tracker block, extract each, and replay them through delta-
    // merge so the wiki / character-history have a complete record. Without
    // this, starting ScenePulse on an existing N-message chat would only
    // recover ONE snapshot (the last) — every character introduced in
    // earlier messages would be missing from history. (Issue #11)
    if(!latest&&latestStatus!=='stale'&&!Number.isFinite(targetId)&&getSettings().injectionMethod==='inline'){
        try{
            const{chat}=SillyTavern.getContext();
            const{mergeDelta:_md}=await import('../generation/delta-merge.js');
            let recovered=0;
            let mergedSoFar=null;
            for(let i=0;i<chat.length;i++){
                if(chat[i]?.is_user)continue;
                const raw=chat[i]?.mes||'';
                if(!(raw.includes(SP_MARKER_START)||raw.match(/```json\s*\n?[\s\S]{500,}```\s*$/)))continue;
                const extracted=extractInlineTracker(i);
                if(!extracted)continue;
                // Replay each extracted block through delta-merge against
                // the running merged state so off-scene characters persist
                // across the recovered timeline. Idempotent: identical
                // raw payloads always produce identical merged output.
                const merged=mergedSoFar?_md(mergedSoFar,extracted):extracted;
                const norm=normalizeTracker(merged);
                setCurrentSnapshotMesIdx(i);
                saveSnapshot(i,norm);
                mergedSoFar=norm;
                latest=norm;
                latestKey=i;
                recovered++;
            }
            if(recovered>0){
                await ensureChatSaved();
                log('renderExisting: backfilled',recovered,'snapshots from chat history');
            }
        }catch(e){warn('renderExisting inline recovery:',e)}
    }
    if(latest){
        log('renderExisting: latest snapshot has chars=',latest.characters?.length||0,'rels=',latest.relationships?.length||0);
        try{updatePanel(latest,true);log('renderExisting: panel updated')}catch(e){err('updatePanel:',e)}
        spAutoShow(); // Show panel BEFORE thoughts so syncThoughts sees it as visible
        // Thoughts are message-local and must belong to the latest assistant
        // response. Targeted swipe rendering never borrows an older scene, and
        // this check also protects general restoration after chat mutations.
        const chat=SillyTavern.getContext().chat||[];let latestAssistantId=-1;
        for(let i=chat.length-1;i>=0;i--){if(chat[i]&&!chat[i].is_user&&!chat[i].is_system){latestAssistantId=i;break}}
        const thoughtData=latestKey===latestAssistantId?latest:null;
        try{updateThoughts(thoughtData);log('renderExisting: thoughts updated for message',thoughtData?latestKey:'(none)')}catch(e){err('updateThoughts:',e)}
    } else if(latestStatus==='stale') {
        spAutoShow();
        try{updateThoughts(null)}catch(e){warn('clear stale thoughts:',e)}
        renderEmptyState({
            icon:'⚠',
            title:t('Scene data is out of date'),
            message:t('The chat text or swipe branch changed. Regenerate ScenePulse before using this state.'),
            className:'sp-stale-state',
            onRegenerate:async()=>{
                await runManualSceneBuild(latestKey,'manual:stale-recovery');
            },
        });
        log('renderExisting: latest snapshot is stale for message',latestKey);
    } else {
        // No data yet -- show empty panel with centered waiting message
        spAutoShow();
        renderEmptyState({icon:'⟳'});
        try{updateThoughts(null)}catch(e){warn('clear thoughts:',e)}
        log('renderExisting: no snapshots, showing empty panel');
    }
    try{document.querySelectorAll('.mes:not([is_user="true"])').forEach(el=>addMesButton(el))}catch(e){warn('addButtons:',e)}
    }catch(e){err('renderExisting:',e)}
}

// ── Recovery card: shown when extraction fails and no fallback is configured ──
async function _showRecoveryCard(mesIdx) {
    const failure=getLastExtractionFailure();
    const{showJsonRecovery}=await import('./json-recovery.js');
    showJsonRecovery({mesIdx,failure,stripInline:true,onRetry:async()=>{await runManualSceneBuild(mesIdx,'manual:recovery')}});
}
