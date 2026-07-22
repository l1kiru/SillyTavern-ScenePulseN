// ScenePulse snapshot provenance.
// A snapshot belongs to the exact active chat branch that produced it, not
// merely to a numeric message/swipe slot.  The hash is a consistency token,
// not a security boundary, so two independent 32-bit passes are sufficient
// and keep every caller synchronous.

export const FINGERPRINT_VERSION = 2;

function _hash32(text, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function _part(value) {
    const s = String(value ?? '');
    return s.length + ':' + s;
}

function _swipeText(message, swipeId) {
    if (!message) return '';
    const active = Math.max(0, Number(message.swipe_id ?? 0) || 0);
    const requested = Math.max(0, Number(swipeId ?? active) || 0);
    if (requested !== active && Array.isArray(message.swipes) && message.swipes[requested] != null) {
        return String(message.swipes[requested]);
    }
    return String(message.mes ?? '');
}

export function messageFingerprintPayload(message, swipeId) {
    const active = Math.max(0, Number(message?.swipe_id ?? 0) || 0);
    const selected = Math.max(0, Number(swipeId ?? active) || 0);
    return [
        message?.is_user ? 'user' : (message?.is_system ? 'system' : 'assistant'),
        message?.name ?? '',
        selected,
        _swipeText(message, selected),
    ].map(_part).join('|');
}

function _step(previous,index,payload){
    const input=_part(previous)+'|'+_part(index)+'|'+payload;
    const a=_hash32(input,2166136261).toString(16).padStart(8,'0');
    const b=_hash32(input,2246822507).toString(16).padStart(8,'0');
    return a+b;
}

export function buildActiveFingerprintIndex(chat){
    const out=new Map();
    if(!Array.isArray(chat))return out;
    let previous='sp-fp-v'+FINGERPRINT_VERSION;
    for(let i=0;i<chat.length;i++){
        previous=_step(previous,i,messageFingerprintPayload(chat[i],chat[i]?.swipe_id));
        out.set(i,previous);
    }
    return out;
}

export function fingerprintChat(chat, endIdx, targetSwipeId) {
    if (!Array.isArray(chat) || endIdx < 0) return '';
    const last = Math.min(Math.floor(Number(endIdx)), chat.length - 1);
    const index=buildActiveFingerprintIndex(chat);
    const message=chat[last];
    const active=Math.max(0,Number(message?.swipe_id??0)||0);
    const requested=Math.max(0,Number(targetSwipeId??active)||0);
    if(requested===active)return index.get(last)||'';
    const previous=last>0?(index.get(last-1)||''):'sp-fp-v'+FINGERPRINT_VERSION;
    return _step(previous,last,messageFingerprintPayload(message,requested));
}

export function captureOperationOwner(targetMessageId,swipeId){
    const id=Number(targetMessageId);const ctx=SillyTavern.getContext();
    const exists=Array.isArray(ctx.chat)&&!!ctx.chat[id];
    const selected=exists?Math.max(0,Number(swipeId??ctx.chat[id]?.swipe_id??0)||0):Math.max(0,Number(swipeId)||0);
    return{
        chatKey:currentChatKey(),targetMessageId:id,swipeId:selected,
        parentFingerprint:currentChatFingerprint(id-1),
        sourceFingerprint:exists?currentChatFingerprint(id,selected):''
    };
}

export function validateOperationOwner(owner,{requireSource=false}={}){
    if(!owner||currentChatKey()!==owner.chatKey)return{valid:false,code:'CHAT_CHANGED'};
    const ctx=SillyTavern.getContext();const msg=ctx.chat?.[owner.targetMessageId];
    if(currentChatFingerprint(owner.targetMessageId-1)!==owner.parentFingerprint)return{valid:false,code:'PARENT_CHANGED'};
    if(!msg)return{valid:false,code:'TARGET_MISSING'};
    if(Math.max(0,Number(msg.swipe_id??0)||0)!==owner.swipeId)return{valid:false,code:'SWIPE_CHANGED'};
    if((requireSource||owner.sourceFingerprint)&&currentChatFingerprint(owner.targetMessageId,owner.swipeId)!==owner.sourceFingerprint)return{valid:false,code:'SOURCE_CHANGED'};
    return{valid:true,code:'CURRENT'};
}

export function currentChatFingerprint(messageId, swipeId) {
    try {
        return fingerprintChat(SillyTavern.getContext().chat, Number(messageId), swipeId);
    } catch {
        return '';
    }
}

export function currentChatKey() {
    try {
        const ctx = SillyTavern.getContext();
        return [
            ctx.groupId ?? '',
            ctx.characterId ?? ctx.character_id ?? ctx.name2 ?? '',
            ctx.chatId ?? ctx.chat_id ?? ctx.chat?.[0]?.send_date ?? '',
        ].map(_part).join('|');
    } catch {
        return '';
    }
}
