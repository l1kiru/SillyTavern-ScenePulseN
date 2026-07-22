// One bounded request path for separate tracker generation.

import { applyPromptRole } from '../prompts/role.js';

const MIN_OUTPUT={full:4096,delta:2048,section:2048};
const MAX_OUTPUT=8192;

export function buildRecentContext(chat,count,endIdx=Infinity){
    const end=Math.min(Array.isArray(chat)?chat.length:0,Number.isFinite(endIdx)?Math.floor(endIdx)+1:Infinity);
    const bounded=(Array.isArray(chat)?chat:[]).slice(0,end);
    const recent=bounded.slice(Math.max(0,bounded.length-Math.max(1,Number(count)||1)));
    const text=recent.map(message=>{
        const name=message?.is_user?'{{user}}':(message?.name||'{{char}}');
        return `${name}: ${String(message?.mes||'')}`;
    }).join('\n\n');
    return{recent,text};
}

export function computeResponseLength({mode='full',previousSnapshot=null,attempt=0,lastErrorCode=''}={}){
    const minimum=MIN_OUTPUT[mode]||MIN_OUTPUT.full;
    const previousTokens=previousSnapshot?Math.ceil(JSON.stringify(previousSnapshot).length/4):0;
    let budget=Math.max(minimum,Math.ceil(previousTokens*1.35+512));
    if(lastErrorCode==='TRUNCATED')budget=Math.ceil(budget*Math.pow(1.5,Math.max(1,attempt)));
    return Math.min(MAX_OUTPUT,budget);
}

export function classifyRequestError(error){
    const message=String(error?.cause?.message||error?.message||error||'');const low=message.toLowerCase();
    const status=Number(error?.status??error?.statusCode??error?.response?.status??error?.cause?.status);
    if(error?.name==='AbortError'||low.includes('cancel'))return{kind:'cancelled',retryable:false,message};
    if([401,403,404].includes(status)||/\b(401|403|404)\b/.test(low)||['authentication','unauthorized','forbidden','model not found','invalid api key','billing','quota','deactivated','permission','blocked','banned'].some(value=>low.includes(value)))return{kind:'fatal',retryable:false,message};
    if(status===429||/\b429\b/.test(low)||low.includes('rate limit')||low.includes('too many requests'))return{kind:'rate_limit',retryable:false,message};
    if([500,502,503,504].includes(status)||/\b(500|502|503|504)\b/.test(low)||['econnreset','socket','network','timeout','fetch'].some(value=>low.includes(value)))return{kind:'network',retryable:true,message};
    return{kind:'provider',retryable:true,message};
}

export function correctiveInstruction(code,errors=[]){
    if(code==='TRUNCATED')return'Your previous JSON was cut off. Return the complete object, with every opened array/object closed.';
    if(code==='NO_JSON_OBJECT'||code==='TOO_SMALL')return'Return exactly one JSON object and nothing else: no prose, analysis, markdown, or code fence.';
    if(code==='MALFORMED_JSON')return'Return the same tracker data as strict valid JSON. Escape quotes inside strings and remove comments or trailing text.';
    if(code==='SEMANTIC_INVALID')return`Correct these schema violations and return the complete corrected JSON object: ${errors.slice(0,6).join('; ')}`;
    return'Return exactly one valid ScenePulse tracker JSON object and no other text.';
}

export async function requestTracker({stContext,systemPrompt,prompt,responseLength,jsonSchema,promptMode='json',signal,skipWIAN=true}){
    const routed=applyPromptRole({systemPrompt,prompt});
    let stopped=false;
    const stop=()=>{
        if(stopped)return;stopped=true;
        try{if(typeof stContext.stopGeneration==='function')stContext.stopGeneration()}catch{}
    };
    const throwIfAborted=()=>{if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError')};
    throwIfAborted();
    signal?.addEventListener?.('abort',stop,{once:true});
    try{
        if(typeof stContext.generateQuietPrompt==='function'){
            const value=await stContext.generateQuietPrompt({
                quietPrompt:`${routed.systemPrompt?`${routed.systemPrompt}\n\n`:''}${routed.prompt}`,
                skipWIAN,responseLength,jsonSchema:promptMode==='native'?jsonSchema:undefined,
            });
            throwIfAborted();
            return{value,strategy:'quiet'};
        }
        if(typeof stContext.generateRawData==='function'){
            const value=await stContext.generateRawData({
                prompt:routed.prompt,systemPrompt:routed.systemPrompt,responseLength,
                jsonSchema:promptMode==='native'?jsonSchema:null,
            });
            throwIfAborted();
            return{value,strategy:'raw-data'};
        }
        if(typeof stContext.generateRaw==='function'){
            const value=await stContext.generateRaw({
                prompt:routed.prompt,systemPrompt:routed.systemPrompt,responseLength,
                jsonSchema:promptMode==='native'?jsonSchema:null,
            });
            throwIfAborted();
            return{value,strategy:'raw'};
        }
        throw new Error('SillyTavern exposes no supported generation API');
    }finally{
        signal?.removeEventListener?.('abort',stop);
    }
}
