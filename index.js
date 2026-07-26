// ScenePulse — Modular Architecture
// Thin entry point: imports, event wiring, globalThis export

// ── Foundation ──
import { VERSION } from './src/constants.js';
import { log, warn, err, setErrorListener } from './src/logger.js';
import { installCrashLog } from './src/crash-log.js';

// ── Core Logic ──
import {
    generating, genNonce, genMeta,
    inlineGenStartMs,
    inlineExtractionDone,
    inlineGenerationContext,
    pendingInlineIdx,
    setGenerating, setGenNonce, setCancelRequested, setCurrentSnapshotMesIdx,
    setInlineGenStartMs,
    setPendingInlineIdx, setInlineExtractionDone, setInlineGenerationContext,
    set_cachedNormData,
    setPrevLocation, setPrevTimePeriod,
    resetSessionTokens,
    _inlineWaitTimerId, set_inlineWaitTimerId,
    getActivePromptInjectionRun,
    getPromptAbortReason, clearPromptAbortReason,
} from './src/state.js';
import {
    getSettings, anyPanelsActive,
    getLatestSnapshot, getLatestSnapshotEntry, getActiveSwipeId, getTrustedSnapshotFor,
    ensureChatSaved, invalidateSettingsCache, forceFullStateRefresh
} from './src/settings.js';
import { normalizeTracker, clearNormCache } from './src/normalize.js';
import { resetColorMap } from './src/color.js';
import { initI18n } from './src/i18n.js';

// ── Generation ──
import { extractInlineTracker } from './src/generation/extraction.js';
import { noteStreamingText, stopStreamingHider } from './src/generation/streaming.js';
import { cancelGeneration } from './src/generation/engine.js';
import { scenePulseInterceptor, noteStreamProgress, clearStallWatchdog } from './src/generation/interceptor.js';
import { rebindInlineCtxForExpectedSwipe } from './src/generation/inline-ctx.js';
import { processTogetherExtraction, discardTogetherSceneBuild } from './src/generation/together-scene-build.js';
import {
    cancelTogetherSceneBuilds, cancelSceneBuildsForChat, disposeSceneBuilds,
    supersedeSceneBuildsForMessageExceptSwipe,
} from './src/generation/scene-build-controller.js';
import { currentChatKey } from './src/message-fingerprint.js';
import { initSceneBuildUi, reconcileSceneBuildUi, runManualSceneBuild } from './src/ui/scene-build-ui.js';
import {
    recordWorldInfoActivation,
    recordWorldInfoScanDone,
    recordWorldInfoEntriesLoaded,
    recordWorldInfoForceActivate,
    recordPromptReady,
    recordTextCompletionPrompt,
    cancelSceneSourceTrace,
} from './src/scene-source-trace.js';
import {
    shouldHandlePromptHook,
    materializePromptInjection,
    verifyPromptInjection,
    commitVerifiedFootprint,
    abortPromptInjection,
    clearPromptInjection,
    setAuthorityReposition,
    restorePromptInjection,
    getSuspendDepth,
} from './src/generation/prompt-injection.js';

// ── UI ──
import { spSetGenerating } from './src/ui/mobile.js';
import { createPanel } from './src/ui/panel.js';
import { renderEmptyState } from './src/ui/empty-state.js';
import { updatePanel } from './src/ui/update-panel.js';
import { clearWeatherOverlay } from './src/ui/weather.js';
import { clearTimeTint } from './src/ui/time-tint.js';
import { onCharMsg, renderExisting, onMessageSwiped, spOnMessageDeleted, spOnSwipeDeleted } from './src/ui/message.js';
import { cleanupGenUI, clearThoughtLoading } from './src/ui/loading.js';
import { updateThoughts } from './src/ui/thoughts.js';
import { invalidateCharacterHistory } from './src/ui/character-history.js';

// ── Settings UI ──
import { createSettings } from './src/settings-ui/create-settings.js';
import { loadUI } from './src/settings-ui/bind-ui.js';
import { showSetupGuide } from './src/settings-ui/setup-guide.js';
import { checkForUpdate, showUpdateBadge, showUpdateBanner } from './src/update-check.js';

// ── Slash Commands & Macros ──
import { registerSlashCommands } from './src/slash-commands.js';
import { registerMacros } from './src/macros.js';

