// ScenePulse — Custom Panels Module
// Extracted from index.js lines 4969-5130

import {
    buildProfileView,
    captureTrackerStructure,
    ensureChatPanels,
    getPanelActivationStrategy,
    getLatestSnapshot,
    reconcileTrackerStructureChange,
    saveChatPanels,
    setPanelActivationStrategy,
} from '../settings.js';
import {
    customPanelScope,
    customPanelSectionKey,
    getActiveProfile,
    isBuiltInCharacterFieldKey,
    isValidCustomFieldKey,
    validateActiveCustomPanelFields,
} from '../profiles.js';
import { esc, str, clamp, spConfirm } from '../utils.js';
import { _cachedNormData } from '../state.js';
import { buildDynamicSchema, buildDynamicPrompt } from '../schema.js';
import { t } from '../i18n.js';
import { updatePanel } from '../ui/update-panel.js';
import { normalizeTracker } from '../normalize.js';
import {
    customPanelActivationKey,
    normalizePanelActivationMode,
    normalizeSceneTags,
    SCENE_TAG_REGISTRY,
} from '../panel-activation-policy.js';
import {
    CHARACTER_GENDER_OPTIONS,
    formatAudienceHint,
    normalizeAudience,
} from '../character-audience.js';

function _findSection(panelBody,key){
    if(!panelBody)return null;
    if(globalThis.CSS?.escape){
        return panelBody.querySelector(`.sp-section[data-key="${globalThis.CSS.escape(String(key))}"]`);
    }
    return Array.from(panelBody.querySelectorAll('.sp-section')).find(el=>el.dataset?.key===String(key))||null;
}

function _appendWarning(body,className,color,message){
    const warn=document.createElement('div');warn.className=className;
    warn.innerHTML=`<svg viewBox="0 0 16 16" width="11" height="11" fill="none" style="flex-shrink:0"><path d="M8 1L1 14h14L8 1z" stroke="${color}" stroke-width="1.2" fill="none"/><line x1="8" y1="6" x2="8" y2="9.5" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.8" fill="${color}"/></svg><span></span>`;
    warn.querySelector('span').textContent=String(message);
    body.appendChild(warn);
}

function _panelUiKey(panel,index=0){
    const id=String(panel?.id||'').trim();
    if(id)return `id:${id}`;
    return `legacy:${customPanelScope(panel)}:${String(panel?.name||'untitled').trim().toLowerCase()}:${index}`;
}

function _nextUniqueFieldKey(scope, rawKey, panels, reserved=new Set()){
    const used=new Set(reserved);
    for(const panel of Array.isArray(panels)?panels:[]){
        if(customPanelScope(panel)!==scope)continue;
        for(const field of Array.isArray(panel?.fields)?panel.fields:[]){
            const key=String(field?.key||'').trim().toLowerCase();
            if(key)used.add(key);
        }
    }
    const original=String(rawKey||'custom_field').trim().toLowerCase().replace(/[^a-z0-9_]/g,'_').replace(/_+/g,'_').replace(/^_+|_+$/g,'')||'custom_field';
    const stem=(original+'_copy').slice(0,58).replace(/_+$/,'')||'custom_field_copy';
    let candidate=stem,suffix=2;
    while(used.has(candidate))candidate=`${stem.slice(0,Math.max(1,63-String(suffix).length))}_${suffix++}`;
    reserved.add(candidate);
    return candidate;
}

function _makeLocalPanelCopy(panel, panels){
    const clone=structuredClone(panel||{});
    delete clone.sourceLibraryId;
    delete clone.sourceLibraryName;
    clone.id='cp_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
    const base=(String(panel?.name||'Untitled').trim()||'Untitled')+' (copy)';
    const usedNames=new Set((Array.isArray(panels)?panels:[]).map(item=>String(item?.name||'').trim().toLowerCase()));
    let name=base,suffix=2;
    while(usedNames.has(name.toLowerCase()))name=`${base} ${suffix++}`;
    clone.name=name;
    const scope=customPanelScope(clone);
    const reserved=new Set();
    clone.fields=(Array.isArray(clone.fields)?clone.fields:[]).map(field=>({
        ...field,
        key:_nextUniqueFieldKey(scope,field?.key,panels,reserved),
    }));
    return clone;
}

function _commitPanelEdit(panels,edit){
    const previous=captureTrackerStructure();
    const candidate=structuredClone(panels);
    edit(candidate);
    const validation=validateActiveCustomPanelFields(candidate);
    if(!validation.ok){
        toastr.error(t('Panel change rejected: {error}',{error:validation.errors[0]}));
        return false;
    }
    panels.splice(0,panels.length,...candidate);
    reconcileTrackerStructureChange(previous);
    saveChatPanels();
    return true;
}

