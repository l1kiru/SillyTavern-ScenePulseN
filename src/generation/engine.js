// ── engine.js — Generation engine: preset management, profile switching, tracker generation ──

import { log, warn, err } from '../logger.js';
import {
    generating, genNonce, genMeta, lastGenSource,
    setGenerating, setCancelRequested, setGenNonce, setGenMeta,
    setCurrentSnapshotMesIdx, setLastGenSource, setLastRawResponse, setLastDeltaPayload,
    setInlineGenStartMs, setInlineExtractionDone, setPendingInlineIdx, setInlineGenerationContext,
    addSessionTokens, setLastDeltaSavings, setLastExtractionFailure
} from '../state.js';
// v6.15.6: also push the (prompt, response) pair into the ring buffer for the
// Last Response tab + Diagnostics bundle (Panel B's critical-missing add).
import { pushPair, markLastPairParseFailed } from '../raw-pairs.js';
// v6.16.0: synthetic network entry per generation, linked to its pair via
// pairId. SillyTavern's generateRaw is not a direct fetch we can wrap, so
// we synthesize the entry from the metadata we already have (latency,
// status proxy, byte counts).
import { record as recordNetwork } from '../network-log.js';
import {
    getSettings, getActiveSchema, getActivePrompt, getTrackerData,
    getLatestSnapshot, getPrevSnapshot, getActiveSwipeId, saveSnapshot, getTrustedSnapshotFor, ensureChatSaved,
    getConnectionProfiles, getChatPresets, shouldUseDelta, clearForceFullState, hasStaleSnapshotBefore, buildProfileView,
    canGenerateScene
} from '../settings.js';
import { captureOperationOwner, validateOperationOwner } from '../message-fingerprint.js';
import { customPanelSectionKey, getActiveProfile, isValidCustomFieldKey } from '../profiles.js';
import { normalizeTracker } from '../normalize.js';
import { parseTrackerCandidate, normalizeProviderResponse, recordExtractionFailure } from './extraction.js';
import { mergeDelta, preserveOffSceneEntities } from './delta-merge.js';
import { validateExtraction } from './validation.js';
import { buildRequestSchema, SECTION_FIELDS } from '../schema.js';
import { buildRecentContext, classifyRequestError, computeResponseLength, correctiveInstruction, requestTracker } from './request.js';
import { spSetGenerating, spPostGenShow } from '../ui/mobile.js';
import { updatePanel } from '../ui/update-panel.js';
import { cleanupGenUI } from '../ui/loading.js';
import { setBrandState } from '../ui/panel.js';
import { renderEmptyState } from '../ui/empty-state.js';
import { stopStreamingHider } from './streaming.js';
import { t } from '../i18n.js';

async function _changeAndWait(ctx,element,value,eventName,label){
    if(!element)return false;
    if(element.value===value)return true;
    const source=ctx.eventSource;
    if(!eventName||!source?.on||!source?.removeListener){
        element.value=value;element.dispatchEvent(new Event('change',{bubbles:true}));return element.value===value;
    }
    await new Promise((resolve,reject)=>{
        let timer=null,done=false;
        const finish=()=>{if(done)return;done=true;if(timer)clearTimeout(timer);source.removeListener(eventName,finish);resolve()};
        source.on(eventName,finish);
        try{
            timer=setTimeout(()=>{warn(label+' switch timed out; continuing with current SillyTavern state');finish()},5000);
            element.value=value;
            element.dispatchEvent(new Event('change',{bubbles:true}));
        }catch(e){source.removeListener(eventName,finish);reject(e)}
    });
    return element.value===value;
}

function _profileElement(){
    return document.querySelector('#connection_profiles, #connection_profile');
}

async function _setConnectionProfile(ctx,value,eventName,label){
    const el=_profileElement();
    if(!value)return true;
    if(el?.value===value)return true;
    if(typeof ctx.setConnectionProfile==='function'){
        await ctx.setConnectionProfile(value);
        await new Promise(resolve=>setTimeout(resolve,0));
        if(!el||el.value===value)return true;
        warn(label+' API switch did not update selector; falling back to DOM');
    }
    return await _changeAndWait(ctx,el,value,eventName,label);
}

export async function withProfileAndPreset(pid,pre,fn){
    const ctx=SillyTavern.getContext();const events=ctx.eventTypes||ctx.event_types||{};let pp=null,pr=null;
    // Save chat BEFORE switching profile — prevents message loss if switch triggers CHAT_CHANGED
    if(pid||pre)await ensureChatSaved();
    try{
        if(pid){const el=_profileElement();pp=el?.value??null;const ok=await _setConnectionProfile(ctx,pid,events.CONNECTION_PROFILE_LOADED,'Profile');if(!ok)throw new Error('Connection profile switch failed: '+pid)}
        // v6.23.7: empty preset is "(Same as current)" — leave the active preset
        // alone (no switch, no sampler mutation). Pre-v6.23.7 the empty branch
        // implicitly swapped in GLM-5 sampler values
        // (temp 0.6, top_p 0.95, etc.), which (a) made user sliders move
        // unexpectedly during fallback and (b) was inconsistent with the profile
        // dropdown's clean "(Same as current)" semantics. Users who want
        // GLM-5 samplers can now save them as an explicit preset and select it.
        if(pre){try{for(const sel of['#settings_preset_openai','#settings_preset_chat']){const el=document.querySelector(sel);if(el){const has=Array.from(el.options).some(o=>o.value===pre);if(has){pr=el.value;const ok=await _changeAndWait(ctx,el,pre,sel==='#settings_preset_openai'?events.OAI_PRESET_CHANGED_AFTER:null,'Preset');if(!ok)throw new Error('Preset switch failed: '+pre);break}}}}catch(e){warn('Preset:',e)}}
        return await fn()
    }finally{
        // Save chat BEFORE restoring profile — the generation may have saved new data
        if(pid||pre)await ensureChatSaved();
        if(pr){try{for(const sel of['#settings_preset_openai','#settings_preset_chat']){const el=document.querySelector(sel);if(el){await _changeAndWait(ctx,el,pr,sel==='#settings_preset_openai'?events.OAI_PRESET_CHANGED_AFTER:null,'Preset restore');break}}}catch(e){warn('Preset restore:',e)}}
        if(pp!==null){try{await _setConnectionProfile(ctx,pp,events.CONNECTION_PROFILE_LOADED,'Profile restore')}catch(e){warn('Profile restore:',e)}}
    }
}

