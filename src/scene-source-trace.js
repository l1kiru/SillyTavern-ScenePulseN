// Experimental Together-mode source trace.
// Captures only compact metadata from SillyTavern's World Info activation
// event. It deliberately does not scan lorebooks or store full entry text.

const MAX_ENTRIES = 20;
const MAX_EXCERPT = 300;

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

function _excerpt(value) {
    const text = _str(value);
    if (!text) return '';
    return text.length > MAX_EXCERPT ? text.slice(0, MAX_EXCERPT - 1) + '…' : text;
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
        ..._strArray(value.matchedKeys),
        ..._strArray(value.primaryKey),
        ..._strArray(entry.keys),
        ..._strArray(entry.key),
    ];
    const comment = _str(value.comment ?? entry.comment);
    const content = value.content ?? value.text ?? value.message ?? entry.content ?? entry.text ?? entry.message;
    const excerpt = _excerpt(content);
    if (!uid && !title && !keys.length && !comment && !excerpt) return null;
    return {
        world,
        uid,
        title: title || comment || (uid ? `#${uid}` : ''),
        keys: [...new Set(keys)],
        comment,
        excerpt,
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
        if (out.length >= MAX_ENTRIES) break;
    }
    return out;
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

export function recordWorldInfoActivation(payload) {
    if (!_activeTrace) return;
    _activeTrace.totalEvents++;
    for (const entry of normalizeWorldInfoEvent(payload)) {
        if (_activeTrace.entries.length >= MAX_ENTRIES) break;
        const id = [entry.world, entry.uid, entry.title, entry.keys.join(',')].join('|').toLowerCase();
        const exists = _activeTrace.entries.some(existing => [existing.world, existing.uid, existing.title, existing.keys.join(',')].join('|').toLowerCase() === id);
        if (!exists) _activeTrace.entries.push(entry);
    }
}

export function finishSceneSourceTrace(owner, { forceEmpty = false } = {}) {
    const ownerKey = _ownerKey(owner);
    const trace = _activeTrace;
    _activeTrace = null;
    if (!trace && !forceEmpty) return null;
    if (trace && ownerKey && trace.ownerKey && trace.ownerKey !== ownerKey) return forceEmpty ? _emptyTrace() : null;
    return {
        v: 1,
        mode: 'inline',
        capturedAt: new Date().toISOString(),
        startedAt: trace?.startedAt || '',
        lorebook: {
            count: trace?.entries.length || 0,
            totalEvents: trace?.totalEvents || 0,
            entries: trace?.entries || [],
        },
    };
}

export function cancelSceneSourceTrace() {
    _activeTrace = null;
}

function _emptyTrace() {
    return {
        v: 1,
        mode: 'inline',
        capturedAt: new Date().toISOString(),
        startedAt: '',
        lorebook: { count: 0, totalEvents: 0, entries: [] },
    };
}

export function _resetSceneSourceTraceForTests() {
    _activeTrace = null;
}