// v6.9.12: refreshCustomSection mirrors the upgraded rendering from
// update-panel.js so live-refresh during panel editing shows the same
// visual treatment (threshold meters, enum pills, list chips, etc.)
export function refreshCustomSection(cp,panelBody){
    if(!panelBody||!cp?.name||customPanelScope(cp)!=='global')return;
    const cpKey=customPanelSectionKey(cp.name);
    const existing=_findSection(panelBody,cpKey);
    if(!existing)return;
    const content=existing.querySelector('.sp-section-content');
    if(!content)return;
    const d=_cachedNormData||{};
    content.innerHTML='';
    for(const f of(Array.isArray(cp.fields)?cp.fields:[])){
        if(!f||!isValidCustomFieldKey(f.key))continue;
        if(f.enabled===false)continue; // v6.9.13: per-field toggle
        const r=document.createElement('div');r.className='sp-row sp-cp-display-row';
        r.innerHTML=`<div class="sp-row-label">${esc(f.label||f.key)}</div>`;
        if(f.type==='meter'){
            const num=clamp(parseInt(d[f.key])||0,0,100);
            const invert=!!f.invert;
            const effective=invert?(100-num):num;
            const danger=effective<25?'low':effective<50?'mid':'ok';
            const wrap=document.createElement('div');wrap.className='sp-row-value sp-cp-meter-wrap';
            wrap.innerHTML=`<div class="sp-cp-meter"><div class="sp-cp-meter-fill" data-danger="${danger}" style="width:${Math.max(num,3)}%"></div></div><span class="sp-cp-meter-val">${num}</span>`;
            r.appendChild(wrap);
        } else if(f.type==='enum'){
            const val=str(d[f.key])||'';
            const opts=Array.isArray(f.options)?f.options:[];
            const idx=opts.findIndex(o=>String(o).toLowerCase()===val.toLowerCase());
            const severity=opts.length>1&&idx>=0?Math.min(3,Math.floor((idx/(opts.length-1))*4)):0;
            const chip=document.createElement('span');chip.className='sp-cp-enum-chip';chip.dataset.severity=severity;
            chip.textContent=val||'\u2014';
            const vd=document.createElement('div');vd.className='sp-row-value';vd.appendChild(chip);r.appendChild(vd);
        } else if(f.type==='list'){
            const arr=Array.isArray(d[f.key])?d[f.key]:[];
            const vd=document.createElement('div');vd.className='sp-row-value sp-cp-list-chips';
            if(!arr.length){vd.textContent='\u2014'}
            else{for(const item of arr){const chip=document.createElement('span');chip.className='sp-cp-list-chip';chip.textContent=str(item)||'\u2014';vd.appendChild(chip)}}
            r.appendChild(vd);
        } else if(f.type==='number'){
            const vd=document.createElement('div');vd.className='sp-row-value';
            const numSpan=document.createElement('span');numSpan.className='sp-cp-number-val';numSpan.textContent=str(d[f.key])||'0';
            vd.appendChild(numSpan);r.appendChild(vd);
        } else {
            const val=document.createElement('div');val.className='sp-row-value';val.textContent=str(d[f.key])||'\u2014';
            r.appendChild(val);
        }
        content.appendChild(r);
    }
}