// Cancel: synchronous, instant. Restores UI immediately AND aborts ST's in-flight HTTP request.
export function cancelGeneration(){
    if(!generating)return;
    const oldNonce=genNonce;
    setGenNonce(genNonce+1); // invalidate in-flight generation
    setCancelRequested(true);
    setGenerating(false);spSetGenerating(false);setBrandState('idle'); // unlock for next generation
    // Defensive reset: the inline-generation timestamp gates extraction ownership.
    // If we cancel without clearing it, a subsequent CHARACTER_MESSAGE_RENDERED from
    // ANOTHER extension (MemoryBooks memory insertion, etc.) would be misattributed
    // to our still-pending generation and extraction would run on foreign content.
    setInlineGenStartMs(0);setInlineExtractionDone(false);setPendingInlineIdx(-1);setInlineGenerationContext(null);
    // Unlock chat display immediately — streaming hider may have left
    // data-sp-has-tracker / visibility locks that collapse the bubble.
    try { stopStreamingHider({abort:true}); } catch {}
    // v6.27.18: also tear down the visible regen UI (loading overlay,
    // elapsed timer, Stop button). Previously this only fired when doGen
    // completed naturally, so a user-initiated cancel left the loading
    // overlay visible until the underlying await eventually resolved —
    // which can be never on ECONNRESET. Calling cleanupGenUI here makes
    // Stop reliably unlock the UI.
    try { cleanupGenUI(); } catch {}
    log('CANCEL: nonce',oldNonce,'\u2192',genNonce,'— generation unlocked');

    // Abort through SillyTavern's public context API, with the current stop
    // button as a compatibility fallback.
    try{
        const ctx=SillyTavern.getContext();
        let aborted=false,handled=false;
        if(typeof ctx.stopGeneration==='function'){
            handled=true;aborted=ctx.stopGeneration()!==false;
            log(aborted?'CANCEL: stopped through SillyTavern context API':'CANCEL: no active SillyTavern request to abort');
        }
        if(!handled){const stop=document.getElementById('mes_stop');if(stop){stop.click();aborted=true;log('CANCEL: clicked SillyTavern stop button')}}
        if(!aborted)log('CANCEL: SillyTavern request could not be aborted — its response will be discarded by nonce');
    }catch(e){warn('CANCEL: ST abort attempt failed:',e?.message)}

    cleanupGenUI();
    // Restore panel from latest snapshot
    const snap=getLatestSnapshot();
    const body=document.getElementById('sp-panel-body');
    if(snap){
        const norm=normalizeTracker(snap);
        updatePanel(norm);
    }else if(body)renderEmptyState();
}