// ── Register interceptor on globalThis (required by manifest.json "generate_interceptor") ──
globalThis.scenePulseInterceptor = scenePulseInterceptor;

// ── Wire SillyTavern Events ──
const { eventSource, event_types } = SillyTavern.getContext();
let _lastSceneBuildChatKey = '';
try { _lastSceneBuildChatKey = currentChatKey(); } catch {}
const _knownSwipeIds=new Map();
function _rememberSwipeIds(){
    _knownSwipeIds.clear();
    const chat=SillyTavern.getContext().chat||[];
    for(let i=0;i<chat.length;i++)if(!chat[i]?.is_user)_knownSwipeIds.set(i,Math.max(0,Number(chat[i]?.swipe_id??0)||0));
}
_rememberSwipeIds();
let _pendingActiveSwipeDeletion=null;

eventSource.on(event_types.APP_READY, async () => { try {
    log('APP_READY: start');
    // v6.12.5 (issue #13): install crash-log capture EARLY so any
    // failure during the rest of APP_READY is recorded.
    try { await installCrashLog({ spVersion: VERSION, setErrorListener }); log('APP_READY: crash log ok'); }
    catch (e) { warn('Crash log install failed:', e?.message); }
    // v6.9.10: AWAIT initI18n so t() calls during panel/settings
    // construction have translations ready. Without await, non-English
    // users saw an English flash on every page load because the async
    // fetch hadn't completed before createPanel()/createSettings() ran.
    try { await initI18n(); log('APP_READY: i18n ok'); } catch { /* degrade to English */ }
    createPanel(); log('APP_READY: panel ok');
    try { initSceneBuildUi(); log('APP_READY: scene-build UI ok'); } catch (e) { warn('SceneBuild UI:', e); }
    createSettings(); log('APP_READY: settings ok');
    // Register slash commands & macros
    try { registerSlashCommands(); log('APP_READY: slash commands ok'); } catch (e) { warn('Slash commands:', e); }
    try { registerMacros(); log('APP_READY: macros ok'); } catch (e) { warn('Macros:', e); }
    // Delayed retry: ST may populate profile dropdowns after our init
    setTimeout(() => { try { loadUI(); log('APP_READY: delayed profile refresh'); } catch (e) {} }, 2000);
    renderExisting(); log('APP_READY: render ok');
    // First-run: show setup guide if not dismissed
    const _s = getSettings();
    if (!_s.setupDismissed) {
        setTimeout(() => showSetupGuide(), 2000);
    }
    log('v' + VERSION + ' ready');
    // v6.20.0: lazy-import the preset suggestion module + check the active
    // model. Defers ~3s after APP_READY so it doesn't compete with the
    // setup guide or initial render. The toast itself is already gated by
    // session + permanent-dismissal storage so it's quiet when unwanted.
    setTimeout(() => {
        import('./src/ui/preset-suggestion.js')
            .then(m => m.maybeSuggestPreset?.())
            .catch(e => warn('preset-suggestion:', e?.message || e));
    }, 3000);
    // v6.27.0: one-time prompt for the OpenRouter stats connector. Fires
    // for existing users who already dismissed the setup wizard before
    // step 5 existed — the wizard handles new installs. Gated by
    // `_spOrConnectorPromptShown` so it never re-prompts. Skipped for
    // fresh installs (the wizard's step 5 handles them).
    // v6.27.1: dedicated visual treatment via or-connector-prompt module.
    setTimeout(async () => {
        try {
            const _s = getSettings();
            if (_s._spOrConnectorPromptShown || !_s.setupDismissed) return;
            const { showOrConnectorPrompt } = await import('./src/ui/or-connector-prompt.js');
            const ok = await showOrConnectorPrompt();
            _s.orConnectorEnabled = !!ok;
            _s._spOrConnectorPromptShown = true;
            try { (await import('./src/settings.js')).saveSettings(); } catch {}
            try { (await import('./src/settings-ui/bind-ui.js')).loadUI(); } catch {}
        } catch (e) { warn('or-connector prompt:', e?.message || e); }
    }, 4500);
    // Apply saved theme
    try {
        const _ts = getSettings();
        if (_ts.theme && _ts.theme !== 'default') {
            import('./src/themes.js').then(m => m.applyTheme(_ts.theme)).catch(() => {});
        }
    } catch {}
    // Register regex script to hide tracker JSON from DOM display.
    // markdownOnly:true = only runs during markdown rendering (display), NOT on raw msg.mes.
    // This is the same approach used by RPG Companion and Dooms Enhancement Suite.
    try {
        const _ctx = SillyTavern.getContext();
        if (_ctx.extensionSettings) {
            if (!_ctx.extensionSettings.regex) _ctx.extensionSettings.regex = [];
            // Remove old broken version (v5.9.0 had markdownOnly:false which stripped msg.mes)
            const _oldIdx = _ctx.extensionSettings.regex.findIndex(r => r.scriptName === 'ScenePulse Tracker Hider');
            if (_oldIdx !== -1) _ctx.extensionSettings.regex.splice(_oldIdx, 1);
            // Register with markdownOnly:true — cleans display but preserves msg.mes for extraction
            _ctx.extensionSettings.regex.push({
                scriptName: 'ScenePulse Tracker Hider',
                findRegex: '<!--SP_TRACKER_START-->[\\s\\S]*?(<!--SP_TRACKER_END-->|$)|\\{\\{//SP_TRACKER_START\\}\\}[\\s\\S]*?(\\{\\{//SP_TRACKER_END\\}\\}|$)|\\[SCENE TRACKER[^\\]]*\\][\\s\\S]*$|\\{\\s*"time"\\s*:\\s*"\\d{1,2}:\\d{2}[\\s\\S]*$',
                replaceString: '',
                trimStrings: [],
                placement: [2],
                disabled: false,
                markdownOnly: true,
                promptOnly: false,
                runOnEdit: true,
                substituteRegex: 0,
            });
            log('Registered ST regex filter (markdownOnly) for tracker hiding');
        }
    } catch (e) { warn('Could not register regex filter:', e); }
    // Check for updates (non-blocking)
    setTimeout(async () => {
        try {
            const info = await checkForUpdate();
            if (info) {
                const branchEl = document.getElementById('sp-branch-info');
                if (branchEl) branchEl.textContent = `${info.branch} · ${info.commit}`;
                if (!info.isUpToDate) { showUpdateBadge(); showUpdateBanner(); }
            }
        } catch (e) {}
    }, 3000);
} catch (e) { err('APP_READY:', e); } });

eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, idx => {
    const id=Number(idx);const message=SillyTavern.getContext().chat?.[id];
    if(message)_knownSwipeIds.set(id,Math.max(0,Number(message.swipe_id??0)||0));
    onCharMsg(idx);
    try{reconcileSceneBuildUi()}catch{}
});

// v6.27.16: stream-stall detector. Each token received refreshes the
// stall watchdog (see src/generation/interceptor.js). When the stream
// goes silent for 15s mid-generation (or 90s before any token), the
// watchdog force-resets state — much faster than the v6.27.14 blanket
// 180s timeout. Only fires for inline/together-mode generations
// because the watchdog is keyed on inlineGenStartMs.
eventSource.on(event_types.STREAM_TOKEN_RECEIVED, text => {
    try { noteStreamProgress(); } catch {}
    // ST emits cumulative stream text before painting it. Lock the message at
    // its last safe height as soon as the tracker marker begins.
    try { noteStreamingText(text); } catch {}
});

function _sceneSourceTraceGate() {
    const s = getSettings();
    return !!(s.enabled && s.injectionMethod === 'inline' && s.sceneSourceTrace === true && inlineGenStartMs > 0 && inlineGenerationContext);
}

if (event_types.WORLD_INFO_ACTIVATED) {
    eventSource.on(event_types.WORLD_INFO_ACTIVATED, payload => {
        try {
            if (!_sceneSourceTraceGate()) return;
            recordWorldInfoActivation(payload);
        } catch {}
    });
}
if (event_types.WORLDINFO_SCAN_DONE) {
    eventSource.on(event_types.WORLDINFO_SCAN_DONE, args => {
        try {
            if (!_sceneSourceTraceGate()) return;
            recordWorldInfoScanDone(args);
        } catch {}
    });
}
if (event_types.WORLDINFO_ENTRIES_LOADED) {
    eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, payload => {
        try {
            if (!_sceneSourceTraceGate()) return;
            recordWorldInfoEntriesLoaded(payload);
        } catch {}
    });
}
if (event_types.WORLDINFO_FORCE_ACTIVATE) {
    eventSource.on(event_types.WORLDINFO_FORCE_ACTIVATE, entries => {
        try {
            if (!_sceneSourceTraceGate()) return;
            recordWorldInfoForceActivate(entries);
        } catch {}
    });
}
if (event_types.CHAT_COMPLETION_PROMPT_READY) {
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, eventData => {
        try {
            if (_sceneSourceTraceGate()) {
                if (!eventData?.dryRun) recordPromptReady(eventData);
            }
            if (!shouldHandlePromptHook(eventData, { requirePhase: 'awaiting-intermediate' })) return;
            if (!(getSettings().enabled && getSettings().injectionMethod === 'inline' && inlineGenStartMs > 0)) return;
            const plan = getActivePromptInjectionRun();
            if (plan?.currentRequest) plan.currentRequest.apiKind = 'chat';
            const mat = materializePromptInjection(eventData);
            if (!mat.ok) {
                abortPromptInjection({
                    code: mat.code || 'SP_PROMPT_INTEGRITY_FAILURE',
                    runId: plan?.runId,
                    observed: mat.observed,
                    detail: mat.detail,
                });
                try { discardTogetherSceneBuild(inlineGenerationContext, 'prompt-integrity'); } catch {}
                try { cancelSceneSourceTrace(); } catch {}
                try { stopStreamingHider({ abort: true }); } catch {}
                try { cleanupGenUI(); } catch {}
                spSetGenerating(false);
                setInlineGenStartMs(0);
                setInlineGenerationContext(null);
            }
        } catch (e) { warn('CHAT_COMPLETION_PROMPT_READY prompt-injection:', e?.message); }
    });
}
if (event_types.GENERATE_AFTER_COMBINE_PROMPTS) {
    eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, eventData => {
        try {
            if (_sceneSourceTraceGate() && !Array.isArray(eventData?.prompt)) {
                recordTextCompletionPrompt(eventData);
            }
            if (Array.isArray(eventData?.prompt)) return;
            if (!shouldHandlePromptHook(eventData, { requirePhase: 'awaiting-intermediate' })) return;
            if (!(getSettings().enabled && getSettings().injectionMethod === 'inline' && inlineGenStartMs > 0)) return;
            const plan = getActivePromptInjectionRun();
            if (plan?.currentRequest) plan.currentRequest.apiKind = 'text';
            const mat = materializePromptInjection(eventData);
            if (!mat.ok) {
                abortPromptInjection({
                    code: mat.code || 'SP_PROMPT_INTEGRITY_FAILURE',
                    runId: plan?.runId,
                    observed: mat.observed,
                    detail: mat.detail,
                });
                try { discardTogetherSceneBuild(inlineGenerationContext, 'prompt-integrity'); } catch {}
                try { cancelSceneSourceTrace(); } catch {}
                try { stopStreamingHider({ abort: true }); } catch {}
                try { cleanupGenUI(); } catch {}
                spSetGenerating(false);
                setInlineGenStartMs(0);
                setInlineGenerationContext(null);
            }
        } catch (e) { warn('GENERATE_AFTER_COMBINE_PROMPTS prompt-injection:', e?.message); }
    });
}

