import { fnv1aHex } from './hash.js';

export function fingerprintContent(content) {
    const s = String(content ?? '');
    return { hash: fnv1aHex(s), length: s.length };
}

export function extractWiSlotsFromPromptChat(chatMessages) {
    const slots = {
        worldInfoBefore: '',
        worldInfoAfter: '',
        depthTexts: [],
        otherWi: [],
    };
    if (!Array.isArray(chatMessages)) return slots;
    for (const msg of chatMessages) {
        const id = String(msg?.identifier || '');
        const content = String(msg?.content ?? '');
        if (id === 'worldInfoBefore') slots.worldInfoBefore = content;
        else if (id === 'worldInfoAfter') slots.worldInfoAfter = content;
        else if (id.includes('worldInfo') || id.includes('WorldInfo')) slots.otherWi.push(content);
        else if (msg?.injection_depth != null && content) slots.depthTexts.push(content);
    }
    return slots;
}

export function extractTextCompletionSlots(eventData) {
    if (!eventData || eventData.dryRun === true) return null;
    const p = eventData.prompt;
    if (Array.isArray(p)) return null;
    if (typeof p !== 'string' || !p) return null;
    return { textCompletionPrompt: p };
}

/** True when any WI / TC slot family has non-empty text. */
export function slotsHaveContent(slots) {
    if (!slots || typeof slots !== 'object') return false;
    if (slots.worldInfoBefore || slots.worldInfoAfter || slots.textCompletionPrompt) return true;
    if ((slots.depthTexts || []).some(Boolean)) return true;
    if ((slots.otherWi || []).some(Boolean)) return true;
    return false;
}

/**
 * Prefer slots that actually contain text. An empty CC capture must not
 * block matching against a non-empty TC prompt.
 */
export function resolvePromptSlots(cc, tc) {
    const a = slotsHaveContent(cc) ? cc : null;
    const b = slotsHaveContent(tc) ? tc : null;
    if (a && b) {
        return {
            ...a,
            ...b,
            worldInfoBefore: a.worldInfoBefore || b.worldInfoBefore || '',
            worldInfoAfter: a.worldInfoAfter || b.worldInfoAfter || '',
            textCompletionPrompt: a.textCompletionPrompt || b.textCompletionPrompt || '',
            depthTexts: [...(a.depthTexts || []), ...(b.depthTexts || [])],
            otherWi: [...(a.otherWi || []), ...(b.otherWi || [])],
        };
    }
    return a || b || cc || tc || null;
}

/**
 * @param {{ hash: string, length: number }} fingerprint
 * @param {object} slots
 * @param {{ contentHead?: string }} [opts]
 */
export function matchFingerprintInSlots(fingerprint, slots, { contentHead = '' } = {}) {
    const head = String(contentHead || '').trim();
    if (!slots || typeof slots !== 'object') {
        return { status: 'unknown', position: null, confidence: 0 };
    }

    const families = [];
    if (slots.worldInfoBefore) families.push(['worldInfoBefore', slots.worldInfoBefore]);
    if (slots.worldInfoAfter) families.push(['worldInfoAfter', slots.worldInfoAfter]);
    if (slots.textCompletionPrompt) families.push(['text_completion_prompt', slots.textCompletionPrompt]);
    for (const t of slots.depthTexts || []) {
        if (t) families.push(['depth', t]);
    }
    for (const t of slots.otherWi || []) {
        if (t) families.push(['outlet', t]);
    }

    const nonEmpty = families.filter(([, text]) => String(text).length > 0);
    if (!head) {
        if (!nonEmpty.length) return { status: 'no', position: null, confidence: 0.5 };
        return { status: 'possibly', position: null, confidence: 0.4 };
    }

    const hits = nonEmpty.filter(([, text]) => String(text).includes(head));
    if (hits.length === 1) {
        return { status: 'yes', position: hits[0][0], confidence: 0.85 };
    }
    if (hits.length > 1) {
        return { status: 'possibly', position: hits[0][0], confidence: 0.55 };
    }
    if (!nonEmpty.length) {
        return { status: 'no', position: null, confidence: 0.7 };
    }
    return { status: 'possibly', position: null, confidence: 0.45 };
}
