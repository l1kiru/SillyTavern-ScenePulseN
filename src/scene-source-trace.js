// Experimental Together-mode source trace.
// Captures WI engine events + pre-gen scan context; inferred keys labeled as such.

import { EvidenceLevel, evidence } from './scene-source-trace/evidence.js';
import { migrateTraceToV3View } from './scene-source-trace/migrate.js';
import { capturePreGenScanContext } from './scene-source-trace/scan-context.js';
import {
    entryKey,
    snapshotScanDone,
    snapshotEntriesLoaded,
} from './scene-source-trace/event-adapters.js';
import {
    inferTriggersForEntry,
    matchEntryKeys,
    parseWiRegexKey,
    WI_LOGIC,
} from './scene-source-trace/matcher.js';
import {
    snapshotWorldInfoSettings,
    readWiSettingsFromDom,
} from './scene-source-trace/settings-snapshot.js';
import {
    fingerprintContent,
    extractWiSlotsFromPromptChat,
    extractTextCompletionSlots,
    matchFingerprintInSlots,
} from './scene-source-trace/prompt-insertion.js';
import { buildInferredSegments, inferTriggerSources } from './scene-source-trace/segments.js';
import { classifyForceEntries } from './scene-source-trace/force-source.js';
import { explainWhyNot } from './scene-source-trace/why-not.js';

export const MAX_MATCHED_KEY_LEN = 80;
export const MAX_LOREBOOK_JSON_BYTES = 65536;
export const SCAN_DEPTH_FALLBACK = 10;

export {
    EvidenceLevel,
    evidence,
    migrateTraceToV3View,
    capturePreGenScanContext,
    entryKey,
    snapshotScanDone,
    snapshotEntriesLoaded,
    inferTriggersForEntry,
    matchEntryKeys,
    parseWiRegexKey,
    WI_LOGIC,
    snapshotWorldInfoSettings,
    readWiSettingsFromDom,
    fingerprintContent,
    extractWiSlotsFromPromptChat,
    extractTextCompletionSlots,
    matchFingerprintInSlots,
    buildInferredSegments,
    inferTriggerSources,
    classifyForceEntries,
    explainWhyNot,
};

let _activeTrace = null;
let _eventSeq = 0;

function _ownerKey(owner) {
    if (!owner) return '';
    return [
        owner.chatKey ?? '',
        owner.targetMessageId ?? '',
        owner.swipeId ?? '',
    ].join('|');
}

function _str(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
}

function _strArray(value) {
    if (Array.isArray(value)) return value.map(_str).filter(Boolean);
    const s = _str(value);
    return s ? [s] : [];
}

function _entryLike(value) {
    if (!value || typeof value !== 'object') return null;
    const entry = value.entry && typeof value.entry === 'object' ? value.entry : {};
    const world = _str(value.world ?? value.worldName ?? value.book ?? value.lorebook ?? value.source ?? value.file ?? entry.world ?? entry.book);
    const uid = _str(value.uid ?? value.id ?? value.entryId ?? value.key ?? entry.uid ?? entry.id);
    const title = _str(value.title ?? value.name ?? value.comment ?? entry.title ?? entry.name ?? entry.comment);
    const keys = [
        ..._strArray(value.keys),
        ..._strArray(value.key),
        ..._strArray(value.primaryKey),
        ..._strArray(entry.keys),
        ..._strArray(entry.key),
    ];
    const keysecondary = [
        ..._strArray(value.keysecondary),
        ..._strArray(value.secondaryKeys),
        ..._strArray(entry.keysecondary),
    ];
    const comment = _str(value.comment ?? entry.comment);
    const constant = !!(value.constant ?? entry.constant);
    const content = _str(value.content ?? entry.content);
    const tokens = content ? Math.round(content.length / 4) : 0;
    if (!uid && !title && !keys.length && !comment && !constant) return null;
    return {
        world,
        uid,
        title: title || comment || (uid ? `#${uid}` : ''),
        keys: [...new Set(keys)],
        keysecondary: [...new Set(keysecondary)],
        selectiveLogic: value.selectiveLogic ?? entry.selectiveLogic ?? WI_LOGIC.AND_ANY,
        caseSensitive: value.caseSensitive ?? entry.caseSensitive ?? null,
        matchWholeWords: value.matchWholeWords ?? entry.matchWholeWords ?? null,
        comment,
        constant,
        tokens,
        contentHead: content ? content.slice(0, 64) : '',
    };
}