export function renderCustomPanelsMgr(s,container,panelBody){
    // v6.9.14: read from per-chat panels (auto-cloned from global on first access)
    const panelsRaw=ensureChatPanels();
    const panels=Array.isArray(panelsRaw)?panelsRaw:[];

    const _openState=new Map();
    container.querySelectorAll('.sp-custom-panel-card[data-panel-ui-key]').forEach(card=>{
        _openState.set(card.dataset.panelUiKey,card.classList.contains('sp-cp-open'));
    });
    container.innerHTML='';
    // Info button + popup
    const infoRow=document.createElement('div');infoRow.style.cssText='display:flex;align-items:center;gap:6px;margin-bottom:6px';
    const infoBtn=document.createElement('button');infoBtn.className='sp-cp-info-btn';infoBtn.textContent='?';infoBtn.title=t('How custom panels work');
    const infoPopup=document.createElement('div');infoPopup.className='sp-cp-info-popup';
    infoPopup.innerHTML=t('<b>Custom Panels</b> track any state the AI should monitor. Choose Global to create a standalone panel, or Each Character to add the fields to every character card. Keys use <code>lowercase_snake_case</code>. The LLM hint describes the expected value. Fields support text, number, meter, list, and enum types. Drag the handle to reorder fields.');
    infoBtn.addEventListener('click',()=>infoPopup.classList.toggle('sp-visible'));
    infoRow.appendChild(infoBtn);
    const infoLabel=document.createElement('span');infoLabel.style.cssText='font-size:9px;color:var(--sp-text-dim);opacity:0.6';infoLabel.textContent=t('How custom panels work');
    infoRow.appendChild(infoLabel);
    container.appendChild(infoRow);container.appendChild(infoPopup);
    // v6.9.14: scope indicator — always visible when panels exist
    const scopeRow = document.createElement('div');
    scopeRow.className = 'sp-cp-scope-row';
    scopeRow.innerHTML = `<span class="sp-cp-scope-icon">\u26C1</span><span class="sp-cp-scope-text">${t('Panels for this chat. Changes here only affect this chat.')}</span>`;
    container.appendChild(scopeRow);
    const panelControl=getPanelActivationStrategy(s);
    const controlRow=document.createElement('label');controlRow.className='sp-cp-control-row';
    const controlLabel=document.createElement('span');controlLabel.className='sp-cp-target-label';controlLabel.textContent=t('Panel control');
    const controlSelect=document.createElement('select');controlSelect.className='sp-cp-target-select sp-cp-control-select';
    for(const[value,label]of[['manual',t('Manual selection')],['automatic',t('Automatic by scene')]]){
        const option=document.createElement('option');option.value=value;option.textContent=label;option.selected=panelControl===value;controlSelect.appendChild(option);
    }
    controlSelect.addEventListener('change',()=>{
        const previous=captureTrackerStructure();
        setPanelActivationStrategy(controlSelect.value);
        reconcileTrackerStructureChange(previous);
        const snapshot=getLatestSnapshot();
        updatePanel(snapshot?normalizeTracker(snapshot):(_cachedNormData||{}),true);
        renderCustomPanelsMgr(s,container,panelBody);
    });
    controlRow.appendChild(controlLabel);controlRow.appendChild(controlSelect);container.appendChild(controlRow);
    const controlHint=document.createElement('div');controlHint.className='sp-cp-control-hint';
    controlHint.textContent=panelControl==='automatic'
        ?t('Auto panels follow scene tags; Always and Manual panels remain active.')+' '+t('Inactive Auto panels stay hidden until their tags match.')
        :t('Enabled panels are selected manually; scene tags are ignored.');
    container.appendChild(controlHint);
    if(panelControl==='automatic'&&(s.parallelFullGeneration!==true||s.injectionMethod!=='separate')){
        _appendWarning(container,'sp-cp-warn','#f59e0b',t('Automatic panel selection requires Separate mode with parallel tracker requests enabled.'));
    }
    if(!panels.length){
        container.appendChild(Object.assign(document.createElement('div'),{className:'sp-cp-empty',textContent:t('No custom panels yet')+'.'}));
        return;
    }
    panels.forEach((cp,cpIdx)=>{
        if(!cp||typeof cp!=='object')return;
        if(!Array.isArray(cp.fields))cp.fields=[];
        const libraryPinned=!!String(cp.sourceLibraryId||'').trim();
        const panelUiKey=_panelUiKey(cp,cpIdx);
        const card=document.createElement('div');card.className='sp-custom-panel-card';card.dataset.panelUiKey=panelUiKey;
        if(_openState.has(panelUiKey)?_openState.get(panelUiKey):true)card.classList.add('sp-cp-open');
        if(libraryPinned)card.classList.add('sp-cp-library-readonly');
        const liveRefresh=(forceFull=false)=>{
            const currentPanel=panels.find(item=>String(item?.id||'')===String(cp?.id||''))||cp;
            if((forceFull||customPanelScope(currentPanel)==='character')&&_cachedNormData){
                const snapshot=getLatestSnapshot();
                updatePanel(snapshot?normalizeTracker(snapshot):_cachedNormData,true);
            }
            else refreshCustomSection(currentPanel,panelBody);
            // Auto-refresh schema/prompt when custom panel changes
            const schemaEl=document.getElementById('sp-schema');
            const promptEl=document.getElementById('sp-sysprompt');
            const _ap=getActiveProfile(s);
            const view=buildProfileView(s,_ap);
            if(schemaEl&&!_ap.schema)schemaEl.value=JSON.stringify(buildDynamicSchema(view),null,2);
            if(promptEl&&!_ap.systemPrompt)promptEl.value=buildDynamicPrompt(view);
        };
        // Header: chevron + toggle + name + duplicate + delete
        const header=document.createElement('div');header.className='sp-cp-header';
        const chevron=document.createElement('span');chevron.className='sp-cp-chevron';chevron.textContent='\u25B6';
        // v6.9.11: enable/disable toggle per panel
        const toggle=document.createElement('input');toggle.type='checkbox';toggle.className='sp-cp-toggle';
        // v6.9.14: toggle writes directly to the chat-local panel copy
        toggle.checked = cp.enabled !== false;
        toggle.disabled=libraryPinned;
        toggle.title = libraryPinned
            ?t('Pinned library panels are controlled from Panel Library. Duplicate for a local editable copy.')
            :t('Enable/disable this panel for this chat');
        const toggleHit=document.createElement('label');toggleHit.className='sp-cp-toggle-hit';toggleHit.title=toggle.title;toggleHit.appendChild(toggle);
        toggleHit.addEventListener('click', e => e.stopPropagation());
        toggle.addEventListener('change', () => {
            const enabled=toggle.checked;
            if(!_commitPanelEdit(panels,next=>{next[cpIdx].enabled=enabled})){
                toggle.checked=!enabled;
                return;
            }
            liveRefresh(true);
            renderCustomPanelsMgr(s,container,panelBody);
        });
        const nameInput=document.createElement('input');nameInput.className='sp-cp-name';nameInput.type='text';nameInput.value=cp.name||'';nameInput.placeholder=t('Panel name');nameInput.spellcheck=false;nameInput.readOnly=libraryPinned;
        nameInput.addEventListener('click',e=>e.stopPropagation());
        nameInput.addEventListener('change',()=>{
            const oldKey=customPanelSectionKey(cp.name);
            const nextName=nameInput.value.trim()||'Untitled';
            if(!_commitPanelEdit(panels,next=>{next[cpIdx].name=nextName})){
                nameInput.value=cp.name||'';
                return;
            }
            const savedPanel=panels[cpIdx];
            const sec=_findSection(panelBody,oldKey);
            if(sec){
                const newKey=customPanelSectionKey(savedPanel.name);
                sec.dataset.key=newKey;
                const titleEl=sec.querySelector('.sp-section-title');if(titleEl)titleEl.textContent=savedPanel.name;
            }
            liveRefresh();
            renderCustomPanelsMgr(s,container,panelBody);
        });
        // v6.9.11: duplicate panel button
        const dupBtn=document.createElement('button');dupBtn.className='sp-btn sp-btn-sm sp-cp-dup';dupBtn.textContent='\u2398';dupBtn.title=t('Duplicate panel');
        dupBtn.addEventListener('click',(e)=>{
            e.stopPropagation();
            if(!_commitPanelEdit(panels,next=>{
                const clone=_makeLocalPanelCopy(next[cpIdx],next);
                next.splice(cpIdx+1,0,clone);
            }))return;
            renderCustomPanelsMgr(s,container,panelBody);liveRefresh(true);
            toastr.info(t('Panel duplicated'));
        });
        const delBtn=document.createElement('button');delBtn.className='sp-btn sp-btn-sm sp-cp-del';delBtn.textContent='\u2715';delBtn.disabled=libraryPinned;delBtn.title=libraryPinned?t('Pinned library panel is read-only'):t('Delete panel');
        delBtn.addEventListener('click',async(e)=>{
            e.stopPropagation();
            if(!await spConfirm(t('Delete Panel'),t('Remove "{panel}" and all its fields? This cannot be undone.',{panel:cp.name||t('Untitled')})))return;
            if(!_commitPanelEdit(panels,next=>{next.splice(cpIdx,1)}))return;
            liveRefresh(true);
            renderCustomPanelsMgr(s,container,panelBody);
            const cpKey=customPanelSectionKey(cp.name);
            const sec=_findSection(panelBody,cpKey);
            if(sec){sec.classList.add('sp-panel-hidden');setTimeout(()=>sec.remove(),350)}
            toastr.info(t('Panel deleted'));
        });
        header.appendChild(chevron);header.appendChild(toggleHit);header.appendChild(nameInput);
        if(cp.sourceLibraryId){
            const libBadge=document.createElement('span');libBadge.className='sp-cp-library-badge';
            libBadge.textContent=cp.sourceLibraryName||t('Library');
            libBadge.title=t('Pinned from library until turned off. Duplicate for a local editable copy.');
            header.appendChild(libBadge);
        }
        header.appendChild(dupBtn);header.appendChild(delBtn);
        header.addEventListener('click',(e)=>{if(e.target===nameInput||e.target===toggle||e.target.closest('.sp-cp-toggle-hit'))return;card.classList.toggle('sp-cp-open')});
        if(cp.enabled===false)card.classList.add('sp-cp-disabled');
        card.appendChild(header);
        // Collapsible body
        const body=document.createElement('div');body.className='sp-cp-body';
        if(libraryPinned){
            _appendWarning(body,'sp-cp-warn sp-cp-library-readonly-note','#60a5fa',t('This panel is pinned from Panel Library and is read-only here. Duplicate it to make a local editable copy, or turn off the source set in Panel Library.'));
        }
        // Scope: standalone top-level panel or fields repeated inside each
        // character card. Legacy panels default to global.
        const targetRow=document.createElement('label');targetRow.className='sp-cp-target-row';
        const targetLabel=document.createElement('span');targetLabel.className='sp-cp-target-label';targetLabel.textContent=t('Target');
        const targetSelect=document.createElement('select');targetSelect.className='sp-cp-target-select';targetSelect.disabled=libraryPinned;
        for(const[value,label]of[['global',t('Global panel')],['character',t('Each character')]]){
            const option=document.createElement('option');option.value=value;option.textContent=label;option.selected=customPanelScope(cp)===value;targetSelect.appendChild(option);
        }
        targetSelect.addEventListener('change',()=>{
            const scope=targetSelect.value;
            if(!_commitPanelEdit(panels,next=>{next[cpIdx].scope=scope})){
                targetSelect.value=customPanelScope(cp);
                return;
            }
            liveRefresh(true);
            renderCustomPanelsMgr(s,container,panelBody);
        });
        targetRow.appendChild(targetLabel);targetRow.appendChild(targetSelect);body.appendChild(targetRow);
        if(customPanelScope(cp)==='character'){
            const audience=normalizeAudience(cp.audience);
            const audienceBox=document.createElement('div');audienceBox.className='sp-cp-audience';
            const audienceHint=document.createElement('div');audienceHint.className='sp-cp-audience-hint';
            const hintText=formatAudienceHint(audience);
            audienceHint.textContent=hintText
                ?t('Shown only for')+': '+hintText
                :t('Empty filter = every character. Names, gender and keywords are combined with AND.');
            audienceBox.appendChild(audienceHint);
            const namesRow=document.createElement('label');namesRow.className='sp-cp-audience-row';
            namesRow.appendChild(Object.assign(document.createElement('span'),{className:'sp-cp-target-label',textContent:t('Names')}));
            const namesInput=document.createElement('input');namesInput.type='text';namesInput.className='sp-cp-audience-input';namesInput.readOnly=libraryPinned;
            namesInput.placeholder=t('Mira, Neko — leave empty for any name');
            namesInput.value=audience.names.join(', ');
            namesInput.addEventListener('change',()=>{
                const names=namesInput.value.split(/[,;\n]+/).map(item=>item.trim()).filter(Boolean);
                if(!_commitPanelEdit(panels,next=>{next[cpIdx].audience=normalizeAudience({...next[cpIdx].audience,names})})){
                    namesInput.value=normalizeAudience(cp.audience).names.join(', ');
                    return;
                }
                liveRefresh(true);renderCustomPanelsMgr(s,container,panelBody);
            });
            namesRow.appendChild(namesInput);audienceBox.appendChild(namesRow);
            const genderRow=document.createElement('div');genderRow.className='sp-cp-activation-tags';
            const genderLabel=document.createElement('span');genderLabel.className='sp-cp-target-label';genderLabel.textContent=t('Gender');genderRow.appendChild(genderLabel);
            const selectedGenders=new Set(audience.genders);
            for(const gender of CHARACTER_GENDER_OPTIONS){
                const tagLabel=document.createElement('label');tagLabel.className='sp-cp-activation-tag';
                const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=selectedGenders.has(gender);checkbox.disabled=libraryPinned;
                const text=document.createElement('span');text.textContent=t(gender[0].toUpperCase()+gender.slice(1));
                checkbox.addEventListener('change',()=>{
                    if(!_commitPanelEdit(panels,next=>{
                        const current=normalizeAudience(next[cpIdx].audience);
                        const genders=new Set(current.genders);
                        if(checkbox.checked)genders.add(gender);else genders.delete(gender);
                        next[cpIdx].audience=normalizeAudience({...current,genders:[...genders]});
                    })){
                        checkbox.checked=!checkbox.checked;
                        return;
                    }
                    liveRefresh(true);renderCustomPanelsMgr(s,container,panelBody);
                });
                tagLabel.appendChild(checkbox);tagLabel.appendChild(text);genderRow.appendChild(tagLabel);
            }
            audienceBox.appendChild(genderRow);
            const keysRow=document.createElement('label');keysRow.className='sp-cp-audience-row';
            keysRow.appendChild(Object.assign(document.createElement('span'),{className:'sp-cp-target-label',textContent:t('Keywords')}));
            const keysInput=document.createElement('input');keysInput.type='text';keysInput.className='sp-cp-audience-input';keysInput.readOnly=libraryPinned;
            keysInput.placeholder=t('cat, neko, tail, kemonomimi');
            keysInput.value=audience.keywords.join(', ');
            keysInput.addEventListener('change',()=>{
                const keywords=keysInput.value.split(/[,;\n]+/).map(item=>item.trim()).filter(Boolean);
                if(!_commitPanelEdit(panels,next=>{next[cpIdx].audience=normalizeAudience({...next[cpIdx].audience,keywords})})){
                    keysInput.value=normalizeAudience(cp.audience).keywords.join(', ');
                    return;
                }
                liveRefresh(true);renderCustomPanelsMgr(s,container,panelBody);
            });
            keysRow.appendChild(keysInput);audienceBox.appendChild(keysRow);
            body.appendChild(audienceBox);
        }
        // Runtime activation policy. `enabled` remains the master switch;
        // Auto controls runtime activation for profile-bound parallel Full/Delta generation.
        const activationRow=document.createElement('div');activationRow.className='sp-cp-activation-row';
        const activationLabel=document.createElement('span');activationLabel.className='sp-cp-target-label';activationLabel.textContent=t('Activation');
        const activationSelect=document.createElement('select');activationSelect.className='sp-cp-target-select sp-cp-activation-select';
        for(const[value,label]of[['always',t('Always')],['auto',t('Auto (parallel full)')],['manual',t('Manual — forced on')]]){
            const option=document.createElement('option');option.value=value;option.textContent=label;option.selected=normalizePanelActivationMode(cp)===value;activationSelect.appendChild(option);
        }
        activationSelect.disabled=panelControl==='manual'||libraryPinned;
        activationSelect.addEventListener('change',()=>{
            const mode=activationSelect.value;
            if(!_commitPanelEdit(panels,next=>{next[cpIdx].activationMode=mode;next[cpIdx].activationTags=normalizeSceneTags(next[cpIdx].activationTags)})){
                activationSelect.value=normalizePanelActivationMode(cp);
                return;
            }
            liveRefresh(true);renderCustomPanelsMgr(s,container,panelBody);
        });
        const latestActivation=getLatestSnapshot()?._spMeta?.panelActivation||null;
        const runtimeKey=customPanelActivationKey(cp);
        const activationMode=normalizePanelActivationMode(cp);
        const activationBadge=document.createElement('span');activationBadge.className='sp-cp-activation-badge';
        let badgeState='always',badgeText=t('ALWAYS');
        if(cp.enabled===false){badgeState='inactive';badgeText=t('FORCED OFF')}
        else if(panelControl==='manual'){badgeState='active';badgeText=t('MANUAL · ON')}
        else if(activationMode==='manual'){badgeState='active';badgeText=t('FORCED ON')}
        else if(activationMode==='auto'&&s.parallelFullGeneration!==true){badgeState='pending';badgeText=t('PARALLEL OFF')}
        else if(activationMode==='auto'&&latestActivation?.activePanelIds?.includes(runtimeKey)){badgeState='active';badgeText=t('AUTO · ACTIVE')}
        else if(activationMode==='auto'&&latestActivation?.inactivePanelIds?.includes(runtimeKey)){badgeState='inactive';badgeText=t('AUTO · INACTIVE')}
        else if(activationMode==='auto'){badgeState='pending';badgeText=t('AUTO · PENDING')}
        activationBadge.dataset.state=badgeState;activationBadge.textContent=badgeText;
        activationRow.appendChild(activationLabel);activationRow.appendChild(activationSelect);activationRow.appendChild(activationBadge);body.appendChild(activationRow);
        if(panelControl==='automatic'&&activationMode==='auto'){
            const tagsDetails=document.createElement('details');tagsDetails.className='sp-cp-activation-tags-wrap';
            const tagsSummary=document.createElement('summary');tagsSummary.className='sp-cp-activation-tags-summary';
            const selectedTags=new Set(normalizeSceneTags(cp.activationTags));
            tagsSummary.textContent=selectedTags.size?[...selectedTags].join(' · '):t('Scene tags');
            const tagsWrap=document.createElement('div');tagsWrap.className='sp-cp-activation-tags';
            for(const tag of SCENE_TAG_REGISTRY){
                const tagLabel=document.createElement('label');tagLabel.className='sp-cp-activation-tag';
                const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=selectedTags.has(tag);checkbox.disabled=libraryPinned;
                const text=document.createElement('span');text.textContent=tag;
                checkbox.addEventListener('change',()=>{
                    if(!_commitPanelEdit(panels,next=>{
                        const tags=new Set(Array.isArray(next[cpIdx].activationTags)?next[cpIdx].activationTags:[]);
                        if(checkbox.checked)tags.add(tag);else tags.delete(tag);
                        next[cpIdx].activationTags=SCENE_TAG_REGISTRY.filter(item=>tags.has(item));
                    })){
                        checkbox.checked=!checkbox.checked;
                        return;
                    }
                    liveRefresh(true);renderCustomPanelsMgr(s,container,panelBody);
                });
                tagLabel.appendChild(checkbox);tagLabel.appendChild(text);tagsWrap.appendChild(tagLabel);
            }
            tagsDetails.appendChild(tagsSummary);tagsDetails.appendChild(tagsWrap);
            body.appendChild(tagsDetails);
            if(!selectedTags.size)_appendWarning(body,'sp-cp-warn','#f59e0b',t('Auto panel has no tags and will remain inactive.'));
        }
        const _activeProfile=getActiveProfile(s);
        const _panelView=buildProfileView(s,_activeProfile);
        if(customPanelScope(cp)==='character'&&_panelView.panels?.characters===false){
            _appendWarning(body,'sp-cp-warn','#f59e0b',t('Character-scoped fields are inactive while the Characters panel is disabled.'));
        }
        if(customPanelScope(cp)==='character'&&(_activeProfile?.schema||_activeProfile?.systemPrompt)){
            _appendWarning(body,'sp-cp-warn','#f59e0b',t('Custom schema or full prompt overrides must declare character-scoped fields manually.'));
        }
        // Column headers
        if(cp.fields?.length){
            const labels=document.createElement('div');labels.className='sp-cp-field-labels';
            labels.innerHTML=`<span></span><span></span><span>${t('Key')}</span><span>${t('Label')}</span><span>${t('Type')}</span><span>${t('LLM Hint')}</span><span></span>`;
            body.appendChild(labels);
        }
        // Fields with drag/drop
        const fieldsList=document.createElement('div');fieldsList.className='sp-cp-fields';
        let _dragSrcIdx=null,_dragSrcCpIdx=null;
        (cp.fields||[]).forEach((f,fIdx)=>{
            const row=document.createElement('div');row.className='sp-cp-field-row';
            row.dataset.fidx=fIdx;row.dataset.cpidx=cpIdx;
            // Drag handle
            const handle=document.createElement('span');handle.className='sp-cp-drag-handle';handle.draggable=!libraryPinned;handle.textContent='\u2807';handle.title=libraryPinned?t('Pinned library panel is read-only'):t('Drag to reorder');
            // Drag events
            handle.addEventListener('dragstart',(e)=>{e.stopPropagation();_dragSrcIdx=fIdx;_dragSrcCpIdx=cpIdx;row.classList.add('sp-dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',cpIdx+':'+fIdx)});
            handle.addEventListener('dragend',()=>{row.classList.remove('sp-dragging');container.querySelectorAll('.sp-drag-over').forEach(r=>r.classList.remove('sp-drag-over'))});
            row.addEventListener('dragover',(e)=>{
                if(libraryPinned)return;
                e.preventDefault();e.dataTransfer.dropEffect='move';row.classList.add('sp-drag-over');
            });
            row.addEventListener('dragleave',()=>row.classList.remove('sp-drag-over'));
            row.addEventListener('drop',(e)=>{
                e.preventDefault();row.classList.remove('sp-drag-over');
                const data=e.dataTransfer.getData('text/plain').split(':');
                const srcCp=parseInt(data[0]),srcF=parseInt(data[1]);
                const dstCp=cpIdx,dstF=fIdx;
                if(srcCp===dstCp&&srcF===dstF)return;
                const srcPanel=panels[srcCp];const dstPanel=panels[dstCp];
                if(!srcPanel||!dstPanel)return;
                if(srcPanel.sourceLibraryId||dstPanel.sourceLibraryId){
                    toastr.info(t('Pinned library panels are read-only. Duplicate for a local editable copy.'));
                    return;
                }
                if(!_commitPanelEdit(panels,next=>{
                    const [moved]=next[srcCp].fields.splice(srcF,1);
                    next[dstCp].fields.splice(dstF,0,moved);
                }))return;
                liveRefresh(true);
                renderCustomPanelsMgr(s,container,panelBody);
            });
            // Key: enforce lowercase_snake_case
            // v6.9.13: per-field enable/disable toggle
            const fToggle=document.createElement('input');fToggle.type='checkbox';fToggle.className='sp-cp-field-toggle';
            fToggle.checked=f.enabled!==false;fToggle.disabled=libraryPinned;fToggle.title=libraryPinned?t('Pinned library panel is read-only'):t('Enable/disable this field');
            const fToggleHit=document.createElement('label');fToggleHit.className='sp-cp-field-toggle-hit';fToggleHit.title=fToggle.title;fToggleHit.appendChild(fToggle);
            fToggle.addEventListener('change',()=>{
                const enabled=fToggle.checked;
                if(!_commitPanelEdit(panels,next=>{next[cpIdx].fields[fIdx].enabled=enabled})){
                    fToggle.checked=!enabled;
                    return;
                }
                liveRefresh(true);
                renderCustomPanelsMgr(s,container,panelBody);
            });
            if(f.enabled===false)row.classList.add('sp-cp-field-disabled');
            const keyIn=document.createElement('input');keyIn.className='sp-cp-field-key';keyIn.placeholder=t('key');keyIn.value=f.key||'';keyIn.spellcheck=false;keyIn.maxLength=64;keyIn.readOnly=libraryPinned;keyIn.title=t('JSON key — lowercase_snake_case only. Examples: health, mana_pool, reputation');
            keyIn.addEventListener('change',()=>{
                const normalized=keyIn.value.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'').replace(/^[0-9]/,'_$&').replace(/_+/g,'_');
                if(!_commitPanelEdit(panels,next=>{next[cpIdx].fields[fIdx].key=normalized})){
                    keyIn.value=f.key||'';
                    return;
                }
                liveRefresh(true);
                renderCustomPanelsMgr(s,container,panelBody);
            });
            const labelIn=document.createElement('input');labelIn.className='sp-cp-field-label';labelIn.placeholder=t('Label');labelIn.value=f.label||'';labelIn.readOnly=libraryPinned;
            labelIn.title=t('Display name shown in the panel. Examples: Health, Mana Pool, Street Rep');
            labelIn.addEventListener('change',()=>{f.label=labelIn.value;saveChatPanels();liveRefresh()});
            const typeSel=document.createElement('select');typeSel.className='sp-cp-field-type';typeSel.disabled=libraryPinned;
            typeSel.title=t('Field type: text, number, meter (0–100), list, or enum');
            for(const ft of['text','number','meter','list','enum']){const o=document.createElement('option');o.value=ft;o.textContent=ft;o.selected=f.type===ft;typeSel.appendChild(o)}
            typeSel.addEventListener('change',()=>{
                const type=typeSel.value;
                if(!_commitPanelEdit(panels,next=>{next[cpIdx].fields[fIdx].type=type})){
                    typeSel.value=f.type;
                    return;
                }
                liveRefresh(true);
                renderCustomPanelsMgr(s,container,panelBody);
            });
            const descIn=document.createElement('textarea');descIn.className='sp-cp-field-desc';descIn.placeholder=t('Describe for AI...');descIn.value=f.desc||'';descIn.rows=1;descIn.readOnly=libraryPinned;
            descIn.title=t('Instructions for the LLM describing exactly what value to return');
            const autoSizeDesc=()=>{descIn.style.height='auto';descIn.style.height=Math.min(160,Math.max(44,descIn.scrollHeight||44))+'px'};
            let descSaveTimer=null;
            const persistDesc=()=>{
                if(descSaveTimer){clearTimeout(descSaveTimer);descSaveTimer=null}
                const desc=descIn.value;
                if(!_commitPanelEdit(panels,next=>{next[cpIdx].fields[fIdx].desc=desc})){
                    descIn.value=f.desc||'';
                    autoSizeDesc();
                    return;
                }
                liveRefresh();
            };
            descIn.addEventListener('input',()=>{autoSizeDesc();if(descSaveTimer)clearTimeout(descSaveTimer);descSaveTimer=setTimeout(persistDesc,300)});
            descIn.addEventListener('change',persistDesc);
            requestAnimationFrame(autoSizeDesc);
            const rmBtn=document.createElement('button');rmBtn.className='sp-btn sp-btn-sm sp-cp-field-rm';rmBtn.textContent='\u2212';rmBtn.disabled=libraryPinned;rmBtn.title=libraryPinned?t('Pinned library panel is read-only'):t('Remove this field');
            rmBtn.addEventListener('click',()=>{
                if(!_commitPanelEdit(panels,next=>{next[cpIdx].fields.splice(fIdx,1)}))return;
                liveRefresh(true);
                renderCustomPanelsMgr(s,container,panelBody);
            });
            // Touch fallback: HTML5 drag/drop is unreliable on mobile browsers.
            const moveControls=document.createElement('div');moveControls.className='sp-cp-move-controls';
            const addMoveButton=(label,title,delta)=>{
                const moveBtn=document.createElement('button');moveBtn.type='button';moveBtn.className='sp-btn sp-btn-sm sp-cp-field-move';
                moveBtn.textContent=label;moveBtn.title=title;moveBtn.setAttribute('aria-label',title);
                const target=fIdx+delta;moveBtn.disabled=libraryPinned||target<0||target>=(cp.fields||[]).length;
                moveBtn.addEventListener('click',(e)=>{
                    e.preventDefault();e.stopPropagation();
                    const dst=fIdx+delta;if(dst<0||dst>=(cp.fields||[]).length)return;
                    if(!_commitPanelEdit(panels,next=>{
                        const [moved]=next[cpIdx].fields.splice(fIdx,1);
                        next[cpIdx].fields.splice(dst,0,moved);
                    }))return;
                    liveRefresh(true);renderCustomPanelsMgr(s,container,panelBody);
                });
                moveControls.appendChild(moveBtn);
            };
            addMoveButton('\u2191',t('Move field up'),-1);
            addMoveButton('\u2193',t('Move field down'),1);
            row.appendChild(handle);row.appendChild(fToggleHit);row.appendChild(keyIn);row.appendChild(labelIn);row.appendChild(typeSel);row.appendChild(descIn);row.appendChild(rmBtn);row.appendChild(moveControls);
            if(f.type==='enum'){
                const optRow=document.createElement('div');optRow.className='sp-cp-field-opt-row';
                const optIn=document.createElement('input');optIn.placeholder=t('Enum options (comma-separated)');optIn.value=(Array.isArray(f.options)?f.options:[]).join(', ');optIn.spellcheck=false;optIn.readOnly=libraryPinned;
                optIn.title=t('Comma-separated list of allowed values. Example: low, medium, high, critical');
                optIn.addEventListener('change',()=>{
                    const options=optIn.value.split(',').map(value=>value.trim()).filter(Boolean);
                    if(!_commitPanelEdit(panels,next=>{next[cpIdx].fields[fIdx].options=options})){
                        optIn.value=(Array.isArray(f.options)?f.options:[]).join(', ');
                        return;
                    }
                    liveRefresh(true);
                    renderCustomPanelsMgr(s,container,panelBody);
                });
                optRow.appendChild(optIn);
                const wrapper=document.createElement('div');wrapper.appendChild(row);wrapper.appendChild(optRow);
                fieldsList.appendChild(wrapper);
            } else fieldsList.appendChild(row);
        });
        body.appendChild(fieldsList);
        // Validation warning for incomplete fields
        const hasIncomplete=(cp.fields||[]).some(f=>!f.key||!f.desc);
        if(hasIncomplete&&cp.fields?.length){
            _appendWarning(body,'sp-cp-warn','#f59e0b',t('Fill in keys and LLM hints so the AI knows what to track.'));
        }
        // v6.9.11: key collision detection — warn if any field key
        // in this panel duplicates a key in another panel
        const _allKeys=new Map();
        for(let pi=0;pi<panels.length;pi++){
            const panelScope=customPanelScope(panels[pi]);
            for(const pf of(panels[pi].fields||[])){
                const k=String(pf?.key||'').toLowerCase().trim();
                if(!k)continue;
                const scopedKey=panelScope+':'+k;
                if(!_allKeys.has(scopedKey))_allKeys.set(scopedKey,[]);
                _allKeys.get(scopedKey).push(panels[pi].name||'Untitled');
            }
        }
        const _scope=customPanelScope(cp);
        const _dupeKeys=(cp.fields||[]).filter(f=>{const k=String(f?.key||'').toLowerCase().trim();return k&&(_allKeys.get(_scope+':'+k)||[]).length>1}).map(f=>String(f?.key||''));
        if(_dupeKeys.length){
            _appendWarning(body,'sp-cp-warn sp-cp-warn-collision','#ef4444',t('Key collision: {keys}. Values in different panels will overwrite each other.',{keys:_dupeKeys.join(', ')}));
        }
        if(customPanelScope(cp)==='character'){
            const _builtinCollisions=(cp.fields||[]).map(f=>String(f?.key||'')).filter(isBuiltInCharacterFieldKey);
            if(_builtinCollisions.length){
                _appendWarning(body,'sp-cp-warn sp-cp-warn-collision','#ef4444',t('Built-in character field collision: {keys}. Choose different keys.',{keys:_builtinCollisions.join(', ')}));
            }
        }
        const addFieldBtn=document.createElement('button');addFieldBtn.className='sp-btn sp-btn-sm sp-cp-add-field';addFieldBtn.textContent='+ '+t('Add Field');addFieldBtn.disabled=libraryPinned;
        addFieldBtn.addEventListener('click',()=>{
            if(!cp.fields)cp.fields=[];
            // Keep the draft outside the request contract until it receives a
            // valid key. The key edit itself goes through _commitPanelEdit(),
            // which performs structural reconciliation and forces a Full run.
            cp.fields.push({key:'',label:'',type:'text',desc:''});
            saveChatPanels();renderCustomPanelsMgr(s,container,panelBody);liveRefresh();
        });
        body.appendChild(addFieldBtn);card.appendChild(body);container.appendChild(card);
    });
}
