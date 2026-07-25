export const PARSER_ID = 'st-1.18';

export const KNOWN_WI_KINDS = new Set([
    'primary_match',
    'sticky',
    'cooldown',
    'delay',
    'budget',
]);

/** @type {{ uid?: string, world?: string }|null} */
let _lastEntryContext = null;

export function resetParserContext() {
    _lastEntryContext = null;
}

export function getParserContextForTests() {
    return _lastEntryContext ? { ..._lastEntryContext } : null;
}

function _argText(a) {
    if (typeof a === 'string') return a;
    if (a && typeof a === 'object') {
        try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a ?? '');
}

function _extractUidWorld(text) {
    // Real ST: `[WI] Entry ${uid}` — numeric uid. Avoid "Entry with primary..."
    const uidM = String(text).match(/\[WI\]\s*Entry\s+(\d+)\b/i);
    const worldM = String(text).match(/from\s+'([^']+)'/);
    return {
        uid: uidM ? uidM[1] : undefined,
        world: worldM ? worldM[1] : undefined,
    };
}

function _keyAfterPrimaryMatch(args) {
    const arr = Array.isArray(args) ? args : [args];
    for (let i = 0; i < arr.length; i++) {
        if (/primary key match/i.test(_argText(arr[i]))) {
            const next = arr[i + 1];
            if (next == null) return undefined;
            if (typeof next === 'string' || typeof next === 'number') return String(next);
            if (typeof next === 'object' && next.matchedText != null) return String(next.matchedText);
            if (typeof next === 'object' && next.originalKey != null) return String(next.originalKey);
            return undefined;
        }
    }
    return undefined;
}

function _updateContext(uid, world) {
    if (uid == null && world == null) return;
    if (!_lastEntryContext) _lastEntryContext = {};
    if (uid != null) _lastEntryContext.uid = String(uid);
    if (world != null) _lastEntryContext.world = String(world);
}

/**
 * @returns {null | { kind: string, world?: string, uid?: string|number, key?: string, detail?: string }}
 */
export function parseWiConsoleArgs(args) {
    const arr = Array.isArray(args) ? args : [args];
    const text = arr.map(_argText).join(' ');

    if (/---\s*START WI SCAN/i.test(text)) {
        _lastEntryContext = null;
    }

    if (!text.includes('[WI]') && !/primary key match/i.test(text) && !/sticky/i.test(text)) {
        return null;
    }

    let { uid, world } = _extractUidWorld(text);
    if (world != null || (uid != null && /processing/i.test(text))) {
        _updateContext(uid, world);
    } else if (uid != null && _lastEntryContext?.uid === String(uid) && _lastEntryContext.world) {
        world = _lastEntryContext.world;
    } else if (uid != null) {
        _updateContext(uid, world);
    }
    if (uid != null && world != null) _updateContext(uid, world);

    const base = { detail: text.slice(0, 200) };
    if (uid != null) base.uid = uid;
    if (world != null) base.world = world;

    if (/primary key match/i.test(text)) {
        const key = _keyAfterPrimaryMatch(arr);
        return { kind: 'primary_match', ...base, ...(key != null ? { key } : {}) };
    }
    if (/activated because active sticky/i.test(text) || /is sticky/i.test(text)) {
        return { kind: 'sticky', ...base };
    }
    if (/cooldown/i.test(text)) {
        return { kind: 'cooldown', ...base };
    }
    if (/delay/i.test(text) && /\[WI\]/i.test(text)) {
        return { kind: 'delay', ...base };
    }
    if (/budget/i.test(text) && /\[WI\]/i.test(text)) {
        return { kind: 'budget', ...base };
    }
    if (/\[WI\]/.test(text)) {
        return { kind: 'other', ...base };
    }
    return null;
}

/** Pure probe over raw lines — does not mutate parser context. */
export function probeWiLogFormat(sampleLines) {
    const lines = Array.isArray(sampleLines) ? sampleLines : [];
    let wi = 0;
    let known = 0;
    for (const line of lines) {
        const s = String(line || '');
        if (!s.includes('[WI]')) continue;
        wi++;
        // Lightweight kind sniff without stateful parse
        if (/primary key match/i.test(s)
            || /activated because active sticky/i.test(s)
            || /is sticky/i.test(s)
            || (/cooldown/i.test(s) && /\[WI\]/i.test(s))
            || (/delay/i.test(s) && /\[WI\]/i.test(s))
            || (/budget/i.test(s) && /\[WI\]/i.test(s))) {
            known++;
        }
    }
    if (wi === 0) return { ok: true, parserId: PARSER_ID };
    return { ok: known > 0, parserId: PARSER_ID };
}