export async function generateTracker(mesIdx,partKey,opts){
    if(!getSettings().enabled){log('generateTracker: extension disabled, skipping');return null}
    if(!canGenerateScene(SillyTavern.getContext(),mesIdx)){log('generateTracker: no selected chat/message to analyze, skipping');return null}
    if(generating){warn('Busy, nonce=',genNonce);return null}
    setGenerating(true);setCancelRequested(false);spSetGenerating(true);setBrandState('generating');
    const myNonce=genNonce+1;setGenNonce(myNonce);
    const genStartMs=Date.now();
    const targetSwipeId=getActiveSwipeId(mesIdx);
    const operationOwner=captureOperationOwner(mesIdx,targetSwipeId);
    const baseSnapshot=partKey?(getTrustedSnapshotFor(mesIdx,targetSwipeId)||getPrevSnapshot(mesIdx)):getPrevSnapshot(mesIdx);
    const rootSettings=getSettings();
    const settings=buildProfileView(rootSettings,getActiveProfile(rootSettings));
    const useDelta=!hasStaleSnapshotBefore(mesIdx)&&shouldUseDelta(baseSnapshot);
    clearForceFullState();
    let requestFields=partKey?(SECTION_FIELDS[partKey]||[]):[];
    if(partKey?.startsWith('custom_')){
        const panel=(settings.customPanels||[]).find(item=>customPanelSectionKey(item?.name)===partKey);
        requestFields=(Array.isArray(panel?.fields)?panel.fields:[])
            .filter(field=>field?.enabled!==false&&isValidCustomFieldKey(field?.key))
            .map(field=>field.key);
    }
    const requestMode=partKey?'section':(useDelta?'delta':'full');
    const schema=buildRequestSchema(getActiveSchema(),{mode:requestMode,fields:requestFields});
    const sysPr=getActivePrompt({ hasPrevState: !!baseSnapshot, isDelta: useDelta });
    let profileOverride=opts?.profile||settings.connectionProfile;
    let presetOverride=opts?.preset||settings.chatPreset;
    log('=== GENERATION START === mesIdx=',mesIdx,'partKey=',partKey||'(full)','nonce=',myNonce,'source=',lastGenSource||'unknown','profile=',profileOverride||'(current)');
    log('Settings: ctx=',settings.contextMessages,'retries=',settings.maxRetries,'mode=',settings.promptMode,'profile=',settings.connectionProfile||'(default)','preset=',settings.chatPreset||'(default)');
    // Resolve profile/preset name → UUID if needed (handles legacy name-based values)
    const _genProfiles=getConnectionProfiles();
    if(profileOverride&&!_genProfiles.some(p=>p.id===profileOverride)){
        const norm=profileOverride.trim().toLowerCase();
        const match=_genProfiles.find(p=>p.name.trim().toLowerCase()===norm);
        if(match){log('Generation: resolved profile:',profileOverride,'\u2192',match.id);profileOverride=match.id}
    }
    const _genPresets=getChatPresets();
    if(presetOverride&&!_genPresets.some(p=>p.id===presetOverride)){
        const norm=presetOverride.trim().toLowerCase();
        let match=_genPresets.find(p=>p.name.trim().toLowerCase()===norm);
        if(!match)match=_genPresets.find(p=>p.name.toLowerCase().includes(norm)||norm.includes(p.name.toLowerCase()));
        if(match){log('Generation: resolved preset:',presetOverride,'\u2192',match.id);presetOverride=match.id}
    }
    let terminalFailure=null;
    let successfulRequestMeta=null;
    let successfulValidationWarnings=[];
    const requestAbort=new AbortController();
    const doGen=async()=>{
        const stContext=SillyTavern.getContext();
        const{chat}=stContext;
        log('Chat length:',chat.length,'API funcs:','rawData=',!!stContext.generateRawData,'raw=',!!stContext.generateRaw,'quiet=',!!stContext.generateQuietPrompt);
        const{recent,text:ctxText}=buildRecentContext(chat,settings.contextMessages,mesIdx);
        const lastSnap=baseSnapshot;
        // Filter resolved quests from snapshot before embedding in prompt
        function _cleanSnapForPrompt(s){const c={...s};for(const k of['mainQuests','sideQuests']){if(Array.isArray(c[k]))c[k]=c[k].filter(q=>q.urgency!=='resolved')}delete c.activeTasks;delete c._spMeta;if(settings.panels?.storyIdeas===false)delete c.plotBranches;if(Array.isArray(c.charactersPresent)){const ps=new Set(c.charactersPresent.map(n=>(n||'').toLowerCase().trim()));if(Array.isArray(c.characters)){const present=c.characters.filter(ch=>ps.has((ch.name||'').toLowerCase().trim()));const offScene=c.characters.filter(ch=>!ps.has((ch.name||'').toLowerCase().trim())).map(ch=>({name:ch.name,role:ch.role||'',aliases:ch.aliases||[]}));c.characters=present;if(offScene.length)c._offSceneCharacters=offScene}if(Array.isArray(c.relationships))c.relationships=c.relationships.filter(r=>ps.has((r.name||'').toLowerCase().trim()))}return c}
        let snapCtx='';
        if(lastSnap){
            const hasEmptyChars=!lastSnap.characters||!lastSnap.characters.length;
            snapCtx=`\n\nPREVIOUS STATE (carry forward unchanged facts; update only what the recent narrative changed):\n${JSON.stringify(_cleanSnapForPrompt(lastSnap),null,2)}`;
            snapCtx+=settings.panels?.quests!==false?`\n\nIMPORTANT: Quest Journal must be from {{user}}'s perspective. If {{char}} is hostile, {{user}}'s quests OPPOSE {{char}}'s goals. If {{char}} is an ally, {{user}}'s quests SUPPORT them \u2014 but framed as {{user}}'s action. NEVER write what {{char}} is doing \u2014 write what {{user}} is doing about it. NEVER drop unresolved quests.`:`\n\nIMPORTANT: Carry forward unchanged details. Only update what changed in the story.`;
            if(hasEmptyChars){
                snapCtx+=`\n\nWARNING: The previous state has EMPTY characters. This is a bug \u2014 you MUST generate full character details for ALL characters present in the scene.`;
                log('Previous state has empty characters \u2014 added generation warning');
            }
        }
        log('Gen context: msgs=',recent.length,'snapshotCopies=',lastSnap?1:0,'snapCtxLen~',snapCtx.length);
        let prompt=`RECENT SCENE CONTEXT:\n${ctxText}${snapCtx}\n\nGenerate the updated ScenePulse tracker as one JSON object.`;
        if(partKey)prompt+=`\n\nFOCUS: Return ONLY these requested fields: ${requestFields.join(', ')}. Do not copy unrelated fields.`;
        let lastErrorCode='';let validationErrors=[];let attemptPromptMode=settings.promptMode==='native'?'native':'json';
        let totalPromptTokens=0,totalCompletionTokens=0;
        for(let a=0;a<=settings.maxRetries;a++){
            let raw;let rawStr='';let finishReason='';let strategy='';
            const responseLength=computeResponseLength({mode:requestMode,previousSnapshot:lastSnap,attempt:a,lastErrorCode});
            const attemptPrompt=a?`${prompt}\n\nCORRECTION AFTER ATTEMPT ${a}: ${correctiveInstruction(lastErrorCode,validationErrors)}`:prompt;
            totalPromptTokens+=Math.round((sysPr.length+attemptPrompt.length)/4);
            // Nonce check at every opportunity — if cancelled, bail immediately
            if(myNonce!==genNonce){log('STALE nonce',myNonce,'(current',genNonce+') \u2014 discarding silently');return null}
            try{if(a>0){log(`Retry ${a}/${settings.maxRetries}`);await new Promise(r=>setTimeout(r,1000*a));if(myNonce!==genNonce){log('Retry cancelled during backoff');return null}}
                log('Attempt',a+1,': mode=',attemptPromptMode,'outputBudget=',responseLength,'nonce=',myNonce);
                let quietError=null;
                try{
                    const response=await requestTracker({stContext,systemPrompt:sysPr,prompt:attemptPrompt,responseLength,jsonSchema:schema,promptMode:attemptPromptMode,signal:requestAbort.signal,skipWIAN:true});
                    raw=response.value;strategy=response.strategy;
                }catch(e){quietError=e}
                if(quietError){
                    if(myNonce!==genNonce){log('STALE after request error, nonce',myNonce);return null}
                    const info=classifyRequestError(quietError);
                    warn('API error:',info.message);
                    terminalFailure=recordExtractionFailure('API_ERROR',info.message,'',mesIdx,{stage:'provider',retryable:info.retryable,owner:operationOwner,attempt:a+1,strategy,responseLength});
                    if(!info.retryable){
                        if(info.kind!=='cancelled')toastr.error(info.kind==='rate_limit'?'Rate limited — try again later':'API Error: '+info.message.substring(0,100),'Generation stopped');
                        return null;
                    }
                    if(attemptPromptMode==='native'&&info.kind==='provider'){attemptPromptMode='json';warn('Native structured request failed; retrying in JSON-only mode')}
                    if(a<settings.maxRetries)await new Promise(resolve=>setTimeout(resolve,Math.min(4000,500*Math.pow(2,a))));
                    continue;
                }
                // Check nonce AFTER API returns — this is the critical discard point
                if(myNonce!==genNonce){log('STALE after API return, nonce',myNonce,'(current',genNonce+') \u2014 discarding response');return null}
                const provider=normalizeProviderResponse(raw);rawStr=provider.text;finishReason=provider.finishReason;
                if(!rawStr||rawStr.trim()==='{}'){
                    lastErrorCode='NO_JSON_OBJECT';
                    if(attemptPromptMode==='native'){attemptPromptMode='json';warn('Native structured output was empty; retrying in JSON-only mode')}
                    terminalFailure=recordExtractionFailure(lastErrorCode,'Provider returned an empty response',rawStr,mesIdx,{stage:'provider',finishReason,owner:operationOwner,attempt:a+1,strategy,responseLength});continue
                }
                const finishLow=finishReason.toLowerCase();
                const responseTruncated=['length','max_tokens','max_output_tokens','token_limit'].includes(finishLow);
                if(responseTruncated)lastErrorCode='TRUNCATED';
                const rawLen=rawStr.length;
                totalCompletionTokens+=Math.round(rawLen/4);
                setLastRawResponse(rawStr); // store for debug copy
                // v6.15.6: also capture the pair for the inspector's pair browser.
                // v6.16.0: synthesize a network log entry linked to the pair via id.
                let _capturedPair = null;
                try { _capturedPair = pushPair({ prompt:attemptPrompt, response: rawStr, mesIdx, chatKey:operationOwner.chatKey, source: 'engine' }); } catch {}
                try {
                    recordNetwork({
                        label: 'generate',
                        method: 'POST',
                        url: '(SillyTavern generate)',
                        status: 200, // we got a response; HTTP-level errors short-circuit earlier
                        latencyMs: (Date.now() - genStartMs),
                        reqBytes: attemptPrompt.length,
                        respBytes: rawStr.length,
                        pairId: _capturedPair?.id || null,
                    });
                } catch {}
                // ── Check if response body IS an error message ──
                const rawLow=rawStr.substring(0,500).toLowerCase();
                if(rawLow.includes('"error"')||rawLow.includes('rate limit')||rawLow.includes('unauthorized')||rawLow.includes('forbidden')){
                    try{
                        const errObj=JSON.parse(rawStr);
                        if(errObj.error){
                            const errMsg=typeof errObj.error==='string'?errObj.error:(errObj.error.message||JSON.stringify(errObj.error));
                            err('API returned error object:',errMsg);
                            terminalFailure=recordExtractionFailure('API_ERROR',errMsg,rawStr,mesIdx,{stage:'provider',finishReason,owner:operationOwner});
                            toastr.error(t('API Error: {error}',{error:errMsg.substring(0,100)}),t('Generation stopped'));
                            return null;
                        }
                    }catch{}// Not JSON error, continue normally
                }
                log('Got response, length:',rawLen,'chars, nonce=',myNonce);
                log('Response preview:',rawStr.substring(0,200)+'\u2026');
                const meta=genMeta;
                meta.promptTokens=totalPromptTokens;
                meta.completionTokens=totalCompletionTokens;
                meta.elapsed=((Date.now()-genStartMs)/1000);
                setGenMeta(meta);
                if(responseTruncated){const cut=new Error('Provider stopped at its output token limit');cut.code='TRUNCATED';throw cut}
                const parsed=parseTrackerCandidate(rawStr,{mode:requestMode,knownKeys:Object.keys(schema.value.properties||{})});
                if(!Object.hasOwn(schema.value.properties||{},'plotBranches'))delete parsed.plotBranches;
                const validation=validateExtraction(parsed,{schema:schema.value});
                if(!validation.valid){
                    lastErrorCode='SEMANTIC_INVALID';validationErrors=validation.errors;
                    terminalFailure=recordExtractionFailure(lastErrorCode,'Tracker JSON failed schema validation',rawStr,mesIdx,{stage:'validate',finishReason,owner:operationOwner,attempt:a+1,strategy,responseLength,validationErrors});
                    try{markLastPairParseFailed(validation.errors.join('; '))}catch{}
                    continue;
                }
                successfulValidationWarnings=validation.warnings;
                addSessionTokens(meta.promptTokens+meta.completionTokens);
                successfulRequestMeta={strategy,responseLength,attempt:a+1,promptMode:attemptPromptMode};
                // Delta merge: combine delta response with previous snapshot.
                // v6.8.50: use the shared shouldUseDelta() helper which
                // respects the periodic full-state refresh counter. When the
                // counter exceeds the threshold, shouldUseDelta() returns
                // false and the interceptor would have already sent a full-
                // state prompt, so the parsed response is a complete snapshot
                // — we should NOT merge it, just use it as-is.
                if(useDelta && lastSnap){
                    log('Delta mode: merging',Object.keys(parsed).length,'delta keys with previous');
                    setLastDeltaPayload(parsed);
                    // Estimate delta savings: compare output tokens to typical full output
                    const fullEstimate=Math.round(JSON.stringify(lastSnap).length/4);
                    if(fullEstimate>0){const savings=Math.max(0,Math.round((1-(meta.completionTokens/fullEstimate))*100));setLastDeltaSavings(savings)}
                    return mergeDelta(lastSnap, parsed);
                }
                setLastDeltaPayload(null);
                setLastDeltaSavings(0);
                log('Parsed JSON keys:',Object.keys(parsed).join(', '));
                // Full-state mode: preserve off-scene characters/relationships
                // from the previous snapshot. The LLM only returns characters
                // in the current scene, but we must keep accumulated data for
                // characters who left (for wiki, returning-character support).
                preserveOffSceneEntities(parsed,lastSnap);
                return parsed;
            }catch(e){lastErrorCode=e?.code||'MALFORMED_JSON';err(`Parse fail (${a+1}):`,e?.message||String(e));terminalFailure=recordExtractionFailure(lastErrorCode,e?.message||String(e),rawStr,mesIdx,{stage:'parse',finishReason,owner:operationOwner,attempt:a+1,strategy,responseLength});try { markLastPairParseFailed(e?.message || String(e)); } catch {}}
        }
        warn('All',settings.maxRetries+1,'attempts exhausted, returning null');
        toastr.error(t('All retry attempts failed — open the Debug Inspector for details'),t('Generation failed'));
        return null;
    };
    let result;
    // v6.27.18: cap the entire doGen run at 180s. SillyTavern's
    // generateQuietPrompt / generateRaw awaits sometimes never settle
    // when the upstream provider drops the connection (ECONNRESET on
    // NanoGPT under load was the user-reported case) — ST shows its
    // own API-error toast but the promise neither resolves nor rejects.
    // 180s is generous (Claude Opus 4.7 effort=high tops out around 90-
    // 120s on complex prompts) while still catching hung connections.
    // On timeout the catch below logs and result stays undefined; the
    // cleanup at line 432 then runs normally and the UI unlocks.
    const ENGINE_TIMEOUT_MS = 180000;
    let engineTimeoutId=null;
    try{
        result = await Promise.race([
            withProfileAndPreset(profileOverride,presetOverride,doGen),
            new Promise((_, reject) => {engineTimeoutId=setTimeout(()=>{
                const timeoutError=new Error('TIMEOUT: tracker generation exceeded '+(ENGINE_TIMEOUT_MS/1000)+'s with no completion (network drop or upstream hang?)');
                requestAbort.abort(timeoutError);reject(timeoutError);
            },ENGINE_TIMEOUT_MS)}),
        ]);
    }
    catch(e){
        err('Gen:',e);
        terminalFailure=recordExtractionFailure('API_ERROR',e?.message||String(e),'',mesIdx,{stage:'provider',retryable:true,owner:operationOwner});
        if (e?.message?.startsWith('TIMEOUT')) {
            try { toastr.warning(e.message + ' UI unlocked.', 'ScenePulse'); } catch {}
        }
    }finally{if(engineTimeoutId)clearTimeout(engineTimeoutId)}
    // Only the CURRENT generation is allowed to touch state
    if(myNonce!==genNonce){
        log('POST-GEN: stale nonce',myNonce,'(current',genNonce+') \u2014 result discarded, state untouched');
        return null; // Don't reset generating — the newer cancel/gen already did
    }
    if(getActiveSwipeId(mesIdx)!==targetSwipeId){
        log('POST-GEN: active swipe changed for message',mesIdx,'— result discarded');
        setGenerating(false);spSetGenerating(false);setCancelRequested(false);cleanupGenUI();setBrandState('idle');
        return null;
    }
    const ownerCheck=validateOperationOwner(operationOwner,{requireSource:true});
    if(!ownerCheck.valid){
        log('POST-GEN: owner changed for message',mesIdx,'— result discarded:',ownerCheck.code);
        setGenerating(false);spSetGenerating(false);setCancelRequested(false);cleanupGenUI();setBrandState('idle');
        try{toastr.info(t('Chat changed while ScenePulse was working. Run the tracker again.'),'ScenePulse')}catch{}
        return null;
    }
    setGenerating(false);spSetGenerating(false);setCancelRequested(false);cleanupGenUI();setBrandState(result?'idle':'error');
    if(result){
        terminalFailure=null;
        setLastExtractionFailure(null);
        log('Raw output keys:',Object.keys(result).join(', '));
        log('Raw characters?',Array.isArray(result.characters)?'array('+result.characters.length+')':typeof result.characters);
        log('Raw relationships?',Array.isArray(result.relationships)?'array('+result.relationships.length+')':typeof result.relationships);
        result=normalizeTracker(result);
        // ── SECTION MERGE: Only accept fields belonging to the requested section ──
        if(partKey){
            const allowedFields=SECTION_FIELDS[partKey];
            if(allowedFields||partKey.startsWith('custom_')){
                const existingSnap=getTrustedSnapshotFor(mesIdx)||getLatestSnapshot();
                if(existingSnap){
                    const merged=normalizeTracker(existingSnap);
                    if(allowedFields){
                        const _entityArrays={characters:'name',relationships:'name',mainQuests:'name',sideQuests:'name'};
                        for(const f of allowedFields){
                            if(result[f]===undefined)continue;
                            // Entity arrays: merge per-entity to preserve entries
                            // not in the new response (e.g. off-scene characters)
                            if(_entityArrays[f]&&Array.isArray(result[f])&&Array.isArray(merged[f])){
                                const keyField=_entityArrays[f];
                                // Update/add entities from result
                                for(const newE of result[f]){
                                    const nk=(newE[keyField]||'').toLowerCase().trim();
                                    const existIdx=merged[f].findIndex(e=>(e[keyField]||'').toLowerCase().trim()===nk);
                                    if(existIdx>=0)merged[f][existIdx]=newE;
                                    else merged[f].push(newE);
                                }
                                log('Section merge: entity-merged',f,'(',result[f].length,'new,',merged[f].length,'total)');
                            }else{
                                merged[f]=result[f];
                            }
                        }
                        log('Section merge: partKey=',partKey,'accepted fields:',allowedFields.join(','));
                    } else {
                        // Custom panel — accept only its field keys
                        const s=getSettings();
                        const cp=(s.customPanels||[]).find(c=>customPanelSectionKey(c?.name)===partKey);
                        if(Array.isArray(cp?.fields)){
                            const cpFields=cp.fields.filter(f=>isValidCustomFieldKey(f?.key)).map(f=>f.key);
                            for(const f of cpFields){if(result[f]!==undefined)merged[f]=result[f]}
                            log('Section merge (custom): partKey=',partKey,'accepted fields:',cpFields.join(','));
                        }
                    }
                    result=merged;
                }
            }
        }
        if(successfulValidationWarnings.length)result._validationWarnings=successfulValidationWarnings;
        log('=== POST-NORMALIZE SUMMARY === source=',lastGenSource);
        log('  chars:',result.characters?.length||0,'rels:',result.relationships?.length||0);
        log('  quests: main=',result.mainQuests?.length||0,'side=',result.sideQuests?.length||0);
        log('  northStar:',result.northStar?'"'+result.northStar.substring(0,60)+'"':'(empty)');
        log('  scene:',result.sceneTopic?'topic=\u2713':'topic=\u2717',result.sceneMood?'mood=\u2713':'mood=\u2717',result.sceneTension?'tension=\u2713':'tension=\u2717');
        if(result.characters?.length){for(const ch of result.characters)log('  char:',ch.name,'role=',ch.role?'\u2713':'\u2717','thought=',ch.innerThought?'\u2713':'\u2717','hair=',ch.hair?'\u2713':'\u2717')}
        if(result.relationships?.length){for(const r of result.relationships)log('  rel:',r.name,'aff=',r.affection,'trust=',r.trust,'desire=',r.desire,'compat=',r.compatibility)}
        setCurrentSnapshotMesIdx(mesIdx);
        // Embed generation metadata into snapshot for persistence
        // v6.8.50: deltaTurnsSinceFull tracks how many consecutive delta
        // turns have elapsed since the last full-state generation. When
        // this turn was delta, increment; when it was full, reset to 0.
        // The shouldUseDelta() helper reads this counter from the
        // previous snapshot to decide whether the NEXT turn should be
        // delta or forced-full.
        const _wasDelta = useDelta;
        const _prevCounter = (baseSnapshot?._spMeta?.deltaTurnsSinceFull ?? 0);
        result._spMeta={promptTokens:genMeta.promptTokens,completionTokens:genMeta.completionTokens,elapsed:genMeta.elapsed,source:lastGenSource,injectionMethod:getSettings().injectionMethod||'inline',deltaMode:_wasDelta,deltaTurnsSinceFull:_wasDelta?_prevCounter+1:0};
        if(successfulRequestMeta)result._spMeta.request=successfulRequestMeta;
        // v6.9.8: first-run success confirmation — if this is the very
        // first snapshot in the chat, show a welcome toast so the user
        // knows ScenePulse is working.
        const _isFirstSnap = Object.keys(getTrackerData().snapshots || {}).length === 0;
        saveSnapshot(mesIdx,result,targetSwipeId);log('Snapshot saved for mesIdx=',mesIdx,'swipe=',targetSwipeId,'keys=',Object.keys(result).length,'elapsed=',genMeta.elapsed.toFixed(1)+'s','~tokens:',genMeta.promptTokens+genMeta.completionTokens);
        if (_isFirstSnap) {
            const _charCount = (result.characters || []).length;
            toastr.success(
                `Scene tracked: ${_charCount} character${_charCount !== 1 ? 's' : ''} detected. The panel is live.`,
                'ScenePulse Active'
            );
        }
        updatePanel(result);
        spPostGenShow(); // mobile: banner instead of panel popup
    }else{
        // Keep the last trusted scene visible; the recovery card is additive.
        const body=document.getElementById('sp-panel-body');
        const previous=getPrevSnapshot(mesIdx)||getLatestSnapshot();
        if(previous){try{updatePanel(normalizeTracker(previous))}catch{}}
        if(body&&!terminalFailure)body.innerHTML='<div class="sp-error"><div style="font-weight:700;margin-bottom:4px">Generation Failed</div><div style="font-size:10px">Network timeout or API issue. Try \u27f3 Regen or check debug log.</div></div>';
        if(terminalFailure){try{const{showJsonRecovery}=await import('../ui/json-recovery.js');showJsonRecovery({mesIdx,failure:terminalFailure,stripInline:false,onRetry:async()=>{setLastGenSource('manual:recovery');await generateTracker(mesIdx,partKey,opts)}})}catch(e){warn('Recovery UI:',e?.message)}}
        warn('Generation returned null for',mesIdx);
    }
    return result;
}

