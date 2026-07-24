// Pure helpers for Scene Source Trace footer chip + drawer model.

function _isRegexKey(key) {
    const s = String(key || '').trim();
    if (!s.startsWith('/')) return false;
    return s.lastIndexOf('/') > 0;
}

function _mode(meta = {}, settings = {}) {
    return meta.injectionMethod || settings.injectionMethod || 'inline';
}

/** @returns {null | string} Lore N / Lore 0 / Lore —, or null when setting off */
export function formatLoreChipLabel({ settings = {}, meta = {}, trace = null } = {}) {
    if (settings.sceneSourceTrace !== true) return null;
    const mode = _mode(meta, settings);
    if (mode !== 'inline') return 'Lore —';
    if (!trace || typeof trace !== 'object') return 'Lore —';
    const entries = Array.isArray(trace.lorebook?.entries) ? trace.lorebook.entries : [];
    const count = Number.isFinite(trace.lorebook?.count) ? trace.lorebook.count : entries.length;
    if (!trace.lorebook) return 'Lore —';
    if (!entries.length && count === 0) return 'Lore 0';
    return `Lore ${count}`;
}

function _displayKeys(entry) {
    if (Array.isArray(entry?.matchedKeys) && entry.matchedKeys.length) {
        return entry.matchedKeys.map(String).filter(Boolean);
    }
    // Legacy v1: show only plain (non-regex) keys
    const keys = Array.isArray(entry?.keys) ? entry.keys : [];
    return keys.map(String).filter(k => k && !_isRegexKey(k));
}

/** world — title — match… / constant / — */
export function formatTraceEntryLine(entry) {
    const world = String(entry?.world || '').trim() || '—';
    const title = String(entry?.title || entry?.comment || entry?.uid || '').trim() || '—';
    if (entry?.matchKind === 'constant') {
        return `${world} — ${title} — constant`;
    }
    const keys = _displayKeys(entry);
    if (!keys.length) return `${world} — ${title} — —`;
    return [world, title, ...keys].join(' — ');
}

/**
 * @returns {{ chip: string|null, capturedAt: string, emptyKey: string|null, groups: Array<{world:string, items:Array<{line:string, uid:string}>}>, omitted: number }}
 */
export function buildTraceDrawerModel({ settings = {}, meta = {}, trace = null } = {}) {
    const chip = formatLoreChipLabel({ settings, meta, trace });
    const capturedAt = trace?.capturedAt || '';
    const omitted = Number(trace?.lorebook?.omitted) || 0;
    if (chip == null) {
        return { chip: null, capturedAt: '', emptyKey: null, groups: [], omitted: 0 };
    }
    const mode = _mode(meta, settings);
    if (mode !== 'inline') {
        return { chip, capturedAt, emptyKey: 'together_only', groups: [], omitted: 0 };
    }
    if (!trace) {
        return { chip, capturedAt: '', emptyKey: 'no_capture', groups: [], omitted: 0 };
    }
    const entries = Array.isArray(trace.lorebook?.entries) ? trace.lorebook.entries : [];
    if (!entries.length) {
        return { chip, capturedAt, emptyKey: 'no_activations', groups: [], omitted };
    }
    const map = new Map();
    for (const entry of entries) {
        const world = String(entry.world || '').trim() || '—';
        if (!map.has(world)) map.set(world, []);
        map.get(world).push({
            line: formatTraceEntryLine(entry),
            uid: entry.uid != null ? String(entry.uid) : '',
        });
    }
    const groups = [...map.entries()].map(([world, items]) => ({ world, items }));
    return { chip, capturedAt, emptyKey: null, groups, omitted };
}
