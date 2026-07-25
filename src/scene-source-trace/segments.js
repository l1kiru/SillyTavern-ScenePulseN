import { inferTriggersForEntry, matchOneKey } from './matcher.js';
import { EvidenceLevel, evidence } from './evidence.js';

/**
 * @returns {Array<{ type: string, messageId: number|null, depth: number|null, text: string }>}
 */
export function buildInferredSegments({
    chat,
    depth = 10,
    includeNames = false,
    character = null,
    persona = null,
    recurseTexts = [],
} = {}) {
    const segs = [];
    const list = Array.isArray(chat) ? chat : [];
    const n = Math.max(1, Number(depth) || 10);
    const slice = list.slice(-n);
    const startIdx = Math.max(0, list.length - slice.length);
    slice.forEach((m, i) => {
        const messageId = startIdx + i;
        const depthFromEnd = slice.length - i;
        segs.push({
            type: 'chat_message',
            messageId,
            depth: depthFromEnd,
            text: String(m?.mes ?? ''),
        });
        if (includeNames && m?.name) {
            segs.push({
                type: 'speaker_name',
                messageId,
                depth: depthFromEnd,
                text: String(m.name),
            });
        }
    });

    const char = character || {};
    if (char.description) {
        segs.push({ type: 'character_description', messageId: null, depth: null, text: String(char.description) });
    }
    if (char.personality) {
        segs.push({ type: 'character_personality', messageId: null, depth: null, text: String(char.personality) });
    }
    if (char.scenario) {
        segs.push({ type: 'scenario', messageId: null, depth: null, text: String(char.scenario) });
    }
    const notes = char.data?.creator_notes ?? char.creatorcomment ?? char.creator_notes;
    if (notes) {
        segs.push({ type: 'creator_notes', messageId: null, depth: null, text: String(notes) });
    }

    const personaDesc = persona?.description ?? persona?.persona_description;
    if (personaDesc) {
        segs.push({ type: 'persona_description', messageId: null, depth: null, text: String(personaDesc) });
    }

    for (const text of recurseTexts || []) {
        if (text) segs.push({ type: 'recursive_wi', messageId: null, depth: null, text: String(text) });
    }

    return segs;
}

/**
 * Prefer first segment that yields a primary key hit; attach inferred source.
 */
export function inferTriggerSources(entry, segments, settings = {}) {
    const flat = inferTriggersForEntry(entry, (segments || []).map(s => s.text).join('\n'), settings);
    if (flat.matchKind === 'constant' || flat.matchKind === 'none') return flat.triggers;

    const keys = [
        ...(Array.isArray(entry?.keys) ? entry.keys : []),
        ...(Array.isArray(entry?.key) ? entry.key : []),
    ];
    for (const seg of segments || []) {
        for (const key of keys) {
            const m = matchOneKey(seg.text, key, entry, settings);
            if (!m) continue;
            return [{
                type: 'primary_key',
                originalKey: m.originalKey,
                matchedText: m.hit,
                matchIndex: m.index,
                groups: m.groups,
                evidence: evidence(EvidenceLevel.INFERRED, 0.7),
                source: {
                    type: seg.type,
                    messageId: seg.messageId,
                    depth: seg.depth,
                    evidence: evidence(EvidenceLevel.INFERRED, 0.65),
                },
            }];
        }
    }
    return flat.triggers;
}