// ── Continuation re-prompt — cheap recovery for tracker omission ──
//
// When the model emits a normal narrative response but forgets to append the tracker block
// (the "no SP markers" failure mode), the previous behavior was to fire a full separate
// generateTracker() call: ~6000 prompt tokens, ~1500 output tokens, ~40s latency, and the
// generated tracker is re-derived from message context (which can drift from what the user
// just read).
//
// This continuation path is much cheaper:
//   - Prompt: just the narrative the model produced + a "write the tracker JSON for this"
//     instruction. ~600-2500 input tokens depending on narrative length.
//   - Output: tracker JSON only. ~1000 tokens.
//   - Latency: ~10-15s.
//   - The tracker is generated from the *exact narrative the user is looking at*, so it
//     stays in sync.
//
// Returns parsed tracker object (with delta merge applied if delta mode is on), or null
// if the continuation also fails. Caller should fall back to generateTracker() on null.
//
// IMPORTANT: this function deliberately does NOT call saveSnapshot/updatePanel/normalize.
// It returns raw parsed JSON; the caller is responsible for running it through the normal
// processExtraction pipeline so the result is saved/normalized/displayed identically to
// every other extraction.
export async function continuationReprompt(narrativeText, opts){
    if(!getSettings().enabled){log('continuationReprompt: extension disabled, skipping');return null}
    if(generating){warn('continuationReprompt: busy, nonce=',genNonce);return null}
    setGenerating(true);setCancelRequested(false);spSetGenerating(true);setBrandState('generating');
    const myNonce=genNonce+1;setGenNonce(myNonce);
    const startMs=Date.now();
    const mesIdx=Number(opts?.mesIdx);
    const operationOwner=opts?.owner||captureOperationOwner(mesIdx,opts?.swipeId);
    const rootSettings=getSettings();
    const settings=buildProfileView(rootSettings,getActiveProfile(rootSettings));
    const profileOverride=opts?.profile||settings.connectionProfile;
    const presetOverride=opts?.preset||settings.chatPreset;
    log('=== CONTINUATION START === narrativeLen=',narrativeText.length,'nonce=',myNonce,'source=',lastGenSource||'auto:together:continuation','profile=',profileOverride||'(current)');
    // Build the continuation prompt — just the narrative + a focused JSON-only instruction.
    // We deliberately do NOT inject the full schema again; the model already saw it on
    // the original turn. Asking only for the missing piece is what makes this cheap.
    const lastSnap=Object.hasOwn(opts||{},'baseSnapshot')?opts.baseSnapshot:(opts?.mesIdx!=null?getPrevSnapshot(opts.mesIdx):getLatestSnapshot());
    const isDelta=!hasStaleSnapshotBefore(opts?.mesIdx??SillyTavern.getContext().chat?.length)&&shouldUseDelta(lastSnap)&&!!lastSnap;
    const sysPr=getActivePrompt({hasPrevState:!!lastSnap,isDelta});
    const continuationMode=isDelta?'delta':'full';
    const continuationSchema=buildRequestSchema(getActiveSchema(),{mode:continuationMode});
    const continuationAbort=new AbortController();
    let prevState='';
    if(lastSnap){
        const _cleanSnap=(s)=>{const c={...s};for(const k of['mainQuests','sideQuests']){if(Array.isArray(c[k]))c[k]=c[k].filter(q=>q.urgency!=='resolved')}delete c.activeTasks;delete c._spMeta;if(settings.panels?.storyIdeas===false)delete c.plotBranches;if(Array.isArray(c.charactersPresent)){const ps=new Set(c.charactersPresent.map(n=>(n||'').toLowerCase().trim()));if(Array.isArray(c.characters)){const present=c.characters.filter(ch=>ps.has((ch.name||'').toLowerCase().trim()));const offScene=c.characters.filter(ch=>!ps.has((ch.name||'').toLowerCase().trim())).map(ch=>({name:ch.name,role:ch.role||'',aliases:ch.aliases||[]}));c.characters=present;if(offScene.length)c._offSceneCharacters=offScene}if(Array.isArray(c.relationships))c.relationships=c.relationships.filter(r=>ps.has((r.name||'').toLowerCase().trim()))}return c};
        prevState=`\n\nPREVIOUS STATE (carry forward unchanged details, update only what changed):\n${JSON.stringify(_cleanSnap(lastSnap),null,2)}`;
    }
    // v6.9.1: use the shared shouldUseDelta() helper to respect the
    // periodic refresh counter and the forceFullNextTurn flag.
    const deltaAlways=settings.panels?.storyIdeas===false?'time, date, elapsed, charactersPresent, and witnesses':'time, date, elapsed, plotBranches, charactersPresent, and witnesses';
    const deltaInstruction=isDelta
        ?`\n\nDELTA MODE: Include ONLY fields that changed since the previous state. Always include ${deltaAlways}. Include a full character entry for every present NPC and recompute innerThought and immediateNeed from this narrative. Use [] when nobody is present or witnessed the scene. Omit other unchanged fields.`
        :'';
    const prompt=`The previous turn produced this narrative:

${narrativeText}

You forgot to append the required tracker JSON block. Output ONLY the tracker JSON for this narrative — no markers, no markdown fences, no explanation. Just a single valid JSON object describing the scene state after this narrative.${deltaInstruction}${prevState}

Output the JSON object now:`;
    log('Continuation prompt length:',prompt.length,'chars (~',Math.round(prompt.length/4),'tokens)');
    let continuationPromptTokens=0,continuationCompletionTokens=0,continuationStrategy='';
    const doGen=async()=>{
        const stContext=SillyTavern.getContext();
        if(myNonce!==genNonce){log('CONTINUATION: stale nonce',myNonce,'(current',genNonce+') — bailing');return null}
        let rawStr='';let finishReason='';
        try{
            const requestPrompt=prompt;
            const responseLength=computeResponseLength({mode:continuationMode,previousSnapshot:lastSnap});
            let promptMode=settings.promptMode==='native'?'native':'json';
            let response=await requestTracker({stContext,systemPrompt:sysPr,prompt:requestPrompt,responseLength,jsonSchema:continuationSchema,promptMode,signal:continuationAbort.signal,skipWIAN:true});
            continuationStrategy=response.strategy;
            let provider=normalizeProviderResponse(response.value);rawStr=provider.text;finishReason=provider.finishReason;
            if((!rawStr||rawStr.trim()==='{}')&&promptMode==='native'){
                if(myNonce!==genNonce){log('CONTINUATION: native retry cancelled');return null}
                promptMode='json';
                response=await requestTracker({stContext,systemPrompt:sysPr,prompt:requestPrompt+'\n\nReturn strict JSON, not prose.',responseLength,jsonSchema:continuationSchema,promptMode,signal:continuationAbort.signal,skipWIAN:true});
                continuationStrategy=response.strategy+'+json-retry';provider=normalizeProviderResponse(response.value);rawStr=provider.text;finishReason=provider.finishReason;
            }
            if(!rawStr||rawStr.trim()==='{}'){const empty=new Error('Provider returned an empty response');empty.code='NO_JSON_OBJECT';throw empty}
            if(['length','max_tokens','max_output_tokens','token_limit'].includes(finishReason.toLowerCase())){const cut=new Error('Provider stopped at its output token limit');cut.code='TRUNCATED';throw cut}
            if(myNonce!==genNonce){log('CONTINUATION: stale after API return — discarding');return null}
            const ownerCheck=validateOperationOwner(operationOwner,{requireSource:!!operationOwner.sourceFingerprint});
            if(!ownerCheck.valid){warn('Continuation: owner changed, discarding:',ownerCheck.code);return null}
            setLastRawResponse(rawStr);
            try{pushPair({prompt:requestPrompt,response:rawStr,mesIdx,chatKey:operationOwner.chatKey,source:'continuation'})}catch{}
            const parsed=parseTrackerCandidate(rawStr,{mode:continuationMode,knownKeys:Object.keys(continuationSchema.value.properties||{})});
            if(!Object.hasOwn(continuationSchema.value.properties||{},'plotBranches'))delete parsed.plotBranches;
            const validation=validateExtraction(parsed,{schema:continuationSchema.value});
            if(!validation.valid){const invalid=new Error(validation.errors.join('; '));invalid.code='SEMANTIC_INVALID';invalid.validationErrors=validation.errors;throw invalid}
            continuationPromptTokens=Math.round((sysPr.length+requestPrompt.length)/4);
            continuationCompletionTokens=Math.round(rawStr.length/4);
            return parsed;
        }catch(e){
            const requestInfo=rawStr?null:classifyRequestError(e);
            const code=requestInfo?'API_ERROR':(e?.code||'MALFORMED_JSON');
            const message=requestInfo?.message||e?.message||String(e);
            err('Continuation failed:',message);
            recordExtractionFailure(code,message,rawStr,mesIdx,{stage:requestInfo?'provider':'parse',retryable:requestInfo?.retryable,finishReason,owner:operationOwner,strategy:continuationStrategy,validationErrors:e?.validationErrors});
            try{markLastPairParseFailed(message)}catch{}
            return null;
        }
    };
    let result;
    // v6.27.18: 60s timeout. Continuation is meant to be a cheap fast-path
    // (~10-15s typical, ~30s upper bound on slow models); if it hangs past
    // 60s it's almost certainly an upstream drop, not legitimate slowness.
    // The full-separate-generation fallback at the caller will retry with
    // its own 180s budget.
    const CONTINUATION_TIMEOUT_MS = 60000;
    let continuationTimeoutId=null;
    try{
        result = await Promise.race([
            withProfileAndPreset(profileOverride,presetOverride,doGen),
            new Promise((_,reject)=>{continuationTimeoutId=setTimeout(()=>{
                const timeoutError=new Error('TIMEOUT: continuation reprompt exceeded '+(CONTINUATION_TIMEOUT_MS/1000)+'s');
                continuationAbort.abort(timeoutError);reject(timeoutError);
            },CONTINUATION_TIMEOUT_MS)}),
        ]);
    }
    catch(e){err('Continuation:',e)}finally{if(continuationTimeoutId)clearTimeout(continuationTimeoutId)}
    if(myNonce!==genNonce){
        log('CONTINUATION POST: stale nonce',myNonce,'(current',genNonce+') — discarded');
        return null;
    }
    setGenerating(false);spSetGenerating(false);setCancelRequested(false);cleanupGenUI();setBrandState(result?'idle':'error');
    const elapsed=((Date.now()-startMs)/1000);
    if(result){
        log('=== CONTINUATION SUCCESS === elapsed=',elapsed.toFixed(1)+'s','keys=',Object.keys(result).length);
        // Stash meta for the caller to forward into processExtraction
        result._spContinuationMeta={promptTokens:continuationPromptTokens,completionTokens:continuationCompletionTokens,elapsed,strategy:continuationStrategy};
    }else{
        log('=== CONTINUATION FAILED === elapsed=',elapsed.toFixed(1)+'s — caller should fall back to full separate generation');
    }
    return result;
}
