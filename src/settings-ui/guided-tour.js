// ScenePulse — Guided Tour Module
// Extracted from index.js lines 4719-4941

import { TOUR_EXAMPLE_DATA, MASCOT_SVG } from '../constants.js';
import { getSettings, saveSettings } from '../settings.js';
import { normalizeTracker } from '../normalize.js';
import { _cachedNormData, currentSnapshotMesIdx, setCurrentSnapshotMesIdx } from '../state.js';
import { updatePanel } from '../ui/update-panel.js';
import { showPanel } from '../ui/panel.js';
import { renderTimeline } from '../ui/timeline.js';
import { spDetectMode } from '../ui/mobile.js';
import { renderCustomPanelsMgr } from './custom-panels.js';
import { t } from '../i18n.js';

export function startGuidedTour(){
    const _s=(svg)=>`<svg viewBox="0 0 16 16" width="13" height="13" fill="none" style="vertical-align:-2px;display:inline">${svg}</svg>`;
    const _i={
        regen:_s('<path d="M13.5 8a5.5 5.5 0 1 1-1.3-3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M13.5 3v2.5h-2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'),
        panels:_s('<rect x="1" y="2" width="6" height="4" rx="1" stroke="currentColor" stroke-width="1.1" opacity="0.6"/><rect x="9" y="2" width="6" height="4" rx="1" stroke="currentColor" stroke-width="1.1" opacity="0.6"/><rect x="1" y="8" width="6" height="4" rx="1" stroke="currentColor" stroke-width="1.1" fill="currentColor" opacity="0.15"/><rect x="9" y="8" width="6" height="4" rx="1" stroke="currentColor" stroke-width="1.1"/>'),
        toggle:_s('<rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2"/>'),
        condense:_s('<rect x="2" y="2" width="12" height="2.5" rx="1" fill="currentColor" opacity="0.3"/><rect x="2" y="6" width="9" height="2" rx="0.8" fill="currentColor" opacity="0.2"/><rect x="2" y="9.5" width="11" height="2" rx="0.8" fill="currentColor" opacity="0.15"/><path d="M14 5.5L14 12" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.3"/>'),
        thoughts:_s('<path d="M2 9.5c0 1.5 1.5 3 4 3l2 2v-2c2.5 0 4-1.5 4-3V6c0-1.5-1.5-3-4-3H6C3.5 3 2 4.5 2 6v3.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" fill="currentColor" opacity="0.15"/><circle cx="5.5" cy="7.2" r="0.8" fill="currentColor" opacity="0.6"/><circle cx="8" cy="7.2" r="0.8" fill="currentColor" opacity="0.6"/><circle cx="10.5" cy="7.2" r="0.8" fill="currentColor" opacity="0.6"/>'),
        weather:_s('<path d="M4.5 11.5c-2 0-3.5-1.2-3.5-3 0-1.4 1-2.6 2.4-3C4 2.8 6.2 1 9 1c2.6 0 4.8 1.8 5 4 1.5.3 2.5 1.4 2.5 2.8 0 1.7-1.5 3-3.2 3H4.5z" fill="currentColor" opacity="0.15" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'),
        time:_s('<circle cx="8" cy="8" r="3" fill="currentColor" opacity="0.25" stroke="currentColor" stroke-width="1.2"/><line x1="8" y1="1.5" x2="8" y2="3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/><line x1="8" y1="12.5" x2="8" y2="14.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/><line x1="1.5" y1="8" x2="3.5" y2="8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/><line x1="12.5" y1="8" x2="14.5" y2="8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/>'),
        transition:_s('<path d="M2 12V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" stroke="currentColor" stroke-width="1.1" fill="currentColor" opacity="0.08"/><path d="M5 8h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/><path d="M9.5 5.5L12 8l-2.5 2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>'),
        edit:_s('<path d="M11.5 1.5l3 3-8.5 8.5H3v-3l8.5-8.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><line x1="9.5" y1="3.5" x2="12.5" y2="6.5" stroke="currentColor" stroke-width="0.8" opacity="0.4"/>'),
        star:_s('<polygon points="8,1 9.8,5.8 15,6.2 11,9.6 12.2,15 8,12 3.8,15 5,9.6 1,6.2 6.2,5.8" fill="currentColor" opacity="0.3" stroke="currentColor" stroke-width="1"/>'),
        main:_s('<path d="M3 14V3a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v11l-5-2.5L3 14z" fill="currentColor" opacity="0.2" stroke="currentColor" stroke-width="1.1"/>'),
        side:_s('<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.1"/><path d="M8 4v4.5l3 1.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>'),
        heart:_s('<path d="M8 14s-5.5-3.5-5.5-7A3 3 0 0 1 8 5a3 3 0 0 1 5.5 2c0 3.5-5.5 7-5.5 7z" fill="#d46a7e" opacity="0.6"/>'),
        shield:_s('<path d="M8 1L2 4v4c0 3.5 2.5 5.5 6 7 3.5-1.5 6-3.5 6-7V4L8 1z" fill="#d4a55e" opacity="0.4" stroke="#d4a55e" stroke-width="0.8"/>'),
        flame:_s('<path d="M8 2c-1.5 2-4 4-4 7a4 4 0 0 0 8 0c0-3-2.5-5-4-7z" fill="#c44080" opacity="0.5"/>'),
        bolt:_s('<path d="M9 1L5 8h4l-2 7 6-8H9l2-6z" fill="#f59e0b" opacity="0.6"/>'),
        compat:_s('<circle cx="6" cy="8" r="4" stroke="#40a0c4" stroke-width="1" opacity="0.6"/><circle cx="10" cy="8" r="4" stroke="#40a0c4" stroke-width="1" opacity="0.6"/>'),
        snap:_s('<rect x="1" y="2" width="6" height="12" rx="1" stroke="currentColor" stroke-width="1.2" opacity="0.8"/><rect x="9" y="2" width="6" height="12" rx="1" stroke="currentColor" stroke-width="1.2" opacity="0.35"/><path d="M4.5 6.5L2.5 8l2 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>'),
        ghost:_s('<path d="M10 2C6.5 2 4 4.8 4 7.5v7c0 .4.2.7.5.5l1.5-1.2 1.5 1.2c.3.2.7.2 1 0L10 13.8l1.5 1.2c.3.2.7.2 1 0l1.5-1.2 1.5 1.2c.3.2.5-.1.5-.5v-7C16 4.8 13.5 2 10 2z" fill="currentColor" opacity="0.12" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/><ellipse cx="7.8" cy="8" rx="1.3" ry="1.6" fill="currentColor" opacity="0.7"/><ellipse cx="12.2" cy="8" rx="1.3" ry="1.6" fill="currentColor" opacity="0.7"/>')
    };
    const _savedData=_cachedNormData?structuredClone(_cachedNormData):null;
    const _savedMesIdx=currentSnapshotMesIdx;
    const exData=normalizeTracker(structuredClone(TOUR_EXAMPLE_DATA));
    updatePanel(exData);showPanel();
    // Fake timeline
    const tl=document.getElementById('sp-timeline');
    if(tl){const bar=tl.querySelector('.sp-timeline-bar')||tl;bar.innerHTML='';for(let i=0;i<12;i++){const w=document.createElement('div');w.className='sp-tl-node-wrap';const d=document.createElement('div');d.className='sp-tl-dot'+(i===11?' sp-tl-dot-active':'');w.appendChild(d);if(i===11){const l=document.createElement('div');l.className='sp-tl-label';l.textContent='#26';w.appendChild(l)}bar.appendChild(w)}}
    function collapseAll(){document.querySelectorAll('#sp-panel-body .sp-section.sp-open').forEach(s=>s.classList.remove('sp-open'))}
    function openSection(key){
        const sec=document.querySelector(`[data-key="${key}"]`);
        if(!sec)return;sec.classList.add('sp-open');
        setTimeout(()=>{
            if(key==='relationships'||key==='characters')sec.querySelectorAll('.sp-rel-block,.sp-char-card').forEach(c=>c.classList.add('sp-card-open'));
            if(key==='quests'){sec.querySelectorAll('.sp-plot-tier').forEach(t=>t.classList.add('sp-tier-open'));sec.querySelectorAll('.sp-plot-entry').forEach(e=>e.classList.add('sp-card-open'))}
            if(key==='branches')sec.querySelectorAll('.sp-idea-card').forEach(c=>c.classList.add('sp-card-open'));
        },30);
    }
    function openPanelMgr(){
        let mgr=document.getElementById('sp-panel-mgr');
        if(!mgr){document.getElementById('sp-tb-panels')?.click();mgr=document.getElementById('sp-panel-mgr')}
        return mgr;
    }
    function closePanelMgr(){
        const mgr=document.getElementById('sp-panel-mgr');
        if(mgr)mgr.remove();
    }
    // Create a temp custom panel for the tour
    let _tourPanelCreated=false;
    function createTourPanel(){
        const s=getSettings();
        if(!s.customPanels)s.customPanels=[];
        s.customPanels.push({name:t('RPG Stats (Tour Example)'),fields:[
            {key:'health',label:t('Health'),type:'meter',desc:"{{user}}'s health 0-100"},
            {key:'mana',label:t('Mana'),type:'meter',desc:"Mana remaining after spellcasting"},
            {key:'reputation',label:t('Reputation'),type:'text',desc:"Standing with the local guild"}
        ]});
        _tourPanelCreated=true;
        saveSettings();
        // Re-render the custom panels section in the manager
        const cpList=document.getElementById('sp-panel-mgr-custom');
        const body=document.getElementById('sp-panel-body');
        if(cpList&&body)renderCustomPanelsMgr(s,cpList,body);
    }
    function removeTourPanel(){
        if(!_tourPanelCreated)return;
        const s=getSettings();
        const idx=(s.customPanels||[]).findIndex(p=>p.name===t('RPG Stats (Tour Example)'));
        if(idx>=0){s.customPanels.splice(idx,1);saveSettings()}
        _tourPanelCreated=false;
    }
    let _ghostWasOn=false;
    const _isMobile=spDetectMode()==='mobile';
    let steps=[
        {title:t('Welcome to ScenePulse'),desc:t('ScenePulse tracks characters, relationships, quests, and story state automatically. This tour loads <strong>example data</strong> so you can inspect every feature.'),sel:'.sp-toolbar',pos:'below'},
        {title:t('The Dashboard'),desc:t('Shows time, date, location, weather, and temperature. Use edit mode to correct values manually.'),sel:'.sp-env-permanent',pos:'below'},
        {title:t('Toolbar Controls'),desc:t('Toolbar buttons control regeneration, panels, section expansion, visual features, thoughts, and manual editing.'),sel:'.sp-toolbar',pos:'below'},
        {title:t('Scene Details'),desc:t('Tracks mood, tension, topic, interaction, and sounds. The header badge shows the current mood.'),sel:'[data-key="scene"]',pos:'below',open:'scene'},
        {title:t('Quest Journal'),desc:_i.star+' '+t('<strong>North Star</strong> — life purpose')+'<br>'+_i.main+' '+t('<strong>Main Quests</strong> — primary story arcs')+'<br>'+_i.side+' '+t('<strong>Side Quests</strong> — optional parallel paths')+'<br><br>'+t('Quests persist across scenes and can be collapsed independently.'),sel:'[data-key="quests"]',pos:_isMobile?'below':'left',open:'quests'},
        {title:t('Relationships'),desc:_i.heart+' '+t('Affection')+'<br>'+_i.shield+' '+t('Trust')+'<br>'+_i.flame+' '+t('Desire')+'<br>'+_i.bolt+' '+t('Stress')+'<br>'+_i.compat+' '+t('Compatibility')+'<br><br>'+t('Arrows show changes; the white marker shows the previous value.'),sel:'[data-key="relationships"]',pos:_isMobile?'below':'left',open:'relationships'},
        {title:t('Characters'),desc:t('Character profiles show appearance, outfit, inventory, goals, and current state.'),sel:'[data-key="characters"]',pos:_isMobile?'below':'left',open:'characters'},
        {title:t('Story Ideas'),desc:t('Five AI-generated plot directions appear after each update. Expand, edit, or send one to the chat.'),sel:'[data-key="branches"]',pos:_isMobile?'below':'left',open:'branches'},
    ];
    // Desktop-only steps
    if(!_isMobile){
        steps.push(
            {title:t('Inner Thoughts'),desc:t('A floating panel with each character’s inner monologue. Drag to move it and resize it from the corner.'),sel:'#sp-thought-panel',pos:'right',
                before:()=>{const tp=document.getElementById('sp-thought-panel');if(tp){_ghostWasOn=tp.classList.contains('sp-tp-ghost');tp.classList.remove('sp-tp-ghost')}}},
            {title:t('Thoughts Controls'),desc:t('Thought controls let you dock the panel, enable ghost mode, regenerate thoughts, or hide it.'),sel:'#sp-thought-panel .sp-tp-header',pos:'below',
                after:()=>{if(_ghostWasOn){const tp=document.getElementById('sp-thought-panel');if(tp)tp.classList.add('sp-tp-ghost')}}}
        );
    }
    steps.push(
        {title:t('Timeline Scrubber'),desc:t('Every tracked AI message creates a snapshot. Select a timeline dot to restore that moment and compare how the scene evolved.'),center:true},
        {title:t('Panel Manager'),desc:t('Enable or disable built-in panels and individual fields. Disabled data is excluded from the tracker prompt and saves tokens.'),sel:'#sp-panel-mgr',pos:_isMobile?'below':'left',
            before:()=>{openPanelMgr()},after:()=>{closePanelMgr()}},
        {title:t('Custom Panels'),desc:t('Create panels for any state such as health, mana, reputation, or faction standing. Each field has a key, label, type, and instruction for the LLM.'),sel:'#sp-panel-mgr-custom',pos:_isMobile?'below':'left',
            before:()=>{
                openPanelMgr();
                createTourPanel();
                setTimeout(()=>{const el=document.getElementById('sp-panel-mgr-custom');if(el)el.scrollIntoView({behavior:'smooth',block:'nearest'})},150);
            },
            after:()=>{removeTourPanel();closePanelMgr()}},
        {title:t('⚠ Performance Tip'),desc:t('More panels require more tokens and increase generation time. Disable unused panels, reduce custom fields, or lower context messages in Separate mode.'),sel:'#sp-panel-mgr',pos:_isMobile?'below':'left',warn:true,
            before:()=>{openPanelMgr()},after:()=>{closePanelMgr()}},
        {title:t('Feedback & Issues'),desc:t('Found a bug or have a suggestion? Report it on GitHub:')+'<br><br><a href="https://github.com/xenofei" target="_blank" rel="noopener" style="color:var(--sp-accent);text-decoration:underline;font-weight:600">github.com/xenofei</a>',center:true},
        {title:t('Thank You!'),desc:'<div style="text-align:center"><span class="sp-tour-finale-pulse">'+MASCOT_SVG+'</span></div><div class="sp-tour-finale-glow">'+t('Every scene has a pulse. Now you can feel it.')+'</div><br>'+t('Thank you for trying <strong>ScenePulse</strong>. Your story matters — make it unforgettable.'),center:true}
    );
    let step=0;let _prevAfter=null;
    const spotlight=document.createElement('div');spotlight.className='sp-tour-spotlight';
    const card=document.createElement('div');card.className='sp-tour-card';
    document.body.appendChild(spotlight);document.body.appendChild(card);
    function renderStep(){
        if(_prevAfter){_prevAfter();_prevAfter=null}
        const s=steps[step];
        if(s.before)s.before();
        if(s.after)_prevAfter=s.after;
        collapseAll();
        if(s.open)openSection(s.open);
        card.className='sp-tour-card'+(s.warn?' sp-tour-warn':'');
        const isLast=step===steps.length-1;const isFirst=step===0;
        let pips='';for(let i=0;i<steps.length;i++)pips+=`<span class="sp-tour-pip${i===step?' sp-active':''}"></span>`;
        card.innerHTML=`<div class="sp-tour-step-label">Step ${step+1} of ${steps.length}</div><div class="sp-tour-title">${s.title}</div><div class="sp-tour-desc">${s.desc}</div><div class="sp-tour-nav">${isFirst?'':'<button class="sp-tour-btn" data-prev>\u2190 Back</button>'}<button class="sp-tour-btn sp-tour-btn-end" data-end>Skip</button><div class="sp-tour-progress">${pips}</div>${isLast?'<button class="sp-tour-btn sp-tour-btn-next" data-done>\u2713 Finish</button>':'<button class="sp-tour-btn sp-tour-btn-next" data-next>Next \u2192</button>'}</div>`;
        card.querySelector('.sp-tour-step-label').textContent=t('Step {current} of {total}',{current:step+1,total:steps.length});
        const prevBtn=card.querySelector('[data-prev]');if(prevBtn)prevBtn.textContent='← '+t('Back');
        const endBtn=card.querySelector('[data-end]');if(endBtn)endBtn.textContent=t('Skip');
        const doneBtn=card.querySelector('[data-done]');if(doneBtn)doneBtn.textContent='✓ '+t('Finish');
        const nextBtn=card.querySelector('[data-next]');if(nextBtn)nextBtn.textContent=t('Next')+' →';
        // Delay positioning to allow DOM updates (panel mgr open, scroll, etc.)
        if(s.center){
            // No spotlight, center card on screen
            spotlight.style.display='none';
            setTimeout(()=>{
                const cw=_isMobile?Math.min(340,window.innerWidth-16):340;
                const ch=card.offsetHeight||250;
                card.style.left=Math.max(8,(window.innerWidth-cw)/2)+'px';
                card.style.top=Math.max(8,(window.innerHeight-ch)/2)+'px';
                if(_isMobile)card.style.width=cw+'px';
            },100);
        } else {
        setTimeout(()=>{
            const el=s.sel?document.querySelector(s.sel):null;
            if(el){
                el.scrollIntoView({behavior:'smooth',block:'nearest'});
                setTimeout(()=>{
                    const r=el.getBoundingClientRect();const pad=8;
                    spotlight.style.left=(r.left-pad)+'px';spotlight.style.top=(r.top-pad)+'px';
                    spotlight.style.width=(r.width+pad*2)+'px';spotlight.style.height=(r.height+pad*2)+'px';
                    spotlight.style.display='block';
                    const cw=_isMobile?Math.min(320,window.innerWidth-16):340;
                    const ch=card.offsetHeight||250;
                    if(_isMobile){
                        // Mobile: card always below spotlight, centered
                        const cy=Math.min(r.bottom+12,window.innerHeight-ch-8);
                        card.style.left=Math.max(8,(window.innerWidth-cw)/2)+'px';
                        card.style.top=Math.max(8,cy)+'px';
                        card.style.width=cw+'px';
                    } else {
                    const spB=window.innerHeight-r.bottom,spA=r.top,spR=window.innerWidth-r.right,spL=r.left;
                    let cx,cy;
                    if(s.pos==='left'&&spL>cw+20){cx=r.left-cw-14;cy=Math.max(8,r.top)}
                    else if(s.pos==='right'&&spR>cw+20){cx=r.right+14;cy=Math.max(8,r.top)}
                    else if(s.pos==='above'&&spA>ch+20){cx=Math.max(8,Math.min(r.left,window.innerWidth-cw-8));cy=r.top-ch-14}
                    else if(spB>ch+20){cx=Math.max(8,Math.min(r.left,window.innerWidth-cw-8));cy=r.bottom+14}
                    else if(spA>ch+20){cx=Math.max(8,Math.min(r.left,window.innerWidth-cw-8));cy=r.top-ch-14}
                    else if(spL>cw+20){cx=r.left-cw-14;cy=Math.max(8,r.top)}
                    else if(spR>cw+20){cx=r.right+14;cy=Math.max(8,r.top)}
                    else{cx=Math.max(8,window.innerWidth-cw-8);cy=8}
                    if(cy+ch>window.innerHeight-8)cy=window.innerHeight-ch-8;
                    if(cy<8)cy=8;if(cx<8)cx=8;
                    card.style.left=cx+'px';card.style.top=cy+'px';
                    }
                },250);
            } else spotlight.style.display='none';
        },200);
        }
    }
    function cleanup(){
        if(_prevAfter){_prevAfter();_prevAfter=null}
        removeTourPanel();closePanelMgr();spotlight.remove();card.remove();collapseAll();
        if(_savedData){setCurrentSnapshotMesIdx(_savedMesIdx);updatePanel(_savedData)} else {
            const body=document.getElementById('sp-panel-body');
            if(body)body.innerHTML='<div class="sp-empty-state"><div class="sp-empty-icon">\u2726</div><div class="sp-empty-title">Ready to Go</div><div class="sp-empty-text">Send your first message to start tracking.</div></div>';
        }
        const emptyBody=document.getElementById('sp-panel-body');
        if(emptyBody&&!_savedData){const title=emptyBody.querySelector('.sp-empty-title');const text=emptyBody.querySelector('.sp-empty-text');if(title)title.textContent=t('Ready to Go');if(text)text.textContent=t('Send your first message to start tracking.')}
        renderTimeline();
    }
    card.addEventListener('click',(e)=>{
        if(e.target.closest('[data-next]')){step++;renderStep()}
        else if(e.target.closest('[data-prev]')){step--;renderStep()}
        else if(e.target.closest('[data-done]')||e.target.closest('[data-end]'))cleanup();
    });
    renderStep();
}
