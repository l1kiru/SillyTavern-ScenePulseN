export const PARSER_ID = 'st-1.18';

export function probeWiLogFormat(sampleLines) {
    const lines = Array.isArray(sampleLines) ? sampleLines : [];
    let wi = 0;
    let known = 0;
    for (const line of lines) {
        const s = String(line || '');
        if (!s.includes('[WI]')) continue;
        wi++;
        if (parseWiConsoleArgs([s])) known++;
    }
    if (wi === 0) return { ok: true, parserId: PARSER_ID };
    return { ok: known > 0, parserId: PARSER_ID };
}

/**
 * @returns {null | { kind: string, world?: string, uid?: string|number, key?: string, detail?: string }}
 */
export function parseWiConsoleArgs(args) {
    const text = (Array.isArray(args) ? args : [args]).map(a => {
        if (typeof a === 'string') return a;
        if (a && typeof a === 'object') {
            try { return JSON.stringify(a); } catch { return String(a); }
        }
        return String(a ?? '');
    }).join(' ');

    if (!text.includes('[WI]') && !/primary key match/i.test(text) && !/sticky/i.test(text)) {
        return null;
    }

    if (/primary key match/i.test(text)) {
        return { kind: 'primary_match', detail: text.slice(0, 200) };
    }
    if (/activated because active sticky/i.test(text) || /is sticky/i.test(text)) {
        return { kind: 'sticky', detail: text.slice(0, 200) };
    }
    if (/cooldown/i.test(text)) {
        return { kind: 'cooldown', detail: text.slice(0, 200) };
    }
    if (/delay/i.test(text) && /\[WI\]/i.test(text)) {
        return { kind: 'delay', detail: text.slice(0, 200) };
    }
    if (/budget/i.test(text) && /\[WI\]/i.test(text)) {
        return { kind: 'budget', detail: text.slice(0, 200) };
    }
    if (/\[WI\]/.test(text)) {
        return { kind: 'other', detail: text.slice(0, 200) };
    }
    return null;
}
