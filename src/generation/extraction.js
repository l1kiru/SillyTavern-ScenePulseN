// ── extraction.js — Inline/Together Mode: Extract tracker JSON from AI response ──

import { log, warn, err } from '../logger.js';
import { ensureChatSaved, shouldUseDelta } from '../settings.js';
import { jsonrepair } from '../vendor/jsonrepair.mjs';
import { setLastExtractionFailure } from '../state.js';
import { currentChatFingerprint, currentChatKey, captureOperationOwner } from '../message-fingerprint.js';

export const SP_MARKER_START='<!--SP_TRACKER_START-->';
export const SP_MARKER_END='<!--SP_TRACKER_END-->';
export const KNOWN_KEYS=['time','date','elapsed','location','weather','temperature','soundEnvironment','sceneTopic','sceneMood','sceneInteraction','sceneTension','sceneSummary','witnesses','charactersPresent','characters','relationships','northStar','plotBranches','mainQuests','sideQuests'];

function _codedError(code,message){const e=new Error(message);e.code=code;return e}

export function recordExtractionFailure(code,message,rawCandidate,mesIdx,opts={}){
    let swipeId=0;
    try{swipeId=Math.max(0,Number(SillyTavern.getContext().chat?.[mesIdx]?.swipe_id??0)||0)}catch{}
    const failure={
        code,message,retryable:opts.retryable??code!=='UNKNOWN_SCHEMA',mesIdx,swipeId,
        rawCandidate:String(rawCandidate||'').slice(0,100000),
        chatKey:currentChatKey(),sourceFingerprint:currentChatFingerprint(mesIdx,swipeId),
        owner:opts.owner||captureOperationOwner(mesIdx,swipeId),stage:opts.stage||'extract',finishReason:opts.finishReason||'',
        attempt:Number(opts.attempt)||0,strategy:opts.strategy||'',responseLength:Number(opts.responseLength)||0,
        validationErrors:Array.isArray(opts.validationErrors)?opts.validationErrors.slice(0,12):[]
    };
    setLastExtractionFailure(failure);return failure;
}

export function normalizeProviderResponse(value){
    if(typeof value==='string')return{text:value,finishReason:''};
    if(!value||typeof value!=='object')return{text:String(value??''),finishReason:''};
    const finishReason=value.finish_reason??value.finishReason??value.stop_reason??value.stopReason
        ??value.choices?.[0]?.finish_reason??value.results?.[0]?.finish_reason??value.candidates?.[0]?.finishReason??'';
    if(!Array.isArray(value)&&KNOWN_KEYS.some(key=>Object.hasOwn(value,key))){
        return{text:JSON.stringify(value),finishReason:String(finishReason||'')};
    }
    let text=value.text??value.output_text??value.content??value.response
        ??value.choices?.[0]?.message?.content??value.choices?.[0]?.text
        ??value.results?.[0]?.text??value.generations?.[0]?.text??value.data?.response
        ??value.candidates?.[0]?.content?.parts??value.message?.content??value.output?.[0]?.content??'';
    if(Array.isArray(text))text=text.map(part=>typeof part==='string'?part:(part?.text??part?.content??part?.output_text??'')).join('');
    return{text:typeof text==='string'?text:JSON.stringify(text??''),finishReason:String(finishReason||'')};
}

// Extract V8/Chromium "position N" AND Firefox "line N column N" from a JSON parse error.
// Both report 1-based positions; we normalize to a 0-based offset into the original string.
function _parseErrorOffset(msg,src){
    const pmPos=msg.match(/position (\d+)/);
    if(pmPos)return Number(pmPos[1]);
    const pmCol=msg.match(/line\s+(\d+)\s+column\s+(\d+)/i);
    if(!pmCol)return 0;
    const line=Number(pmCol[1]),col=Number(pmCol[2]);
    if(line===1)return col-1;
    const lines=src.split('\n');let acc=0;
    for(let i=0;i<line-1&&i<lines.length;i++)acc+=lines[i].length+1;
    return acc+col-1;
}

