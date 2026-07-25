import { EvidenceLevel, evidence } from '../evidence.js';

/** Merge diagnostic fact without overriding engine accepted stage. */
export function reconcileDiagnosticEvent(entry, diagEvent) {
    if (!entry || !diagEvent) return entry;
    const out = {
        ...entry,
        stages: { ...(entry.stages || {}) },
        triggers: Array.isArray(entry.triggers) ? entry.triggers.slice() : [],
    };

    if (diagEvent.kind === 'primary_match' && diagEvent.key) {
        out.triggers.push({
            type: 'primary_key',
            originalKey: diagEvent.key,
            matchedText: diagEvent.key,
            evidence: evidence(EvidenceLevel.DIAGNOSTIC, 0.6),
        });
    } else if (diagEvent.kind === 'sticky') {
        out.triggers.push({
            type: 'sticky',
            evidence: evidence(EvidenceLevel.DIAGNOSTIC, 0.55),
        });
    }

    return out;
}