async function _authorityVerify(eventData, authority, apiKind) {
    try {
        if (!shouldHandlePromptHook(eventData)) return;
        if (!(getSettings().enabled && getSettings().injectionMethod === 'inline' && inlineGenStartMs > 0)) return;
        const plan = getActivePromptInjectionRun();
        if (!plan?.currentRequest) return;
        if (plan.currentRequest.phase !== 'materialized' && plan.currentRequest.phase !== 'verified') {
            if (plan.currentRequest.phase === 'awaiting-intermediate') {
                plan.currentRequest.apiKind = apiKind;
                const mat = materializePromptInjection(eventData);
                if (!mat.ok) {
                    abortPromptInjection({
                        code: mat.code || 'SP_PROMPT_INTEGRITY_FAILURE',
                        runId: plan.runId,
                        observed: mat.observed,
                        detail: mat.detail,
                    });
                    try { discardTogetherSceneBuild(inlineGenerationContext, 'prompt-integrity'); } catch {}
                    try { cancelSceneSourceTrace(); } catch {}
                    try { stopStreamingHider({ abort: true }); } catch {}
                    try { cleanupGenUI(); } catch {}
                    spSetGenerating(false);
                    setInlineGenStartMs(0);
                    setInlineGenerationContext(null);
                    return;
                }
            } else {
                return;
            }
        }
        const result = verifyPromptInjection(eventData, { authority });
        if (!result.ok && result.fatal) {
            abortPromptInjection({
                code: result.code || 'SP_PROMPT_INTEGRITY_FAILURE',
                runId: plan.runId,
                observed: result.observed,
            });
            try { discardTogetherSceneBuild(inlineGenerationContext, 'prompt-integrity'); } catch {}
            try { cancelSceneSourceTrace(); } catch {}
            try { stopStreamingHider({ abort: true }); } catch {}
            try { cleanupGenUI(); } catch {}
            spSetGenerating(false);
            setInlineGenStartMs(0);
            setInlineGenerationContext(null);
            return;
        }
        if (result.warning) warn('PromptInjection:', result.warning);
        await commitVerifiedFootprint(plan, { tailFound: !!result.tailFound });
    } catch (e) {
        warn(authority + ' prompt-injection:', e?.message);
    }
}

