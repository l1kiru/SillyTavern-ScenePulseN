import { EvidenceLevel, evidence } from './evidence.js';

export const WI_LOGIC = { AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 };

const MAX_MATCHED_KEY_LEN = 80;

function _str(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
}

function _truncateMatch(text) {
    const s = _str(text);
    if (!s) return '';
    return s.length > MAX_MATCHED_KEY_LEN ? s.slice(0, MAX_MATCHED_KEY_LEN - 1) + '…' : s;
}

function _escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function _caseSensitive(entry, settings) {
    if (entry?.caseSensitive != null) return !!entry.caseSensitive;
    return !!settings?.caseSensitive;
}

function _matchWholeWords(entry, settings) {
    if (entry?.matchWholeWords != null) return !!entry.matchWholeWords;
    return !!settings?.matchWholeWords;
}

function _transform(str, caseSensitive) {
    return caseSensitive ? str : str.toLowerCase();
}

/**
 * ST-like single key match against haystack.
 * @returns {{ hit: string, index: number, groups: object|null, originalKey: string }|null}
 */
export function matchOneKey(haystack, needle, entry = {}, settings = {}) {
    const key = _str(needle);
    if (!key || haystack == null) return null;
    const text = String(haystack);

    const rx = parseWiRegexKey(key);
    if (rx) {
        try {
            if (rx.global || rx.sticky) rx.lastIndex = 0;
            const m = rx.exec(text);
            if (!m || !m[0]) return null;
            return {
                hit: _truncateMatch(m[0]),
                index: m.index,
                groups: m.groups || null,
                originalKey: key,
            };
        } catch {
            return null;
        }
    }

    const caseSensitive = _caseSensitive(entry, settings);
    const whole = _matchWholeWords(entry, settings);
    const hay = _transform(text, caseSensitive);
    const needleT = _transform(key, caseSensitive);

    if (whole) {
        const words = needleT.split(/\s+/).filter(Boolean);
        if (words.length > 1) {
            const idx = hay.indexOf(needleT);
            if (idx < 0) return null;
            return { hit: _truncateMatch(text.slice(idx, idx + key.length) || key), index: idx, groups: null, originalKey: key };
        }
        const wrx = new RegExp(`(?:^|\\W)(${_escapeRegex(needleT)})(?:$|\\W)`, caseSensitive ? '' : 'i');
        const m = wrx.exec(text);
        if (!m) return null;
        const full = m[1] || m[0];
        const index = m.index + (m[0].length - full.length > 0 && !/^\w/.test(m[0]) ? 1 : 0);
        // Prefer capture group index when available
        const groupIndex = m[1] != null ? text.toLowerCase().indexOf(m[1].toLowerCase(), m.index) : m.index;
        return {
            hit: _truncateMatch(caseSensitive ? full : text.slice(groupIndex, groupIndex + full.length) || full),
            index: groupIndex >= 0 ? groupIndex : m.index,
            groups: null,
            originalKey: key,
        };
    }

    const idx = hay.indexOf(needleT);
    if (idx < 0) return null;
    return {
        hit: _truncateMatch(text.slice(idx, idx + key.length) || key),
        index: idx,
        groups: null,
        originalKey: key,
    };
}

function _keysOf(entry) {
    const primary = [
        ...(Array.isArray(entry?.keys) ? entry.keys : []),
        ...(Array.isArray(entry?.key) ? entry.key : []),
    ].map(_str).filter(Boolean);
    return [...new Set(primary)];
}

function _secondaryOf(entry) {
    const sec = Array.isArray(entry?.keysecondary)
        ? entry.keysecondary
        : (Array.isArray(entry?.secondaryKeys) ? entry.secondaryKeys : []);
    return sec.map(_str).filter(Boolean);
}

function _selectiveOk(logic, secondaryHits, secondaryCount) {
    const L = Number(logic);
    const any = secondaryHits > 0;
    const all = secondaryCount > 0 && secondaryHits === secondaryCount;
    if (L === WI_LOGIC.AND_ANY) return any;
    if (L === WI_LOGIC.NOT_ALL) return !all;
    if (L === WI_LOGIC.NOT_ANY) return !any;
    if (L === WI_LOGIC.AND_ALL) return all;
    return any;
}

/**
 * @returns {{ triggers: object[], matchedKeys: string[], matchKind: string }}
 */
export function inferTriggersForEntry(entry, buffer, settings = {}) {
    if (entry?.constant) {
        return {
            triggers: [{ type: 'constant', evidence: evidence(EvidenceLevel.ENGINE) }],
            matchedKeys: [],
            matchKind: 'constant',
        };
    }

    const text = String(buffer || '');
    const primaryKeys = _keysOf(entry);
    const secondaryKeys = _secondaryOf(entry);
    const logic = entry?.selectiveLogic ?? entry?.selective_logic ?? WI_LOGIC.AND_ANY;

    const primaryHits = [];
    for (const key of primaryKeys) {
        const m = matchOneKey(text, key, entry, settings);
        if (m) primaryHits.push(m);
    }

    let secondaryHits = 0;
    for (const key of secondaryKeys) {
        if (matchOneKey(text, key, entry, settings)) secondaryHits++;
    }

    if (secondaryKeys.length && !_selectiveOk(logic, secondaryHits, secondaryKeys.length)) {
        return { triggers: [], matchedKeys: [], matchKind: 'none' };
    }

    if (!primaryHits.length) {
        return { triggers: [], matchedKeys: [], matchKind: 'none' };
    }

    const isRegex = (k) => !!parseWiRegexKey(k);
    const triggers = primaryHits.map(h => ({
        type: 'primary_key',
        originalKey: h.originalKey,
        matchedText: h.hit,
        matchIndex: h.index,
        groups: h.groups,
        evidence: evidence(EvidenceLevel.INFERRED, isRegex(h.originalKey) ? 0.7 : 0.75),
    }));
    const matchedKeys = [...new Set(primaryHits.map(h => h.hit))];
    return { triggers, matchedKeys, matchKind: 'keys' };
}

/** Legacy wrapper used by older tests / call sites. */
export function matchEntryKeys({ keys = [], constant = false, key, keysecondary, selectiveLogic, caseSensitive, matchWholeWords } = {}, buffer = '') {
    const entry = {
        keys: Array.isArray(keys) && keys.length ? keys : (Array.isArray(key) ? key : []),
        key,
        keysecondary,
        selectiveLogic,
        caseSensitive,
        matchWholeWords,
        constant,
    };
    const { matchedKeys, matchKind } = inferTriggersForEntry(entry, buffer, {});
    return { matchedKeys, matchKind };
}