function _collect(value, parent = {}, out = []) {
    if (value == null) return out;
    if (Array.isArray(value)) {
        for (const item of value) _collect(item, parent, out);
        return out;
    }
    if (typeof value !== 'object') return out;

    const merged = { ...parent, ...value };
    const direct = _entryLike(merged);
    if (direct) out.push(direct);

    for (const key of ['entries', 'activatedEntries', 'activations', 'worldInfo', 'worldInfoEntries', 'activated']) {
        if (Array.isArray(value[key])) _collect(value[key], merged, out);
    }
    return out;
}

export function normalizeWorldInfoEvent(payload) {
    const entries = _collect(payload);
    const seen = new Set();
    const out = [];
    for (const entry of entries) {
        const id = [entry.world, entry.uid, entry.title, entry.keys.join(',')].join('|').toLowerCase();
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(entry);
    }
    return out;
}

/** Build WI-like scan text from the last `depth` chat messages. */
export function buildWiScanBuffer(chat, depth) {
    if (!Array.isArray(chat) || !chat.length) return '';
    const n = Math.max(1, Number(depth) || SCAN_DEPTH_FALLBACK);
    return chat.slice(-n).map(m => String(m?.mes ?? '')).join('\n');
}

export function resolveScanDepth() {
    try {
        const fromDom = snapshotWorldInfoSettings(readWiSettingsFromDom());
        if (fromDom.scanDepth > 0) return fromDom.scanDepth;
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
        const fromCtx = ctx?.power_user?.world_info_depth;
        const fromGlobal = typeof power_user !== 'undefined' ? power_user?.world_info_depth : undefined;
        const n = Number(fromCtx ?? fromGlobal);
        if (Number.isFinite(n) && n > 0) return n;
    } catch { /* ignore */ }
    return SCAN_DEPTH_FALLBACK;
}

export function applyMatchedKeysToEntries(entries, buffer, settings = {}) {
    return (Array.isArray(entries) ? entries : []).map(entry => {
        const tokens = Number.isFinite(entry?.tokens) ? Math.max(0, Math.round(entry.tokens)) : 0;
        try {
            const { matchedKeys, matchKind, triggers } = inferTriggersForEntry(entry, buffer || '', settings);
            return {
                world: entry.world || '',
                uid: entry.uid || '',
                title: entry.title || '',
                matchedKeys,
                matchKind,
                tokens,
                triggers,
                keys: entry.keys,
                keysecondary: entry.keysecondary,
                constant: entry.constant,
                selectiveLogic: entry.selectiveLogic,
                caseSensitive: entry.caseSensitive,
                matchWholeWords: entry.matchWholeWords,
            };
        } catch {
            return {
                world: entry?.world || '',
                uid: entry?.uid || '',
                title: entry?.title || '',
                matchedKeys: [],
                matchKind: 'none',
                tokens,
                triggers: [],
            };
        }
    });
}