const _onAuthorityAfterData = (eventData) => { void _authorityVerify(eventData, 'GENERATE_AFTER_DATA', 'text'); };
const _onAuthoritySettingsReady = (eventData) => { void _authorityVerify(eventData, 'CHAT_COMPLETION_SETTINGS_READY', 'chat'); };

function _repositionAuthorityHandlers() {
    const makeLast = typeof eventSource.makeLast === 'function'
        ? (evt, fn) => eventSource.makeLast(evt, fn)
        : null;
    if (!makeLast) return;
    if (event_types.GENERATE_AFTER_DATA) makeLast(event_types.GENERATE_AFTER_DATA, _onAuthorityAfterData);
    if (event_types.CHAT_COMPLETION_SETTINGS_READY) makeLast(event_types.CHAT_COMPLETION_SETTINGS_READY, _onAuthoritySettingsReady);
}

function _wireAuthorityHandlersOnce() {
    if (event_types.GENERATE_AFTER_DATA) {
        if (typeof eventSource.makeLast === 'function') eventSource.makeLast(event_types.GENERATE_AFTER_DATA, _onAuthorityAfterData);
        else eventSource.on(event_types.GENERATE_AFTER_DATA, _onAuthorityAfterData);
    }
    if (event_types.CHAT_COMPLETION_SETTINGS_READY) {
        if (typeof eventSource.makeLast === 'function') eventSource.makeLast(event_types.CHAT_COMPLETION_SETTINGS_READY, _onAuthoritySettingsReady);
        else eventSource.on(event_types.CHAT_COMPLETION_SETTINGS_READY, _onAuthoritySettingsReady);
    }
}

_wireAuthorityHandlersOnce();
setAuthorityReposition(_repositionAuthorityHandlers);

