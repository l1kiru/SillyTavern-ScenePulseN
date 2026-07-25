import { EvidenceLevel, evidence } from './evidence.js';

export { EvidenceLevel, evidence };

/** @returns {object|null} v3-shaped view; never invents loops for v2 */
export function migrateTraceToV3View(trace) {
    if (!trace || typeof trace !== 'object') return null;
    if (trace.v === 3) return trace;

    const entries = Array.isArray(trace.lorebook?.entries) ? trace.lorebook.entries : [];
    const mapped = entries.map(e => {
        const matchKind = e.matchKind || (e.constant ? 'constant' : 'none');
        const triggers = [];
        if (matchKind === 'constant') {
            triggers.push({ type: 'constant', evidence: evidence(EvidenceLevel.ENGINE) });
        } else if (Array.isArray(e.matchedKeys) && e.matchedKeys.length) {
            for (const k of e.matchedKeys) {
                triggers.push({
                    type: 'primary_key',
                    matchedText: String(k),
                    evidence: evidence(EvidenceLevel.INFERRED, 0.6),
                });
            }
        } else {
            triggers.push({ type: 'unknown', evidence: evidence(EvidenceLevel.UNKNOWN) });
        }
        return {
            world: e.world || '',
            uid: e.uid || '',
            title: e.title || '',
            tokens: Number.isFinite(e.tokens) ? e.tokens : 0,
            stages: { accepted: { value: true, evidence: EvidenceLevel.ENGINE } },
            firstSeenLoop: null,
            triggers,
            timedEffects: {},
            matchedKeys: Array.isArray(e.matchedKeys) ? e.matchedKeys.slice() : [],
            matchKind,
        };
    });

    return {
        v: 3,
        mode: trace.mode || 'inline',
        capturedAt: trace.capturedAt || '',
        startedAt: trace.startedAt || '',
        settings: {},
        owner: { chatKey: '', messageId: null, swipeId: null },
        lorebooks: [],
        loadedEntryKeys: [],
        candidates: [],
        lorebook: {
            count: mapped.length,
            totalEvents: trace.lorebook?.totalEvents || 0,
            entries: mapped,
            ...(trace.lorebook?.omitted ? { omitted: trace.lorebook.omitted } : {}),
        },
        loops: [],
        events: [],
        summary: {
            loadedEntries: 0,
            acceptedEntries: mapped.length,
            candidateEntries: 0,
            inferredTriggers: mapped.reduce(
                (n, e) => n + e.triggers.filter(t => t.evidence?.type === EvidenceLevel.INFERRED).length,
                0,
            ),
            recursionLoops: 0,
            budgetOverflowed: false,
            stickyCount: 0,
        },
    };
}