function jsonUtf8Bytes(value) {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function trimLorebookForStorage(lorebook) {
    const lb = {
        count: 0,
        totalEvents: lorebook?.totalEvents || 0,
        entries: Array.isArray(lorebook?.entries) ? lorebook.entries.slice() : [],
        omitted: 0,
    };
    while (lb.entries.length && jsonUtf8Bytes(lb) > MAX_LOREBOOK_JSON_BYTES) {
        lb.entries.pop();
        lb.omitted++;
    }
    lb.count = lb.entries.length;
    if (!lb.omitted) delete lb.omitted;
    return lb;
}

function _pushEvent(type, source, extra = {}) {
    if (!_activeTrace) return;
    _activeTrace.events.push({
        sequence: ++_eventSeq,
        timestamp: new Date().toISOString(),
        type,
        source,
        loop: extra.loop ?? null,
        entryKey: extra.entryKey ?? null,
        payload: extra.payload || {},
    });
    if (_activeTrace.events.length > 500) {
        _activeTrace.events.splice(0, _activeTrace.events.length - 500);
    }
}

export function startSceneSourceTrace(owner, {
    enabled = false,
    chat = null,
    depth = null,
    includeNames = false,
    settingsRaw = null,
} = {}) {
    if (!enabled) {
        _activeTrace = null;
        return;
    }
    _eventSeq = 0;
    const scanDepth = depth != null ? Number(depth) : resolveScanDepth();
    const settings = snapshotWorldInfoSettings(
        settingsRaw || readWiSettingsFromDom(),
    );
    if (!settings.scanDepth && scanDepth) settings.scanDepth = scanDepth;
    const scanContext = capturePreGenScanContext(chat, {
        depth: settings.scanDepth || scanDepth || SCAN_DEPTH_FALLBACK,
        includeNames: includeNames || settings.includeNames,
    });
    _activeTrace = {
        ownerKey: _ownerKey(owner),
        owner: {
            chatKey: owner?.chatKey ?? '',
            messageId: owner?.targetMessageId ?? null,
            swipeId: owner?.swipeId ?? null,
        },
        startedAt: new Date().toISOString(),
        entries: [],
        totalEvents: 0,
        scanContext,
        settings,
        lorebooks: [],
        loadedEntryKeys: [],
        titleByKey: new Map(),
        forceKeys: new Set(),
        loops: [],
        events: [],
        timedEffectsByKey: {},
        decisions: [],
        budgetOverflowed: false,
        promptSlotsCc: null,
        promptSlotsTc: null,
        promptCaptured: false,
        forceSource: 'external',
        segmentsExtras: { character: null, persona: null, recurseTexts: [] },
    };
}

/** Keep capture keyed to the final swipe when Together rebinds expected advance. */
export function rebindSceneSourceTraceOwner(owner) {
    if (!_activeTrace || !owner) return false;
    _activeTrace.ownerKey = _ownerKey(owner);
    _activeTrace.owner = {
        chatKey: owner.chatKey ?? '',
        messageId: owner.targetMessageId ?? null,
        swipeId: owner.swipeId ?? null,
    };
    return true;
}

export function recordWorldInfoActivation(payload) {
    if (!_activeTrace) return;
    _activeTrace.totalEvents++;
    _pushEvent('world_info_activated', 'WORLD_INFO_ACTIVATED');
    for (const entry of normalizeWorldInfoEvent(payload)) {
        const id = [entry.world, entry.uid, entry.title, entry.keys.join(',')].join('|').toLowerCase();
        const exists = _activeTrace.entries.some(existing =>
            [existing.world, existing.uid, existing.title, existing.keys.join(',')].join('|').toLowerCase() === id);
        if (!exists) _activeTrace.entries.push(entry);
    }
}

export function recordWorldInfoScanDone(args) {
    if (!_activeTrace) return;
    const snap = snapshotScanDone(args);
    // prompt_build phase: decisions only (Phase 4); do not append loops
    if (snap.phase === 'prompt_build' || snap.loopCount === -1) {
        if (snap.decisions.length) {
            _activeTrace.decisions.push(...snap.decisions);
        }
        _pushEvent('scan_prompt_build', 'WORLDINFO_SCAN_DONE', {
            loop: null,
            payload: { phase: 'prompt_build', decisionCount: snap.decisions.length },
        });
        return;
    }

    const prev = new Set(
        _activeTrace.loops.length
            ? _activeTrace.loops[_activeTrace.loops.length - 1].acceptedEntryKeys
            : [],
    );
    const newAccepted = snap.acceptedEntryKeys.filter(k => !prev.has(k));
    _activeTrace.loops.push({
        loopCount: snap.loopCount,
        state: snap.state,
        nextState: snap.nextState,
        budgetCurrent: snap.budgetCurrent,
        budgetOverflowed: snap.budgetOverflowed,
        acceptedEntryKeys: snap.acceptedEntryKeys.slice(),
        newAcceptedEntryKeys: newAccepted,
    });
    if (snap.budgetOverflowed) _activeTrace.budgetOverflowed = true;
    Object.assign(_activeTrace.timedEffectsByKey, snap.timedEffectsByKey || {});
    if (snap.decisions.length) _activeTrace.decisions.push(...snap.decisions);
    _pushEvent('scan_loop_completed', 'WORLDINFO_SCAN_DONE', {
        loop: snap.loopCount,
        payload: {
            state: snap.state,
            newAcceptedCount: newAccepted.length,
            budgetOverflowed: snap.budgetOverflowed,
        },
    });
}

export function recordWorldInfoEntriesLoaded(payload) {
    if (!_activeTrace) return;
    const snap = snapshotEntriesLoaded(payload);
    _activeTrace.lorebooks = snap.lorebooks;
    _activeTrace.loadedEntryKeys = snap.loadedEntryKeys;
    _activeTrace.titleByKey = snap.titleByKey;
    _pushEvent('entries_loaded', 'WORLDINFO_ENTRIES_LOADED', {
        payload: { loadedCount: snap.loadedCount },
    });
}

export function recordWorldInfoForceActivate(entries) {
    if (!_activeTrace) return;
    const list = Array.isArray(entries) ? entries : (entries?.entries || []);
    const classified = classifyForceEntries(list);
    _activeTrace.forceSource = classified.source;
    for (const entry of list) {
        const key = entryKey(entry?.world, entry?.uid);
        if (key !== '::') _activeTrace.forceKeys.add(key);
    }
    _pushEvent('force_activate', 'WORLDINFO_FORCE_ACTIVATE', {
        payload: { count: list.length, source: classified.source },
    });
}

export function recordPromptReady(eventData) {
    if (!_activeTrace || eventData?.dryRun) return;
    const slots = extractWiSlotsFromPromptChat(eventData?.chat);
    _activeTrace.promptSlotsCc = slots;
    _activeTrace.promptCaptured = true;
    _pushEvent('prompt_ready_cc', 'CHAT_COMPLETION_PROMPT_READY');
}

export function recordTextCompletionPrompt(eventData) {
    if (!_activeTrace) return;
    const slots = extractTextCompletionSlots(eventData);
    if (!slots) return;
    _activeTrace.promptSlotsTc = slots;
    _activeTrace.promptCaptured = true;
    _pushEvent('prompt_ready_tc', 'GENERATE_AFTER_COMBINE_PROMPTS');
}

export function setTraceSegmentContext({ character, persona, recurseTexts } = {}) {
    if (!_activeTrace) return;
    if (character) _activeTrace.segmentsExtras.character = character;
    if (persona) _activeTrace.segmentsExtras.persona = persona;
    if (recurseTexts) _activeTrace.segmentsExtras.recurseTexts = recurseTexts;
}

function _emptyTrace(owner = null) {
    return {
        v: 3,
        mode: 'inline',
        capturedAt: new Date().toISOString(),
        startedAt: '',
        settings: {},
        owner: owner || { chatKey: '', messageId: null, swipeId: null },
        lorebooks: [],
        loadedEntryKeys: [],
        candidates: [],
        lorebook: { count: 0, totalEvents: 0, entries: [] },
        loops: [],
        events: [],
        summary: {
            loadedEntries: 0,
            acceptedEntries: 0,
            candidateEntries: 0,
            inferredTriggers: 0,
            recursionLoops: 0,
            budgetOverflowed: false,
            stickyCount: 0,
            insertedEntries: 0,
            possiblyInsertedEntries: 0,
        },
    };
}

export function finishSceneSourceTrace(owner, { forceEmpty = false } = {}) {
    const ownerKey = _ownerKey(owner);
    const trace = _activeTrace;
    _activeTrace = null;
    if (!trace && !forceEmpty) return null;
    if (trace && ownerKey && trace.ownerKey && trace.ownerKey !== ownerKey) {
        return forceEmpty ? _emptyTrace(owner ? {
            chatKey: owner.chatKey ?? '',
            messageId: owner.targetMessageId ?? null,
            swipeId: owner.swipeId ?? null,
        } : null) : null;
    }

    if (!trace) return forceEmpty ? _emptyTrace() : null;

    const buffer = trace.scanContext?.buffer || '';
    const settings = trace.settings || {};

    let character = trace.segmentsExtras?.character;
    let persona = trace.segmentsExtras?.persona;
    try {
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
        const chid = ctx?.characterId ?? ctx?.this_chid;
        const chars = ctx?.characters;
        if (!character && Array.isArray(chars) && chid != null) character = chars[chid];
        if (!persona && ctx?.powerUserSettings) persona = { description: ctx.powerUserSettings.persona_description };
    } catch { /* ignore */ }

    const segments = buildInferredSegments({
        chat: null, // use buffer-derived window via message rebuild below
        depth: settings.scanDepth || SCAN_DEPTH_FALLBACK,
        includeNames: settings.includeNames,
        character,
        persona,
        recurseTexts: trace.segmentsExtras?.recurseTexts || [],
    });
    // Rebuild chat segments from scanContext messageIds if we still have chat on context
    try {
        const chat = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext?.()?.chat) || [];
        const pre = buildInferredSegments({
            chat: Array.isArray(chat) ? chat.slice(0, Math.max(...(trace.scanContext?.messageIds || [0])) + 1) : [],
            depth: settings.scanDepth || SCAN_DEPTH_FALLBACK,
            includeNames: settings.includeNames,
            character,
            persona,
            recurseTexts: trace.segmentsExtras?.recurseTexts || [],
        });
        if (pre.length) segments.splice(0, segments.length, ...pre);
    } catch {
        // fall back: single chat_message segment from buffer
        if (buffer) segments.unshift({ type: 'chat_message', messageId: null, depth: 1, text: buffer });
    }

    const matched = applyMatchedKeysToEntries(trace.entries, buffer, settings);

    let inferredTriggers = 0;
    let stickyCount = 0;
    let insertedEntries = 0;
    let possiblyInsertedEntries = 0;
    const promptSlots = trace.promptSlotsCc || trace.promptSlotsTc || null;

    const finishedEntries = matched.map((entry, idx) => {
        const raw = trace.entries[idx] || entry;
        const key = entryKey(entry.world, entry.uid);
        const forced = trace.forceKeys.has(key);
        const timed = trace.timedEffectsByKey[key] || { sticky: false, cooldown: false, delay: false };
        let triggers = inferTriggerSources(raw, segments, settings);
        if (!triggers.length) triggers = Array.isArray(entry.triggers) ? entry.triggers.slice() : [];
        let matchKind = entry.matchKind || 'none';
        let matchedKeys = Array.isArray(entry.matchedKeys) ? entry.matchedKeys.slice() : [];
        if (triggers.some(t => t.matchedText)) {
            matchedKeys = [...new Set(triggers.filter(t => t.matchedText).map(t => t.matchedText))];
            if (matchKind === 'none') matchKind = 'keys';
        }

        if (forced) {
            triggers = [
                {
                    type: 'force_activate',
                    evidence: evidence(EvidenceLevel.ENGINE),
                    forceSource: trace.forceSource || 'external',
                },
                ...triggers.filter(t => t.type !== 'unknown'),
            ];
            matchKind = 'force';
            matchedKeys = [];
        } else if (timed.sticky && matchKind === 'none') {
            triggers = [{ type: 'sticky', evidence: evidence(EvidenceLevel.ENGINE) }, ...triggers];
            matchKind = 'sticky';
        }

        inferredTriggers += triggers.filter(t => t.evidence?.type === EvidenceLevel.INFERRED).length;
        if (timed.sticky) stickyCount++;

        let firstSeenLoop = null;
        for (const loop of trace.loops) {
            if (loop.newAcceptedEntryKeys.includes(key)) {
                firstSeenLoop = loop.loopCount;
                break;
            }
        }

        const fp = fingerprintContent(raw.contentHead || '');
        let promptInsertion = {
            status: 'unknown',
            position: null,
            evidence: evidence(EvidenceLevel.UNKNOWN),
        };
        if (trace.promptCaptured && promptSlots) {
            const hit = matchFingerprintInSlots(fp, promptSlots, { contentHead: raw.contentHead || '' });
            promptInsertion = {
                status: hit.status,
                position: hit.position,
                evidence: evidence(EvidenceLevel.INFERRED, hit.confidence),
            };
            if (hit.status === 'yes') insertedEntries++;
            else if (hit.status === 'possibly') possiblyInsertedEntries++;
        }

        const insertedStage = promptInsertion.status === 'yes'
            ? 'yes'
            : (promptInsertion.status === 'no' ? 'no'
                : (promptInsertion.status === 'possibly' ? 'possibly' : 'unknown'));

        return {
            world: entry.world || '',
            uid: entry.uid || '',
            title: entry.title || '',
            tokens: entry.tokens || 0,
            stages: {
                accepted: { value: true, evidence: EvidenceLevel.ENGINE },
                rendered: { value: null, evidence: EvidenceLevel.UNKNOWN },
                inserted: { value: insertedStage, evidence: promptInsertion.evidence.type },
            },
            configuration: {
                constant: !!raw.constant,
                vectorized: false,
                selective: Array.isArray(raw.keysecondary) && raw.keysecondary.length > 0,
                selectiveLogic: raw.selectiveLogic ?? 0,
                probability: 100,
                scanDepth: null,
                caseSensitive: raw.caseSensitive ?? null,
                matchWholeWords: raw.matchWholeWords ?? null,
            },
            contentFingerprint: fp,
            promptInsertion,
            firstSeenLoop,
            triggers,
            timedEffects: timed,
            matchedKeys,
            matchKind,
        };
    });

    const acceptedKeys = new Set(finishedEntries.map(e => entryKey(e.world, e.uid)));
    const candidates = [];
    for (const key of trace.loadedEntryKeys || []) {
        if (acceptedKeys.has(key)) continue;
        const meta = trace.titleByKey?.get?.(key) || {};
        candidates.push({
            world: meta.world || key.split('::')[0] || '',
            uid: meta.uid || key.split('::')[1] || '',
            title: meta.title || '',
        });
    }

    const lorebook = trimLorebookForStorage({
        count: finishedEntries.length,
        totalEvents: trace.totalEvents || 0,
        entries: finishedEntries,
    });

    const recursionLoops = trace.loops.filter(l => l.state === 'RECURSION').length;

    return {
        v: 3,
        mode: 'inline',
        capturedAt: new Date().toISOString(),
        startedAt: trace.startedAt || '',
        settings,
        owner: trace.owner || { chatKey: '', messageId: null, swipeId: null },
        lorebooks: Array.isArray(trace.lorebooks) ? trace.lorebooks : [],
        loadedEntryKeys: Array.isArray(trace.loadedEntryKeys) ? trace.loadedEntryKeys.slice() : [],
        candidates,
        lorebook,
        loops: trace.loops.slice(),
        events: trace.events.slice(),
        summary: {
            loadedEntries: (trace.loadedEntryKeys || []).length,
            acceptedEntries: lorebook.count,
            candidateEntries: candidates.length,
            inferredTriggers,
            recursionLoops,
            budgetOverflowed: !!trace.budgetOverflowed,
            stickyCount,
            insertedEntries,
            possiblyInsertedEntries,
        },
        _decisions: trace.decisions.slice(),
    };
}

export function cancelSceneSourceTrace() {
    _activeTrace = null;
}

export function _resetSceneSourceTraceForTests() {
    _activeTrace = null;
    _eventSeq = 0;
}

export function _getActiveTraceForTests() {
    return _activeTrace;
}