// CRITICAL: Save chat the INSTANT generation ends, BEFORE other extensions
// can trigger profile switches that cause CHAT_CHANGED → chat reload → message loss.
eventSource.on(event_types.GENERATION_ENDED, async () => {
    try { if(_inlineWaitTimerId){clearInterval(_inlineWaitTimerId);set_inlineWaitTimerId(null)} const w = document.getElementById('sp-inline-wait'); if (w) w.remove(); } catch {}
    clearThoughtLoading();
    try { clearStallWatchdog(); } catch {}
    // Nested quiet ended while Together is still mid-flight — restore prompts.
    try {
        if (getSuspendDepth() > 0 && inlineGenStartMs > 0) restorePromptInjection();
    } catch {}
    const s = getSettings();
    if (s.enabled && s.injectionMethod === 'inline' && !inlineExtractionDone && anyPanelsActive() && inlineGenStartMs > 0) {
        const { chat } = SillyTavern.getContext();
        let targetIdx = -1;
        for (let i = chat.length - 1; i >= 0; i--) {
            if (!chat[i].is_user) { targetIdx = i; break; }
        }
        if (targetIdx >= 0) {
            const _inlineCtx=rebindInlineCtxForExpectedSwipe(inlineGenerationContext,targetIdx);
            if(_inlineCtx&&(_inlineCtx.mesIdx!==targetIdx||getActiveSwipeId(targetIdx)!==_inlineCtx.swipeId)){
                warn('GENERATION_ENDED: target swipe changed; discarding inline tracker for',targetIdx);
                discardTogetherSceneBuild(_inlineCtx,'swipe-changed');
                cancelSceneSourceTrace();
                try { clearPromptInjection(getActivePromptInjectionRun()?.runId || null); } catch {}
                setInlineGenerationContext(null);setInlineGenStartMs(0);spSetGenerating(false);
                return;
            }
            log('GENERATION_ENDED: primary extraction attempt for message', targetIdx);
            const fullMsgLen = (chat[targetIdx]?.mes || '').length;
            let extracted = extractInlineTracker(targetIdx);
            if (extracted) {
                log('GENERATION_ENDED: primary extraction SUCCESS for message', targetIdx);
                setInlineExtractionDone(true); setPendingInlineIdx(-1);
                const _compTokens = Math.round(fullMsgLen / 4);
                const _elapsed = inlineGenStartMs > 0 ? ((Date.now() - inlineGenStartMs) / 1000) : 0;
                setInlineGenStartMs(0);
                genMeta.promptTokens = 0;
                genMeta.completionTokens = _compTokens;
                genMeta.elapsed = _elapsed;
                await processTogetherExtraction(targetIdx, extracted, 'auto:together', _inlineCtx, {
                    promptTokens: 0, completionTokens: _compTokens, elapsed: _elapsed,
                    stopHider: true, unlockGen: true,
                });
                try { clearPromptInjection(getActivePromptInjectionRun()?.runId || null); } catch {}
                setInlineGenerationContext(null);
                log('GENERATION_ENDED: pipeline complete');
                return;
            } else {
                const msgLen = (chat[targetIdx]?.mes || '').length;
                log('GENERATION_ENDED: primary extraction failed for message', targetIdx, '(' + msgLen + ' chars), deferring to onCharMsg');
                setPendingInlineIdx(targetIdx);
                spSetGenerating(false);
                stopStreamingHider();
                // Keep extension prompts until onCharMsg / next run decides;
                // metrics already committed after authority for footer.
            }
        } else {
            log('GENERATION_ENDED: no assistant message found, deferring to onCharMsg');
            spSetGenerating(false);
            stopStreamingHider();
        }
    } else {
        // Foreign quiet / unrelated GENERATION_ENDED — do NOT clear our Together prompts.
        spSetGenerating(false);
        stopStreamingHider();
        if (!(inlineGenStartMs > 0)) cancelSceneSourceTrace();
    }
    try { await ensureChatSaved(); log('GENERATION_ENDED: chat saved preemptively'); }
    catch (e) { warn('GENERATION_ENDED save failed:', e); }
});

// If user clicks ST's own stop button, cancel ScenePulse auto-recovery for
// this turn. Together mode often has generating===false while ST streams the
// narrative (only inlineGenStartMs is set), so we must mark cancel even then —
// otherwise onCharMsg starts continuation/fallback on a truncated reply.
// Keep inlineGenStartMs so a complete tracker JSON can still be extracted;
// only auto-fallback / separate-after-message are skipped via cancelRequested.
// Keep active source-trace until finish/discard, same as inlineGenStartMs.
eventSource.on(event_types.GENERATION_STOPPED, () => {
    try { clearStallWatchdog(); } catch {}
    const integrityAbort = getPromptAbortReason();
    const hadInline = inlineGenStartMs > 0 || pendingInlineIdx >= 0;
    const hadEngine = generating;
    setCancelRequested(true);
    try { cancelTogetherSceneBuilds(integrityAbort ? 'prompt-integrity' : 'reply-stopped'); } catch {}

    if (hadEngine) {
        const oldNonce = genNonce;
        setGenNonce(genNonce + 1);
        setGenerating(false);
        log('CANCEL (ST stop): nonce', oldNonce, '→', genNonce);
    }
    if (hadEngine || hadInline || integrityAbort) {
        log(integrityAbort
            ? 'ST generation_stopped — integrity abort ' + integrityAbort.code
            : 'ST generation_stopped — skip auto scene recovery for this turn');
        spSetGenerating(false);
        try { stopStreamingHider({abort:true}); } catch {}
        cleanupGenUI();
        if (hadInline || integrityAbort) {
            try { clearPromptInjection(getActivePromptInjectionRun()?.runId || null); } catch {}
        }
        const entry = getLatestSnapshotEntry();
        const snap = entry?.status === 'stale' ? null : (entry?.snapshot ?? null);
        const body = document.getElementById('sp-panel-body');
        if (snap) {
            setCurrentSnapshotMesIdx(entry.id);
            updatePanel(normalizeTracker(snap));
        } else {
            setCurrentSnapshotMesIdx(entry?.status === 'stale' && Number.isFinite(entry.id) ? entry.id : -1);
            if (body) renderEmptyState();
        }
    } else {
        log('ST generation_stopped — marked cancel for pending auto-gen');
    }
    // Clear programmatic abort reason after handling so the next run starts clean.
    if (integrityAbort) clearPromptAbortReason();
});

