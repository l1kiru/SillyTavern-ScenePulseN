// Validate untrusted LLM output before normalization or persistence.

import { log } from '../logger.js';
import { getActiveSchema } from '../settings.js';

function typeName(value){
    if(Array.isArray(value))return'array';
    if(value===null)return'null';
    return typeof value;
}

function matchesType(value,type){
    if(Array.isArray(type))return type.some(item=>matchesType(value,item));
    if(type==='integer')return typeof value==='number'&&Number.isInteger(value);
    if(type==='number')return typeof value==='number'&&Number.isFinite(value);
    return typeName(value)===type;
}

function check(value,spec,path,errors,warnings){
    if(!spec||typeof spec!=='object')return;
    const actual=typeName(value);
    if(spec.type&&!matchesType(value,spec.type)){
        errors.push(`${path}: expected ${spec.type}, got ${actual}`);return;
    }
    if(spec.enum&&!spec.enum.includes(value))errors.push(`${path}: value is not in the allowed enum`);
    if(typeof value==='number'){
        if(Number.isFinite(spec.minimum)&&value<spec.minimum)errors.push(`${path}: below minimum ${spec.minimum}`);
        if(Number.isFinite(spec.maximum)&&value>spec.maximum)errors.push(`${path}: above maximum ${spec.maximum}`);
    }
    if(typeof value==='string'&&value.trim()==='')warnings.push(`${path}: empty string`);
    if(Array.isArray(value)){
        if(Number.isFinite(spec.minItems)&&value.length<spec.minItems)errors.push(`${path}: needs at least ${spec.minItems} items`);
        if(Number.isFinite(spec.maxItems)&&value.length>spec.maxItems)errors.push(`${path}: allows at most ${spec.maxItems} items`);
        if(spec.items)for(let i=0;i<value.length;i++)check(value[i],spec.items,`${path}[${i}]`,errors,warnings);
    }
    if(actual==='object'){
        const props=spec.properties||{};
        for(const key of spec.required||[]){
            if(!Object.hasOwn(value,key)||value[key]===null||value[key]===undefined)errors.push(`${path}.${key}: missing required field`);
        }
        for(const[key,nested]of Object.entries(props))if(Object.hasOwn(value,key))check(value[key],nested,`${path}.${key}`,errors,warnings);
        if(spec.additionalProperties===false){
            for(const key of Object.keys(value))if(!Object.hasOwn(props,key))warnings.push(`${path}.${key}: field is outside the request schema`);
        }
    }
}

function normalizeOptionalTemporalIntent(data,schema,warnings){
    if(!data||typeof data!=='object'||Array.isArray(data)||!Object.hasOwn(data,'temporalIntent'))return;
    const spec=schema?.properties?.temporalIntent;
    if(!Array.isArray(spec?.enum)||(schema.required||[]).includes('temporalIntent'))return;
    const raw=data.temporalIntent;
    if(typeof raw!=='string')return;
    const compact=value=>String(value).trim().toLowerCase().replace(/[\s_-]+/g,'');
    const normalized=spec.enum.find(value=>compact(value)===compact(raw));
    if(normalized!==undefined){
        if(raw!==normalized){data.temporalIntent=normalized;warnings.push('root.temporalIntent: normalized optional value')}
        return;
    }
    delete data.temporalIntent;
    warnings.push('root.temporalIntent: ignored unsupported optional value');
}

function coerceKnownProviderShapes(data,schema,warnings){
    if(!data||typeof data!=='object'||Array.isArray(data)||!schema?.properties)return;
    const props=schema.properties;
    const hoist=(wrapperKey,keys)=>{
        const wrapper=data[wrapperKey];
        if(!wrapper||typeof wrapper!=='object'||Array.isArray(wrapper))return;
        let moved=0;
        for(const key of keys){
            if(!Object.hasOwn(props,key)||!Object.hasOwn(wrapper,key)||Object.hasOwn(data,key))continue;
            data[key]=wrapper[key];moved++;
        }
        if(moved)warnings.push(`root.${wrapperKey}: hoisted ${moved} field(s) to top level`);
    };
    hoist('questJournal',['northStar','mainQuests','sideQuests']);
    hoist('quests',['northStar','mainQuests','sideQuests']);
    hoist('environment',['elapsed','time','date','location','weather','temperature']);
    for(const key of['scene','sceneDetails','sceneInfo','sceneAnalysis']){
        hoist(key,['sceneTopic','sceneMood','sceneInteraction','sceneTension','sceneSummary','soundEnvironment','charactersPresent','witnesses']);
    }
    if(Object.hasOwn(props,'witnesses')&&!Object.hasOwn(data,'witnesses')&&Array.isArray(data.charactersPresent)){
        data.witnesses=[];
        warnings.push('root.witnesses: defaulted missing array to []');
    }
    const invSpec=props.characters?.items?.properties?.inventory;
    const relProps=props.relationships?.items?.properties;
    if(relProps&&Array.isArray(data.relationships)){
        const meterKeys=['affection','affectionLabel','trust','trustLabel','desire','desireLabel','stress','stressLabel','compatibility','compatibilityLabel'];
        for(let i=0;i<data.relationships.length;i++){
            const rel=data.relationships[i];
            const meters=rel?.meters;
            if(!rel||typeof rel!=='object'||Array.isArray(rel)||!meters||typeof meters!=='object'||Array.isArray(meters))continue;
            let moved=0;
            for(const key of meterKeys){
                if(!Object.hasOwn(relProps,key)||!Object.hasOwn(meters,key)||Object.hasOwn(rel,key))continue;
                rel[key]=meters[key];moved++;
            }
            if(moved)warnings.push(`root.relationships[${i}].meters: hoisted ${moved} field(s) to relationship`);
        }
    }
    if(!invSpec||!Array.isArray(data.characters))return;
    for(let i=0;i<data.characters.length;i++){
        const ch=data.characters[i];
        if(!ch||typeof ch!=='object'||Array.isArray(ch))continue;
        if(typeof ch.inventory==='string'){
            const item=ch.inventory.trim();
            ch.inventory=item?[item]:[];
            warnings.push(`root.characters[${i}].inventory: coerced string to array`);
        }
    }
}

/** @returns {{valid:boolean,errors:string[],warnings:string[]}} */
export function validateExtraction(data,{schema}={}){
    const errors=[];const warnings=[];
    let active=schema;
    if(!active){try{active=getActiveSchema()?.value}catch{}}
    if(active?.value)active=active.value;
    normalizeOptionalTemporalIntent(data,active,warnings);
    coerceKnownProviderShapes(data,active,warnings);
    if(!active?.properties){
        if(!data||typeof data!=='object'||Array.isArray(data))errors.push('root: expected object');
    }else check(data,active,'root',errors,warnings);
    if(errors.length||warnings.length){
        log('Schema validation:',errors.length,'errors,',warnings.length,'warnings');
        for(const message of errors)log('  ✗',message);
        for(const message of warnings)log('  ⚠',message);
    }
    return{valid:errors.length===0,errors,warnings};
}