// String-aware forward walk that returns the byte offset of the closing brace
// matching the opening brace at `from`. Tracks quote state so braces inside
// string literals don't count toward depth. Returns -1 if the object is
// unbalanced (missing close brace) — caller treats that as a parse error.
function _findBalancedEnd(s,from){
    let depth=0,inString=false,escape=false;
    for(let i=from;i<s.length;i++){
        const ch=s[i];
        if(escape){escape=false;continue}
        if(inString){
            if(ch==='\\')escape=true;
            else if(ch==='"')inString=false;
            continue;
        }
        if(ch==='"'){inString=true;continue}
        if(ch==='{')depth++;
        else if(ch==='}'){depth--;if(depth===0)return i}
    }
    return -1;
}

function _candidateStrings(raw){
    const source=String(raw??'').trim();
    const starts=[];let inString=false,escape=false;
    for(let i=0;i<source.length&&starts.length<96;i++){
        const ch=source[i];
        if(escape){escape=false;continue}
        if(inString){if(ch==='\\')escape=true;else if(ch==='"')inString=false;continue}
        if(ch==='"'){inString=true;continue}
        if(ch==='{')starts.push(i);
    }
    const seen=new Set();const candidates=[];const unbalancedStarts=[];
    for(const start of starts){
        const end=_findBalancedEnd(source,start);
        if(end<0){unbalancedStarts.push(start);continue}
        const key=start+':'+end;if(seen.has(key))continue;seen.add(key);
        candidates.push({text:source.slice(start,end+1),start,end});
    }
    return{source,candidates,hadOpening:starts.length>0,unbalancedStarts};
}

function _parseJsonObject(candidate){
    try{return{value:JSON.parse(candidate),repaired:false}}
    catch(strictError){
        try{return{value:JSON.parse(jsonrepair(candidate)),repaired:true}}
        catch(repairError){strictError.repairError=repairError;throw strictError}
    }
}

function _candidateScore(value,candidate,knownKeys){
    if(!value||typeof value!=='object'||Array.isArray(value))return-1;
    const keys=Object.keys(value);
    const known=knownKeys.filter(key=>Object.hasOwn(value,key)).length;
    const schemaKeys=['properties','required','$schema','@schema','$defs','definitions'].filter(key=>Object.hasOwn(value,key)).length;
    return known*10000+keys.length*100+Math.min(candidate.length,9999)-schemaKeys*5000;
}

export function cleanJson(raw,{knownKeys=KNOWN_KEYS}={}){
    const scan=_candidateStrings(raw);
    if(!scan.hadOpening){err('cleanJson: no JSON object found. First 200:',scan.source.substring(0,200));throw _codedError('NO_JSON_OBJECT','No JSON object in response')}
    let best=null;let firstError=null;
    for(const candidateInfo of scan.candidates){
        // A balanced inner object is not a complete tracker when it sits
        // inside an earlier object whose closing brace never arrived.
        if(scan.unbalancedStarts.some(start=>start<candidateInfo.start))continue;
        const candidate=candidateInfo.text;
        try{
            const parsed=_parseJsonObject(candidate);const score=_candidateScore(parsed.value,candidate,knownKeys);
            if(score>=0&&(!best||score>best.score))best={...parsed,score,candidate};
        }catch(error){if(!firstError)firstError={error,candidate}}
    }
    if(best){
        if(best.repaired)log('cleanJson: jsonrepair succeeded ('+best.candidate.length+' chars)');
        if(scan.candidates.length>1)log('cleanJson: selected tracker candidate from',scan.candidates.length,'balanced objects');
        return best.value;
    }
    if(scan.unbalancedStarts.length)throw _codedError('TRUNCATED','Tracker JSON is missing its closing brace');
    if(firstError){
        const pos=_parseErrorOffset(firstError.error.message,firstError.candidate);
        err('cleanJson: parse error at pos',pos,'context: \u2026'+firstError.candidate.substring(Math.max(0,pos-40),pos+40)+'\u2026');
        firstError.error.code='MALFORMED_JSON';throw firstError.error;
    }
    throw _codedError('MALFORMED_JSON','No parseable JSON object in response');
}