eventSource.on(event_types.CHAT_CHANGED, async () => {
    try { await ensureChatSaved(); } catch (e) { warn('CHAT_CHANGED save:', e); }
    try {
        if (_lastSceneBuildChatKey) cancelSceneBuildsForChat(_lastSceneBuildChatKey, 'chat-changed');
        _lastSceneBuildChatKey = currentChatKey();
        reconcileSceneBuildUi();
    } catch (e) { warn('CHAT_CHANGED scene-build:', e); }
    if (generating) cancelGeneration();
    try { clearPromptInjection(getActivePromptInjectionRun()?.runId || null); } catch {}
    clearPromptAbortReason();
    cancelSceneSourceTrace();
    const tp = document.getElementById('sp-thought-panel');
    if (tp) { tp.classList.remove('sp-tp-visible'); const tpb = document.getElementById('sp-tp-body'); if (tpb) tpb.innerHTML = ''; }
    clearWeatherOverlay();
    clearTimeTint();
    clearNormCache();
    invalidateCharacterHistory();
    set_cachedNormData(null);
    resetColorMap();
    invalidateSettingsCache();
    resetSessionTokens();
    if(_pendingActiveSwipeDeletion?.timer)clearTimeout(_pendingActiveSwipeDeletion.timer);
    _pendingActiveSwipeDeletion=null;
    _rememberSwipeIds();
    setPrevLocation(''); setPrevTimePeriod('');
    // v6.9.13: close the Panel Manager on chat switch so it doesn't
    // show stale toggle states from the previous chat's per-chat
    // overrides. When the user reopens it, the toggles will read
    // from the new chat's chatMetadata.
    const _mgr = document.querySelector('.sp-panel-mgr');
    if (_mgr) _mgr.remove();
    // Force a full-state generation on the next turn since the
    // effective panel set may have changed between chats (different
    // per-chat overrides → different schema → delta would be wrong).
    try { const { forceFullStateRefresh } = await import('./src/settings.js'); forceFullStateRefresh(); } catch {}
    // v6.9.14: renderExisting → updatePanel now reads getActivePanels()
    // which returns the new chat's chatPanels automatically. No manual
    // per-panel visibility sync needed.
    setTimeout(() => {
        renderExisting();
        const msgs = document.querySelectorAll('.mes');
        if (msgs.length === 0) setTimeout(renderExisting, 500);
    }, 200);
});

