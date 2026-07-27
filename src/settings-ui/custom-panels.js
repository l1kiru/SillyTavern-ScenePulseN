// ScenePulse — Custom Panels Module
// Extracted from index.js lines 4969-5130

import {
    buildProfileView,
    captureTrackerStructure,
    ensureChatPanels,
    getLatestSnapshot,
    reconcileTrackerStructureChange,
    saveChatPanels,
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
        const r=document.createElement('div');r.className='sp-row';
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
            else{for(const item of arr){const chip=document.createElement('span');chip.className='sp-cp-list-chip';chip.textContent=item;vd.appendChild(chip)}}
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

    const _openState={};container.querySelectorAll('.sp-custom-panel-card').forEach((c,i)=>{_openState[i]=c.classList.contains('sp-cp-open')});
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
    if(!panels.length){
        container.appendChild(Object.assign(document.createElement('div'),{className:'sp-cp-empty',textContent:t('No custom panels yet')+'.'}));
        return;
    }
    panels.forEach((cp,cpIdx)=>{
        if(!cp||typeof cp!=='object')return;
        if(!Array.isArray(cp.fields))cp.fields=[];
        const card=document.createElement('div');card.className='sp-custom-panel-card';if(_openState[cpIdx]!==undefined?_openState[cpIdx]:true)card.classList.add('sp-cp-open');
        const liveRefresh=(forceFull=false)=>{
            if((forceFull||customPanelScope(cp)==='character')&&_cachedNormData){
                const snapshot=getLatestSnapshot();
                updatePanel(snapshot?normalizeTracker(snapshot):_cachedNormData,true);
            }
            else refreshCustomSection(cp,panelBody);
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
        toggle.title = t('Enable/disable this panel for this chat');
        toggle.addEventListener('click', e => e.stopPropagation());
        toggle.addEventListener('change', () => {
            const enabled=toggle.checked;
            if(!_commitPanelEdit(panels,next=>{next[cpIdx].enabled=enabled})){
                toggle.checked=!enabled;
                return;
            }
            liveRefresh(true);
            renderCustomPanelsMgr(s,container,panelBody);
        });
        const nameInput=document.createElement('input');nameInput.className='sp-cp-name';nameInput.type='text';nameInput.value=cp.name||'';nameInput.placeholder=t('Panel name');nameInput.spellcheck=false;
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
            const base=(cp.name||'Untitled')+' (copy)';
            const used=new Set(panels.map(panel=>String(panel?.name||'').trim().toLowerCase()));
            let name=base,suffix=2;
            while(used.has(name.toLowerCase()))name=`${base} ${suffix++}`;
            if(!_commitPanelEdit(panels,next=>{
                const clone=structuredClone(next[cpIdx]);
                clone.id='cp_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
                clone.name=name;
                clone.fields=(clone.fields||[]).map(field=>({...field,key:''}));
                next.splice(cpIdx+1,0,clone);
            }))return;
            renderCustomPanelsMgr(s,container,panelBody);liveRefresh();
            toastr.info(t('Panel duplicated'));
        });
        const delBtn=document.createElement('button');delBtn.className='sp-btn sp-btn-sm sp-cp-del';delBtn.textContent='\u2715';delBtn.title=t('Delete panel');
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
        header.appendChild(chevron);header.appendChild(toggle);header.appendChild(nameInput);header.appendChild(dupBtn);header.appendChild(delBtn);
        header.addEventListener('click',(e)=>{if(e.target===nameInput||e.target===toggle)return;card.classList.toggle('sp-cp-open')});
        if(cp.enabled===false)card.classList.add('sp-cp-disabled');
        card.appendChild(header);
        // Collapsible body
        const body=document.createElement('div');body.className='sp-cp-body';
        // Scope: standalone top-level panel or fields repeated inside each
        // character card. Legacy panels default to global.
        const targetRow=document.createElement('label');targetRow.className='sp-cp-target-row';
        const targetLabel=document.createElement('span');targetLabel.className='sp-cp-target-label';targetLabel.textContent=t('Target');
        const targetSelect=document.createElement('select');targetSelect.className='sp-cp-target-select';
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
            const handle=document.createElement('span');handle.className='sp-cp-drag-handle';handle.draggable=true;handle.textContent='\u2807';handle.title=t('Drag to reorder');
            // Drag events
            handle.addEventListener('dragstart',(e)=>{e.stopPropagation();_dragSrcIdx=fIdx;_dragSrcCpIdx=cpIdx;row.classList.add('sp-dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',cpIdx+':'+fIdx)});
            handle.addEventListener('dragend',()=>{row.classList.remove('sp-dragging');container.querySelectorAll('.sp-drag-over').forEach(r=>r.classList.remove('sp-drag-over'))});
            row.addEventListener('dragover',(e)=>{e.preventDefault();e.dataTransfer.dropEffect='move';row.classList.add('sp-drag-over')});
            row.addEventListener('dragleave',()=>row.classList.remove('sp-drag-over'));
            row.addEventListener('drop',(e)=>{
                e.preventDefault();row.classList.remove('sp-drag-over');
                const data=e.dataTransfer.getData('text/plain').split(':');
                const srcCp=parseInt(data[0]),srcF=parseInt(data[1]);
                const dstCp=cpIdx,dstF=fIdx;
                if(srcCp===dstCp&&srcF===dstF)return;
                const srcPanel=panels[srcCp];const dstPanel=panels[dstCp];
                if(!srcPanel||!dstPanel)return;
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
            fToggle.checked=f.enabled!==false;fToggle.title=t('Enable/disable this field');
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
            const keyIn=document.createElement('input');keyIn.className='sp-cp-field-key';keyIn.placeholder=t('key');keyIn.value=f.key||'';keyIn.spellcheck=false;keyIn.maxLength=64;keyIn.title=t('JSON key — lowercase_snake_case only. Examples: health, mana_pool, reputation');
            keyIn.addEventListener('change',()=>{
                const normalized=keyIn.value.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'').replace(/^[0-9]/,'_$&').replace(/_+/g,'_');
                if(!_commitPanelEdit(panels,next=>{next[cpIdx].fields[fIdx].key=normalized})){
                    keyIn.value=f.key||'';
                    return;
                }
                liveRefresh(true);
                renderCustomPanelsMgr(s,container,panelBody);
            });
            const labelIn=document.createElement('input');labelIn.className='sp-cp-field-label';labelIn.placeholder=t('Label');labelIn.value=f.label||'';
            labelIn.title=t('Display name shown in the panel. Examples: Health, Mana Pool, Street Rep');
            labelIn.addEventListener('change',()=>{f.label=labelIn.value;saveChatPanels();liveRefresh()});
            const typeSel=document.createElement('select');typeSel.className='sp-cp-field-type';
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
            const descIn=document.createElement('input');descIn.className='sp-cp-field-desc';descIn.placeholder=t('Describe for AI...');descIn.value=f.desc||'';
            descIn.title=t('Instructions for the LLM describing exactly what value to return');
            descIn.addEventListener('change',()=>{f.desc=descIn.value;saveChatPanels();liveRefresh()});
            const rmBtn=document.createElement('button');rmBtn.className='sp-btn sp-btn-sm sp-cp-field-rm';rmBtn.textContent='\u2212';rmBtn.title=t('Remove this field');
            rmBtn.addEventListener('click',()=>{
                if(!_commitPanelEdit(panels,next=>{next[cpIdx].fields.splice(fIdx,1)}))return;
                liveRefresh(true);
                renderCustomPanelsMgr(s,container,panelBody);
            });
            row.appendChild(handle);row.appendChild(fToggle);row.appendChild(keyIn);row.appendChild(labelIn);row.appendChild(typeSel);row.appendChild(descIn);row.appendChild(rmBtn);
            if(f.type==='enum'){
                const optRow=document.createElement('div');optRow.className='sp-cp-field-opt-row';
                const optIn=document.createElement('input');optIn.placeholder=t('Enum options (comma-separated)');optIn.value=(Array.isArray(f.options)?f.options:[]).join(', ');optIn.spellcheck=false;
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
        const addFieldBtn=document.createElement('button');addFieldBtn.className='sp-btn sp-btn-sm sp-cp-add-field';addFieldBtn.textContent='+ '+t('Add Field');
        addFieldBtn.addEventListener('click',()=>{
            if(!cp.fields)cp.fields=[];
            cp.fields.push({key:'',label:'',type:'text',desc:''});
            saveChatPanels();renderCustomPanelsMgr(s,container,panelBody);liveRefresh();
        });
        body.appendChild(addFieldBtn);card.appendChild(body);container.appendChild(card);
    });
}
