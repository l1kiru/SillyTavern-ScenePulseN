// ScenePulse — Setup Guide Module
// Extracted from index.js lines 4588-4717

import { MASCOT_SVG } from '../constants.js';
import { getSettings, saveSettings, getConnectionProfiles, getChatPresets } from '../settings.js';
import { esc } from '../utils.js';
import { spDetectMode } from '../ui/mobile.js';
import { loadUI } from './bind-ui.js';
import { _spSaveLS } from './bind-ui.js';
import { startGuidedTour } from './guided-tour.js';
import { t } from '../i18n.js';

export function showSetupGuide(){
    // Remove any existing guide
    document.getElementById('sp-setup-overlay')?.remove();
    const s=getSettings();
    const profiles=getConnectionProfiles();
    const presets=getChatPresets();
    const hasProfiles=profiles.length>0;
    const hasFallbackProfile=!!s.fallbackProfile;

    const _setupMobile=spDetectMode()==='mobile';
    const ov=document.createElement('div');ov.id='sp-setup-overlay';ov.className='sp-setup-overlay';
    ov.innerHTML=`
    <div class="sp-setup-dialog">
        <div class="sp-setup-header">
            <div class="sp-setup-icon">${MASCOT_SVG}</div>
            <div class="sp-setup-title">Scene<span style="color:var(--sp-accent)">Pulse</span> ${t('Setup')}</div>
            <button class="sp-setup-close" title="${t('Close')}">✕</button>
        </div>
        <div class="sp-setup-body" id="sp-setup-body">
            <div class="sp-setup-step sp-setup-active" data-step="1">
                <div class="sp-setup-step-num">1</div>
                <div class="sp-setup-step-content">
                    <div class="sp-setup-step-title">${t('How ScenePulse Works')}</div>
                    <p>${t('ScenePulse uses <strong>Together mode</strong> by default — the AI appends scene-tracking JSON to every response. This is fast, inexpensive, and accurate.')}</p>
                    <p>${t('Some models occasionally omit tracker data. ScenePulse can then <strong>automatically recover</strong> it with a separate API call.')}</p>
                    ${_setupMobile?`<p style="color:var(--sp-text-dim);font-size:12px"><em>${t('On mobile, desktop-only visual features are hidden and become available again on desktop.')}</em></p>`:''}
                    <p>${t('This guide configures that recovery path so scene data is not lost.')}</p>
                    <div class="sp-setup-compat">
                        <div class="sp-setup-compat-title">${t('Model Compatibility (April 2026)')}</div>
                        <div class="sp-setup-compat-tier"><span style="color:var(--sp-green)">${t('Recommended:')}</span> Claude Opus 4.6 / Sonnet 4.6, GPT-5.4, Gemini 3.1 Pro / 3 Flash, Grok 4, GLM-5.1</div>
                        <div class="sp-setup-compat-tier"><span style="color:var(--sp-amber)">${t('Compatible:')}</span> DeepSeek V3.2, Mistral Large 3, Qwen 3 32B+, Llama 4 Maverick/Scout, Gemini 3.1 Flash-Lite, GPT-4.1 mini</div>
                        <div class="sp-setup-compat-tier"><span style="color:var(--sp-red)">${t('Not recommended:')}</span> ${t('Models under 14B parameters or heavily quantized (Q3/Q2)')}</div>
                        <div class="sp-setup-compat-note">${t('For local models, prefer Q5_K_M+ quantization. Consider Separate mode for models under 32B.')}</div>
                    </div>
                    <div class="sp-setup-nav"><button class="sp-setup-btn sp-setup-btn-primary" data-goto="2">${t('Next')} →</button><button class="sp-setup-btn sp-setup-btn-skip" data-dismiss="true">${t('Skip setup')}</button></div>
                </div>
            </div>
            <div class="sp-setup-step" data-step="2">
                <div class="sp-setup-step-num">2</div>
                <div class="sp-setup-step-content">
                    <div class="sp-setup-step-title">${t('Create a Connection Profile')}</div>
                    <p>${t('Recovery uses a SillyTavern <strong>Connection Profile</strong> for its separate API call. You can select an existing profile.')}</p>
                    <p>${t('To create a new one:')}</p>
                    <div class="sp-setup-instructions">
                        <div class="sp-setup-inst">${t("1. Open SillyTavern's <strong>API Connections</strong> panel (plug icon)")}</div>
                        <div class="sp-setup-inst">${t('2. Configure your API provider and model')}</div>
                        <div class="sp-setup-inst">${t('3. Open the <strong>connection profile</strong> list and choose <strong>Create New</strong>')}</div>
                        <div class="sp-setup-inst">${t('4. Give it a name such as <em>ScenePulse Tracker</em>')}</div>
                        <div class="sp-setup-inst">${t('5. Save the profile')}</div>
                    </div>
                    ${hasProfiles?`<p style="color:var(--sp-green)">✓ ${t('Available connection profiles: {count}',{count:profiles.length})}</p>`:`<p style="color:var(--sp-amber)">⚠ ${t('No connection profiles found. Create one in SillyTavern first.')}</p>`}
                    <div class="sp-setup-nav"><button class="sp-setup-btn" data-goto="1">← ${t('Back')}</button><button class="sp-setup-btn sp-setup-btn-primary" data-goto="3">${t('Next')} →</button></div>
                </div>
            </div>
            <div class="sp-setup-step" data-step="3">
                <div class="sp-setup-step-num">3</div>
                <div class="sp-setup-step-content">
                    <div class="sp-setup-step-title">${t('Select Your Recovery Profile')}</div>
                    <p>${t('Choose the connection profile ScenePulse should use when tracker data is missing:')}</p>
                    <div class="sp-setup-select-wrap">
                        <select id="sp-setup-fb-profile" class="sp-setup-select">
                            <option value="">${t('(Same as current — no dedicated profile)')}</option>
                            ${profiles.map(p=>`<option value="${esc(p.id)}"${p.id===s.fallbackProfile?' selected':''}>${esc(p.name)}</option>`).join('')}
                        </select>
                    </div>
                    <p>${t('Optionally select a different preset for tracker generation. <strong>(Same as current)</strong> keeps the active preset unchanged.')}</p>
                    <div class="sp-setup-select-wrap">
                        <select id="sp-setup-fb-preset" class="sp-setup-select">
                            <option value="">${t('(Same as current)')}</option>
                            ${presets.map(p=>`<option value="${esc(p.id)}"${p.id===s.fallbackPreset?' selected':''}>${esc(p.name)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="sp-setup-note">${t('A different preset is selected temporarily during tracker generation and restored afterwards.')}</div>
                    <div class="sp-setup-nav"><button class="sp-setup-btn" data-goto="2">← ${t('Back')}</button><button class="sp-setup-btn sp-setup-btn-primary" data-goto="4">${t('Next')} →</button></div>
                </div>
            </div>
            <div class="sp-setup-step" data-step="4">
                <div class="sp-setup-step-num">4</div>
                <div class="sp-setup-step-content">
                    <div class="sp-setup-step-title">${t('Recovery Preference')}</div>
                    <p>${t('When tracker data is missing, should ScenePulse run a separate API call automatically?')}</p>
                    <label class="sp-setup-radio"><input type="radio" name="sp-setup-fb-enable" value="yes" ${s.fallbackEnabled!==false?'checked':''}> <strong>${t('Yes')}</strong> — ${t('recover missing tracker data automatically')} <span style="color:var(--sp-text-dim)">${t('(recommended)')}</span></label>
                    <label class="sp-setup-radio"><input type="radio" name="sp-setup-fb-enable" value="no" ${s.fallbackEnabled===false?'checked':''}> <strong>${t('No')}</strong> — ${t('regenerate manually when needed')}</label>
                    <div class="sp-setup-note" id="sp-setup-no-warn" style="display:${s.fallbackEnabled===false?'block':'none'};color:var(--sp-amber)">${t('With automatic recovery disabled, use the ⟳ button to regenerate missing scene data manually.')}</div>
                    <div class="sp-setup-nav"><button class="sp-setup-btn" data-goto="3">← ${t('Back')}</button><button class="sp-setup-btn sp-setup-btn-primary" data-goto="5">${t('Next')} →</button></div>
                </div>
            </div>
            <div class="sp-setup-step" data-step="5">
                <div class="sp-setup-step-num">5</div>
                <div class="sp-setup-step-content">
                    <div class="sp-setup-step-title">${t('Model discovery overlay')} <span style="color:var(--sp-text-dim);font-size:11px;font-weight:normal">${t('(optional)')}</span></div>
                    <p>${t('Show current OpenRouter pricing, context windows, and roleplay popularity while browsing templates. This is read-only and does not change prompts, samplers, or generation.')}</p>
                    <label class="sp-setup-radio"><input type="radio" name="sp-setup-or-enable" value="yes" ${s.orConnectorEnabled?'checked':''}> <strong>${t('Yes')}</strong> — ${t('show live model data while browsing templates')} <span style="color:var(--sp-text-dim)">${t('(~30 KB, cached 24 h)')}</span></label>
                    <label class="sp-setup-radio"><input type="radio" name="sp-setup-or-enable" value="no" ${!s.orConnectorEnabled?'checked':''}> <strong>${t('No')}</strong> — ${t('keep the static baseline only')} <span style="color:var(--sp-text-dim)">${t('(default)')}</span></label>
                    <div class="sp-setup-note" style="margin-top:6px;color:var(--sp-text-dim)">${t('Public endpoint, no authorization, no telemetry. You can change this later under Settings → Generation.')}</div>
                    <div class="sp-setup-tips">
                        <div class="sp-setup-tips-title">${t('Tips & Hidden Features')}</div>
                        <div class="sp-setup-tip">${t('Type <strong>/sp help</strong> to list every slash command.')}</div>
                        <div class="sp-setup-tip">${t('Use the <strong>book icon</strong> to open the Character Wiki with every character who has appeared.')}</div>
                        <div class="sp-setup-tip">${t('Use the <strong>pencil icon</strong> to edit tracker fields manually.')}</div>
                        <div class="sp-setup-tip">${t('Open the Character Wiki and its graph button to view the Relationship Web.')}</div>
                        <div class="sp-setup-tip">${t('Use <strong>Custom Panels</strong> to track health, mana, reputation, inventory, or any other state.')}</div>
                    </div>
                    <div class="sp-setup-nav"><button class="sp-setup-btn" data-goto="4">← ${t('Back')}</button><button class="sp-setup-btn sp-setup-btn-primary sp-setup-btn-finish" data-finish="true">✓ ${t('Finish Setup')}</button></div>
                    <div style="text-align:center;margin-top:8px"><button class="sp-setup-btn sp-setup-btn-tour" data-tour="true">✦ ${t('Take a Guided Tour')}</button></div>
                </div>
            </div>
        </div>
        <div class="sp-setup-progress">
            <div class="sp-setup-dots"><span class="sp-setup-dot sp-dot-active" data-dot="1"></span><span class="sp-setup-dot" data-dot="2"></span><span class="sp-setup-dot" data-dot="3"></span><span class="sp-setup-dot" data-dot="4"></span><span class="sp-setup-dot" data-dot="5"></span></div>
        </div>
    </div>`;
    document.body.appendChild(ov);

    // Navigation
    let currentStep=1;
    function goToStep(n){
        currentStep=n;
        ov.querySelectorAll('.sp-setup-step').forEach(s=>{s.classList.toggle('sp-setup-active',+s.dataset.step===n)});
        ov.querySelectorAll('.sp-setup-dot').forEach(d=>{d.classList.toggle('sp-dot-active',+d.dataset.dot===n)});
    }
    ov.addEventListener('click',(e)=>{
        const btn=e.target.closest('[data-goto]');
        if(btn)goToStep(+btn.dataset.goto);
        if(e.target.closest('.sp-setup-close')||e.target.closest('[data-dismiss]')){
            s.setupDismissed=true;saveSettings();ov.remove();
        }
        if(e.target.closest('[data-finish]')){
            // Save selections
            const prof=ov.querySelector('#sp-setup-fb-profile')?.value||'';
            const pre=ov.querySelector('#sp-setup-fb-preset')?.value||'';
            const enabled=ov.querySelector('input[name="sp-setup-fb-enable"]:checked')?.value!=='no';
            // v6.27.0: OR connector opt-in choice from step 5
            const orEnabled=ov.querySelector('input[name="sp-setup-or-enable"]:checked')?.value==='yes';
            s.fallbackProfile=prof;s.fallbackPreset=pre;s.fallbackEnabled=enabled;s.setupDismissed=true;
            s.orConnectorEnabled=orEnabled;s._spOrConnectorPromptShown=true;
            saveSettings();_spSaveLS();loadUI();
            ov.remove();
            if(enabled&&prof)toastr.success(t('Recovery configured with profile: {profile}',{profile:prof}),t('ScenePulse Setup'));
            else if(enabled)toastr.info(t('Automatic recovery enabled with the current profile'),t('ScenePulse Setup'));
            else toastr.info(t('Automatic recovery disabled — use ⟳ manually'),t('ScenePulse Setup'));
        }
        const dot=e.target.closest('.sp-setup-dot');
        if(dot)goToStep(+dot.dataset.dot);
        if(e.target.closest('[data-tour]')){
            const prof=ov.querySelector('#sp-setup-fb-profile')?.value||'';
            const pre=ov.querySelector('#sp-setup-fb-preset')?.value||'';
            const enabled=ov.querySelector('input[name="sp-setup-fb-enable"]:checked')?.value!=='no';
            const orEnabled=ov.querySelector('input[name="sp-setup-or-enable"]:checked')?.value==='yes';
            s.fallbackProfile=prof;s.fallbackPreset=pre;s.fallbackEnabled=enabled;s.setupDismissed=true;
            s.orConnectorEnabled=orEnabled;s._spOrConnectorPromptShown=true;
            saveSettings();_spSaveLS();loadUI();ov.remove();
            startGuidedTour();
        }
    });
    // Radio toggle for warning
    ov.querySelectorAll('input[name="sp-setup-fb-enable"]').forEach(r=>r.addEventListener('change',()=>{
        ov.querySelector('#sp-setup-no-warn').style.display=r.value==='no'?'block':'none';
    }));
}