export function parseTrackerCandidate(raw,{mode,knownKeys}={}){
    const expectedKeys=Array.isArray(knownKeys)&&knownKeys.length?knownKeys:KNOWN_KEYS;
    const parsed=cleanJson(raw,{knownKeys:expectedKeys});
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw _codedError('MALFORMED_JSON','Tracker data must be a JSON object');
    const SCHEMA_META=['$schema','$id','type','properties','required','additionalProperties','definitions','$defs','description'];
    let strippedCount=0;
    for(const k of SCHEMA_META){if(k in parsed&&typeof parsed[k]!=='string'){delete parsed[k];strippedCount++}
        else if(k==='type'&&typeof parsed[k]==='string'&&parsed[k]==='object'){delete parsed[k];strippedCount++}}
    if(strippedCount)log('parseTrackerCandidate: stripped',strippedCount,'schema metadata keys');
    const keys=Object.keys(parsed);const requestMode=mode||(shouldUseDelta()?'delta':'full');
    const minKeys=requestMode==='full'?Math.max(1,Math.min(5,expectedKeys.length)):1;
    if(keys.length<minKeys)throw _codedError('TOO_SMALL','Tracker JSON contains too few fields ('+keys.length+'/'+minKeys+')');
    if(!expectedKeys.some(k=>k in parsed))throw _codedError('UNKNOWN_SCHEMA','JSON does not contain fields from the active ScenePulse schema');
    return parsed;
}

