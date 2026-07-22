// Shared JSON recovery card/editor for inline and separate generation paths.

import { t } from '../i18n.js';
import { esc } from '../utils.js';
import { SP_MARKER_START,SP_MARKER_END,parseTrackerCandidate } from '../generation/extraction.js';
import { processExtraction } from '../generation/pipeline.js';
import { getPrevSnapshot,ensureChatSaved } from '../settings.js';
import { setLastExtractionFailure } from '../state.js';
import { captureOperationOwner,validateOperationOwner } from '../message-fingerprint.js';

function _stripInlinePayload(mesIdx){
    const ctx=SillyTavern.getContext();const msg=ctx.chat?.[mesIdx];if(!msg)return;
    const raw=String(msg.mes||'');let cleaned=raw;const start=raw.indexOf(SP_MARKER_START);
    if(start!==-1){const end=raw.indexOf(SP_MARKER_END,start);cleaned=raw.substring(0,start)+(end===-1?'':raw.substring(end+SP_MARKER_END.length))}
    else cleaned=raw.replace(/```json\s*\n?[\s\S]*?(?:```\s*$|$)/i,'');
    cleaned=cleaned.replace(/\n{3,}$/,'\n\n').trimEnd();if(cleaned===raw)return;
    msg.mes=cleaned;const swipe=Math.max(0,Number(msg.swipe_id??0)||0);
    if(Array.isArray(msg.swipes)&&msg.swipes[swipe]!=null)msg.swipes[swipe]=cleaned;
    const el=document.querySelector(`.mes[mesid="${mesIdx}"] .mes_text`);
    if(el){try{const f=ctx.messageFormatting;el.innerHTML=typeof f==='function'?f(cleaned,msg.name,msg.is_system,msg.is_user,mesIdx):esc(cleaned)}catch{el.textContent=cleaned}}
    ensureChatSaved();
}

export function showJsonRecovery({mesIdx,failure,onRetry,stripInline=false,source='manual:json-recovery'}){
    const body=document.getElementById('sp-panel-body');if(!body)return null;
    body.querySelector('.sp-recovery-card')?.remove();
    const card=document.createElement('div');card.className='sp-recovery-card';
    const code=failure?.code||'NO_TRACKER';
    card.innerHTML=`<div class="sp-recovery-icon">⚠</div><div class="sp-recovery-title">${t('Extraction Failed')}</div><div class="sp-recovery-sub">${esc(failure?.message||t('AI did not include tracker data in message'))} <strong>${esc(code)}</strong> · #${mesIdx}.</div><div class="sp-recovery-actions"><button class="sp-btn sp-recovery-retry">${t('Retry')}</button>${failure?.rawCandidate?`<button class="sp-btn sp-recovery-edit">${t('Edit JSON')}</button>`:''}<button class="sp-btn sp-recovery-dismiss">${t('Dismiss')}</button></div>`;
    card.querySelector('.sp-recovery-retry').addEventListener('click',async()=>{card.remove();await onRetry?.()});
    card.querySelector('.sp-recovery-edit')?.addEventListener('click',()=>_openEditor({card,mesIdx,failure,stripInline,source}));
    card.querySelector('.sp-recovery-dismiss').addEventListener('click',()=>card.remove());
    body.insertBefore(card,body.firstChild);return card;
}

function _openEditor({card,mesIdx,failure,stripInline,source}){
    document.querySelector('.sp-recovery-editor-overlay')?.remove();
    const overlay=document.createElement('div');overlay.className='sp-confirm-overlay sp-recovery-editor-overlay';
    overlay.innerHTML=`<div class="sp-confirm-dialog" role="dialog" aria-modal="true"><div class="sp-confirm-title">${t('Repair ScenePulse JSON')}</div><div class="sp-confirm-msg">${t('Edit the model response, then validate it before applying.')}</div><textarea class="sp-recovery-json" rows="18" spellcheck="false" style="width:100%;box-sizing:border-box;font-family:monospace;font-size:11px"></textarea><div class="sp-recovery-validation" style="min-height:18px;margin-top:6px"></div><div class="sp-confirm-actions"><button class="sp-confirm-btn sp-recovery-cancel">${t('Cancel')}</button><button class="sp-confirm-btn sp-recovery-validate">${t('Validate')}</button><button class="sp-confirm-btn sp-recovery-apply">${t('Apply')}</button></div></div>`;
    const textarea=overlay.querySelector('.sp-recovery-json');textarea.value=failure.rawCandidate||'';
    const status=overlay.querySelector('.sp-recovery-validation');const applyBtn=overlay.querySelector('.sp-recovery-apply');let parsed=null;
    const validate=()=>{try{parsed=parseTrackerCandidate(textarea.value);status.textContent=t('JSON is valid and ready to apply.');status.style.color='var(--sp-green, #55c99a)';return true}catch(e){parsed=null;status.textContent=(e.code||'MALFORMED_JSON')+': '+e.message;status.style.color='var(--sp-red, #e06c75)';return false}};
    overlay.querySelector('.sp-recovery-validate').addEventListener('click',validate);
    overlay.querySelector('.sp-recovery-cancel').addEventListener('click',()=>overlay.remove());
    applyBtn.addEventListener('click',async()=>{
        if(applyBtn.disabled||!validate())return;
        const owner=failure.owner||captureOperationOwner(mesIdx,failure.swipeId);const check=validateOperationOwner(owner,{requireSource:!!owner.sourceFingerprint});
        if(!check.valid){status.textContent='STALE_CONTEXT: '+t('The chat changed. Reopen recovery from the current message.');status.style.color='var(--sp-red, #e06c75)';return}
        applyBtn.disabled=true;if(stripInline)_stripInlinePayload(mesIdx);
        const freshOwner=captureOperationOwner(mesIdx,failure.swipeId);
        const result=await processExtraction(mesIdx,parsed,source,{swipeId:failure.swipeId,expectedSwipeId:failure.swipeId,owner:freshOwner,baseSnapshot:getPrevSnapshot(mesIdx)});
        applyBtn.disabled=false;
        if(!result){status.textContent='STALE_CONTEXT: '+t('The result was not saved because the chat changed.');status.style.color='var(--sp-red, #e06c75)';return}
        setLastExtractionFailure(null);overlay.remove();card.remove();toastr.success(t('Scene data recovered'),'ScenePulse');
    });
    overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove()});document.body.appendChild(overlay);textarea.focus();
}
