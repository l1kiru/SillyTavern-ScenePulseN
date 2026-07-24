// Experimental Together-mode source trace.
// Captures compact metadata from SillyTavern's World Info activation event,
// then resolves matched key substrings against a chat scan buffer on finish.
// Does not scan lorebook files or call getWorldInfoPrompt.

export const MAX_MATCHED_KEY_LEN = 80;
export const MAX_LOREBOOK_JSON_BYTES = 65536;
export const SCAN_DEPTH_FALLBACK = 10;

let _activeTrace = null;

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

function _truncateMatch(text) {
    const s = _str(text);
    if (!s) return '';
    return s.length > MAX_MATCHED_KEY_LEN ? s.slice(0, MAX_MATCHED_KEY_LEN - 1) + '…' : s;
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
    const comment = _str(value.comment ?? entry.comment);
    const constant = !!(value.constant ?? entry.constant);
    if (!uid && !title && !keys.length && !comment && !constant) return null;
    return {
        world,
        uid,
        title: title || comment || (uid ? `#${uid}` : ''),
        keys: [...new Set(keys)],
        comment,
        constant,
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
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
        const fromCtx = ctx?.power_user?.world_info_depth;
        const fromGlobal = typeof power_user !== 'undefined' ? power_user?.world_info_depth : undefined;
        const n = Number(fromCtx ?? fromGlobal);
        if (Number.isFinite(n) && n > 0) return n;
    } catch { /* ignore */ }
    return SCAN_DEPTH_FALLBACK;
}

/** Parse SillyTavern `/pattern/flags` key; invalid → null. */
export function parseWiRegexKey(key) {
    const s = _str(key);
    if (!s.startsWith('/')) return null;
    const last = s.lastIndexOf('/');
    if (last <= 0) return null;
    const pattern = s.slice(1, last);
    const flags = s.slice(last + 1);
    if (!pattern) return null;
    try {
        return new RegExp(pattern, flags);
    } catch {
        return null;
    }
}

export function matchEntryKeys({ keys = [], constant = false } = {}, buffer = '') {
    if (constant) return { matchedKeys: [], matchKind: 'constant' };
    const text = String(buffer || '');
    const lower = text.toLowerCase();
    const matched = [];
    const seen = new Set();
    for (const raw of Array.isArray(keys) ? keys : []) {
        const key = _str(raw);
        if (!key) continue;
        let hit = '';
        const rx = parseWiRegexKey(key);
        if (rx) {
            try {
                const m = rx.exec(text);
                if (m && m[0]) hit = m[0];
            } catch { /* ignore bad exec */ }
        } else {
            const idx = lower.indexOf(key.toLowerCase());
            if (idx >= 0) hit = text.slice(idx, idx + key.length) || key;
        }
        if (!hit) continue;
        const clipped = _truncateMatch(hit);
        const id = clipped.toLowerCase();
        if (seen.has(id)) continue;
        seen.add(id);
        matched.push(clipped);
    }
    return {
        matchedKeys: matched,
        matchKind: matched.length ? 'keys' : 'none',
    };
}

export function applyMatchedKeysToEntries(entries, buffer) {
    return (Array.isArray(entries) ? entries : []).map(entry => {
        try {
            const { matchedKeys, matchKind } = matchEntryKeys(entry, buffer || '');
            return {
                world: entry.world || '',
                uid: entry.uid || '',
                title: entry.title || '',
                matchedKeys,
                matchKind,
            };
        } catch {
            return {
                world: entry?.world || '',
                uid: entry?.uid || '',
                title: entry?.title || '',
                matchedKeys: [],
                matchKind: 'none',
            };
        }
    });
}

export function trimLorebookForStorage(lorebook) {
    const lb = {
        count: 0,
        totalEvents: lorebook?.totalEvents || 0,
        entries: Array.isArray(lorebook?.entries) ? lorebook.entries.slice() : [],
        omitted: 0,
    };
    while (lb.entries.length && JSON.stringify(lb).length > MAX_LOREBOOK_JSON_BYTES) {
        lb.entries.pop();
        lb.omitted++;
    }
    lb.count = lb.entries.length;
    if (!lb.omitted) delete lb.omitted;
    return lb;
}

export function startSceneSourceTrace(owner, { enabled = false } = {}) {
    if (!enabled) {
        _activeTrace = null;
        return;
    }
    _activeTrace = {
        ownerKey: _ownerKey(owner),
        startedAt: new Date().toISOString(),
        entries: [],
        totalEvents: 0,
    };
}

/** Keep capture keyed to the final swipe when Together rebinds expected advance. */
export function rebindSceneSourceTraceOwner(owner) {
    if (!_activeTrace || !owner) return false;
    _activeTrace.ownerKey = _ownerKey(owner);
    return true;
}

export function recordWorldInfoActivation(payload) {
    if (!_activeTrace) return;
    _activeTrace.totalEvents++;
    for (const entry of normalizeWorldInfoEvent(payload)) {
        const id = [entry.world, entry.uid, entry.title, entry.keys.join(',')].join('|').toLowerCase();
        const exists = _activeTrace.entries.some(existing =>
            [existing.world, existing.uid, existing.title, existing.keys.join(',')].join('|').toLowerCase() === id);
        if (!exists) _activeTrace.entries.push(entry);
    }
}

export function finishSceneSourceTrace(owner, { forceEmpty = false } = {}) {
    const ownerKey = _ownerKey(owner);
    const trace = _activeTrace;
    _activeTrace = null;
    if (!trace && !forceEmpty) return null;
    if (trace && ownerKey && trace.ownerKey && trace.ownerKey !== ownerKey) {
        return forceEmpty ? _emptyTrace() : null;
    }

    let entries = [];
    let totalEvents = 0;
    let startedAt = '';
    if (trace) {
        startedAt = trace.startedAt || '';
        totalEvents = trace.totalEvents || 0;
        try {
            const chat = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext?.()?.chat) || [];
            const buffer = buildWiScanBuffer(chat, resolveScanDepth());
            entries = applyMatchedKeysToEntries(trace.entries, buffer);
        } catch {
            entries = applyMatchedKeysToEntries(trace.entries, '');
        }
    }

    const lorebook = trimLorebookForStorage({
        count: entries.length,
        totalEvents,
        entries,
    });

    return {
        v: 2,
        mode: 'inline',
        capturedAt: new Date().toISOString(),
        startedAt,
        lorebook,
    };
}

export function cancelSceneSourceTrace() {
    _activeTrace = null;
}

function _emptyTrace() {
    return {
        v: 2,
        mode: 'inline',
        capturedAt: new Date().toISOString(),
        startedAt: '',
        lorebook: { count: 0, totalEvents: 0, entries: [] },
    };
}

export function _resetSceneSourceTraceForTests() {
    _activeTrace = null;
}