export function extractInlineTracker(mesIdx){
    try{
        setLastExtractionFailure(null);
        const ctx=SillyTavern.getContext();
        const msg=ctx.chat[mesIdx];
        if(!msg||msg.is_user)return null;
        let raw=msg.mes||'';
        // Also check ST's reasoning field (think block content)
        const reasoning=msg.extra?.reasoning||'';
        const combined=raw+(reasoning?'\n'+reasoning:'');
        // Look for SP markers in combined text (including mangled variants)
        let startIdx=combined.indexOf(SP_MARKER_START);
        let endIdx=combined.indexOf(SP_MARKER_END);
        // Check for mangled marker variants: {{//SP_TRACKER_START}}, {{SP_TRACKER_START}}, etc.
        let _mStartLen=SP_MARKER_START.length;
        if(startIdx===-1){
            const altMarkers=[['{{//SP_TRACKER_START}}','{{//SP_TRACKER_END}}'],['{{SP_TRACKER_START}}','{{SP_TRACKER_END}}'],['[SP_TRACKER_START]','[SP_TRACKER_END]'],['**SP_TRACKER_START**','**SP_TRACKER_END**']];
            for(const[s,e]of altMarkers){const si=combined.indexOf(s);const ei=combined.indexOf(e);if(si!==-1&&ei>si){startIdx=si;endIdx=ei;_mStartLen=s.length;log('extractInlineTracker: found mangled marker variant:',s);break}}
        }
        let jsonStr=null;let extractMethod='none';let foundInReasoning=false;
        if(startIdx!==-1&&endIdx>startIdx){
            jsonStr=combined.substring(startIdx+_mStartLen,endIdx).trim();
            extractMethod='SP_MARKERS';
            foundInReasoning=startIdx>=raw.length; // Was it in the reasoning part?
        } else {
            // Fallback: look for ```json blocks at the end of the message
            const jsonBlockMatch=raw.match(/```json\s*\n?([\s\S]*?)```\s*$/);
            if(jsonBlockMatch){jsonStr=jsonBlockMatch[1].trim();extractMethod='JSON_FENCE'}
            else{
                // Fallback 2: look for a raw JSON object at the end
                const lastBrace=raw.lastIndexOf('}');
                if(lastBrace!==-1){
                    let depth=0;let openIdx=-1;
                    for(let i=lastBrace;i>=0;i--){
                        if(raw[i]==='}')depth++;
                        if(raw[i]==='{')depth--;
                        if(depth===0){openIdx=i;break}
                    }
                    if(openIdx!==-1&&(lastBrace-openIdx)>200){
                        jsonStr=raw.substring(openIdx,lastBrace+1);
                        extractMethod='RAW_JSON_SCAN';
                    }
                }
                // Fallback 3: look for raw JSON with "time" key anywhere in message
                if(!jsonStr){
                    const timeMatch=raw.match(/\{"time"\s*:\s*"[^"]+"/);
                    if(timeMatch){
                        const jsonStart=timeMatch.index;
                        const remaining=raw.substring(jsonStart);
                        // Find matching closing brace
                        let d2=0;let endIdx=-1;
                        for(let i=0;i<remaining.length;i++){
                            if(remaining[i]==='{')d2++;
                            if(remaining[i]==='}')d2--;
                            if(d2===0){endIdx=i;break}
                        }
                        if(endIdx>100){
                            jsonStr=remaining.substring(0,endIdx+1);
                            extractMethod='RAW_TIME_KEY_SCAN';
                        }
                    }
                }
            }
        }
        if(!jsonStr){
            const open=startIdx!==-1?combined.substring(startIdx+_mStartLen):(raw.lastIndexOf('{')!==-1?raw.substring(raw.lastIndexOf('{')):'');
            const code=(startIdx!==-1&&endIdx<=startIdx)||(open&&_findBalancedEnd(open,open.indexOf('{'))===-1)?'TRUNCATED':'NO_TRACKER';
            const message=code==='TRUNCATED'?'Tracker JSON was cut off before completion':'AI response did not contain ScenePulse tracker data';
            recordExtractionFailure(code,message,open,mesIdx);
            log('extractInlineTracker: no tracker JSON found in message',mesIdx,'(len:',raw.length+', code:',code+')');return null
        }
        log('extractInlineTracker: found via',extractMethod,'(json:',jsonStr.length,'chars)');
        // Parse the JSON
        let parsed;
        try{parsed=parseTrackerCandidate(jsonStr)}catch(e){warn('extractInlineTracker: candidate failed:',e?.message);recordExtractionFailure(e?.code||'MALFORMED_JSON',e?.message||'Invalid tracker JSON',jsonStr,mesIdx);return null}
        // Strip the tracker block from the message
        let cleanedMsg=raw;
        if(foundInReasoning){
            // Tracker was in think/reasoning — clear reasoning, don't touch narrative
            if(msg.extra)msg.extra.reasoning='';
            log('extractInlineTracker: cleared reasoning field (tracker was in think block)');
        } else if(startIdx!==-1&&endIdx>startIdx){
            // Strip markers AND surrounding think tags if present
            let stripStart=startIdx;let stripEnd=endIdx+SP_MARKER_END.length;
            // Check for <think> wrapper before the markers
            const beforeMarker=raw.substring(Math.max(0,stripStart-30),stripStart);
            const thinkOpen=beforeMarker.lastIndexOf('<think>');
            if(thinkOpen!==-1)stripStart=stripStart-30+Math.max(0,thinkOpen); // Adjust to before <think>
            // Check for </think> after the markers
            const afterMarker=raw.substring(stripEnd,stripEnd+30);
            const thinkClose=afterMarker.indexOf('</think>');
            if(thinkClose!==-1)stripEnd=stripEnd+thinkClose+'</think>'.length;
            cleanedMsg=raw.substring(0,stripStart)+raw.substring(stripEnd);
        } else if(raw.match(/```json\s*\n?[\s\S]*?```\s*$/)){
            cleanedMsg=raw.replace(/```json\s*\n?[\s\S]*?```\s*$/,'');
        } else if(jsonStr){
            cleanedMsg=raw.substring(0,raw.indexOf(jsonStr));
        }
        // Strip echoed instruction headers that LLMs sometimes parrot back
        cleanedMsg=cleanedMsg.replace(/\[SCENE TRACKER[^\]]*\]\s*/g,'');
        cleanedMsg=cleanedMsg.replace(/MANDATORY APPENDIX[^\n]*\n?/g,'');
        cleanedMsg=cleanedMsg.replace(/<!--SP_TRACKER_(?:START|END)-->/g,'');
        // Also strip any orphaned think tags that might remain
        cleanedMsg=cleanedMsg.replace(/<think>\s*<\/think>/g,'');
        cleanedMsg=cleanedMsg.replace(/\n{3,}$/,'\n\n').trimEnd();
        // Update the message in memory
        if(cleanedMsg!==raw){
            msg.mes=cleanedMsg;
            const activeSwipe=Math.max(0,Number(msg.swipe_id??0)||0);
            if(Array.isArray(msg.swipes)&&msg.swipes[activeSwipe]!=null)msg.swipes[activeSwipe]=cleanedMsg;
            // Update DOM — find the message element and replace its content
            const mesEl=document.querySelector(`.mes[mesid="${mesIdx}"] .mes_text`);
            if(mesEl){
                // Clear streaming hider safety flag
                delete mesEl.dataset.spHasTracker;
                // Use ST's messageFormatting if available; otherwise fall back
                // to textContent. v6.27.13: previously fell back to innerHTML
                // which would render LLM-emitted HTML directly. Defense-in-
                // depth (per security review): unsanitized cleanedMsg may
                // carry attacker-controlled `<img onerror>` from prompt-
                // injected character cards. textContent neutralizes that.
                try{
                    const{messageFormatting}=SillyTavern.getContext();
                    if(typeof messageFormatting==='function'){
                        mesEl.innerHTML=messageFormatting(cleanedMsg,msg.name,msg.is_system,msg.is_user,mesIdx);
                    }else{
                        mesEl.textContent=cleanedMsg;
                    }
                }catch{mesEl.textContent=cleanedMsg}
            }
            log('extractInlineTracker: stripped tracker block from message ('+raw.length+'\u2192'+cleanedMsg.length+' chars)');
            // Save cleaned message to disk
            ensureChatSaved();
            // Safety re-check: other extensions may re-render the message with stale text
            const _stripIdx=mesIdx;const _cleanTxt=cleanedMsg;
            const _safetyRestrip=()=>{
                try{
                    const el=document.querySelector(`.mes[mesid="${_stripIdx}"] .mes_text`);
                    if(!el)return;
                    const txt=el.textContent||'';
                    if(txt.includes('SP_TRACKER_START')||txt.includes('"sceneTopic"')||txt.includes('"relationships"')){
                        log('extractInlineTracker: safety re-strip for message',_stripIdx);
                        const{messageFormatting}=SillyTavern.getContext();
                        if(typeof messageFormatting==='function')el.innerHTML=messageFormatting(_cleanTxt,'',false,false,_stripIdx);
                        else el.textContent=_cleanTxt;  // v6.27.13: defense-in-depth — see comment in primary write site above
                    }
                    // Also hide any visible think blocks that contain tracker remnants
                    el.querySelectorAll('details.thinking_block, .mes_reasoning').forEach(tb=>{
                        if(tb.textContent.includes('SP_TRACKER_START')||tb.textContent.includes('"sceneTopic"'))tb.style.display='none';
                    });
                }catch{}
            };
            setTimeout(_safetyRestrip,500);
            setTimeout(_safetyRestrip,1500);
            setTimeout(_safetyRestrip,3000);
        }
        setLastExtractionFailure(null);
        return parsed;
    }catch(e){
        warn('extractInlineTracker:',e?.message||String(e));
        recordExtractionFailure(e?.code||'MALFORMED_JSON',e?.message||String(e),'',mesIdx);
        return null;
    }
}