// Message deleted — remove associated snapshot and refresh timeline
if (event_types.MESSAGE_DELETED) {
    eventSource.on(event_types.MESSAGE_DELETED, (idx) => {
        log('MESSAGE_DELETED event, new chat length=', idx);
        _rememberSwipeIds();
        forceFullStateRefresh();
        void spOnMessageDeleted();
    });
}
if(event_types.MESSAGE_SWIPE_DELETED){
    eventSource.on(event_types.MESSAGE_SWIPE_DELETED,payload=>{
        const id=Number(payload?.messageId);const deleted=Number(payload?.swipeId);
        const oldActive=_knownSwipeIds.get(id);
        const activeChanged=oldActive==null||oldActive===deleted;
        _knownSwipeIds.set(id,Math.max(0,Number(payload?.newSwipeId??0)||0));
        if(activeChanged){
            if(_pendingActiveSwipeDeletion?.timer)clearTimeout(_pendingActiveSwipeDeletion.timer);
            const pending={payload,timer:null};
            pending.timer=setTimeout(()=>{
                if(_pendingActiveSwipeDeletion!==pending)return;
                _pendingActiveSwipeDeletion=null;void spOnSwipeDeleted(payload,true);
            },2000);
            _pendingActiveSwipeDeletion=pending;
        }else void spOnSwipeDeleted(payload,false);
    });
}
// Also catch swipe/edit which may renumber messages
if (event_types.MESSAGE_UPDATED) {
    eventSource.on(event_types.MESSAGE_UPDATED, idx => {
        const id=Number(idx);
        const snap=Number.isFinite(id)?getTrustedSnapshotFor(id):null;
        try{updateThoughts(snap?normalizeTracker(snap):null)}catch{}
        setTimeout(renderExisting, 300);
    });
}
if (event_types.MESSAGE_SWIPED) {
    eventSource.on(event_types.MESSAGE_SWIPED, idx => {
        const id=Number(idx);const message=SillyTavern.getContext().chat?.[id];
        if(message)_knownSwipeIds.set(id,Math.max(0,Number(message.swipe_id??0)||0));
        if(_pendingActiveSwipeDeletion&&Number(_pendingActiveSwipeDeletion.payload?.messageId)===id){
            const pending=_pendingActiveSwipeDeletion;_pendingActiveSwipeDeletion=null;clearTimeout(pending.timer);
            void spOnSwipeDeleted(pending.payload,true);return;
        }
        void onMessageSwiped(id);
        try{
            const swipeId=Math.max(0,Number(message?.swipe_id??0)||0);
            supersedeSceneBuildsForMessageExceptSwipe(id,swipeId);
            reconcileSceneBuildUi();
        }catch{}
    });
}

// ── Keyboard shortcuts ──
document.addEventListener('keydown', (e) => {
    // Escape: close diff viewer or overlays
    if (e.key === 'Escape') {
        try {
            const diffOverlay = document.querySelector('.sp-diff-overlay');
            if (diffOverlay) { diffOverlay.remove(); e.preventDefault(); return; }
            const graphPopup = document.querySelector('.sp-graph-popup');
            if (graphPopup) { graphPopup.remove(); e.preventDefault(); return; }
            const confirmOverlay = document.querySelector('.sp-confirm-overlay');
            if (confirmOverlay) { confirmOverlay.remove(); e.preventDefault(); return; }
        } catch {}
    }
    // Alt+Shift+P: toggle panel (avoids Firefox Ctrl+Shift+P print conflict)
    if (e.altKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        try {
            const panel = document.getElementById('sp-panel');
            if (panel && panel.classList.contains('sp-visible')) {
                import('./src/ui/panel.js').then(m => m.hidePanel());
            } else {
                import('./src/ui/panel.js').then(m => m.showPanel());
            }
        } catch {}
    }
    // Alt+Shift+R: regenerate tracker with loading animations
    if (e.altKey && e.shiftKey && e.key === 'R') {
        e.preventDefault();
        if (!generating && getSettings().enabled) {
            const { chat } = SillyTavern.getContext();
            let mesIdx = -1;
            for (let i = chat.length - 1; i >= 0; i--) {
                if (!chat[i].is_user) { mesIdx = i; break; }
            }
            if (mesIdx >= 0) {
                (async () => {
                    const [loadM, mobileM, panelM, uiM] = await Promise.all([
                        import('./src/ui/loading.js'), import('./src/ui/mobile.js'),
                        import('./src/ui/panel.js'), import('./src/ui/scene-build-ui.js')
                    ]);
                    mobileM.spAutoShow();
                    loadM.showLoadingOverlay(document.getElementById('sp-panel-body'), 'Generating Scene', 'Keyboard shortcut');
                    loadM.showStopButton(); loadM.startElapsedTimer();
                    loadM.showThoughtLoading('Generating Scene', 'Analyzing context');
                    const result = await uiM.runManualSceneBuild(mesIdx, 'shortcut:regen');
                    loadM.hideStopButton(); loadM.stopElapsedTimer();
                    loadM.clearLoadingOverlay(document.getElementById('sp-panel-body'));
                    loadM.clearThoughtLoading();
                    if (result) panelM.showPanel();
                })().catch(() => {});
            }
        }
    }
});

log('v' + VERSION + ' init');
