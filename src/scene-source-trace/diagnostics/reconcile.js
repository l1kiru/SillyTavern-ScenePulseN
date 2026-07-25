import { EvidenceLevel, evidence } from '../evidence.js';
import { entryKey } from '../event-adapters.js';

/** Whether a diagnostic event is targeted at this lorebook entry. */
export function diagnosticEventMatchesEntry(entry, diagEvent) {
    if (!entry || !diagEvent) return false;

    if (diagEvent.world != null && String(diagEvent.world) !== ''
        && diagEvent.uid != null && String(diagEvent.uid) !== '') {
        return entryKey(entry.world, entry.uid) === entryKey(diagEvent.world, diagEvent.uid);
    }

    if (diagEvent.uid != null && String(diagEvent.uid) !== '') {
        return String(entry.uid) === String(diagEvent.uid);
    }

    if (diagEvent.kind === 'primary_match' && diagEvent.key) {
        const needle = String(diagEvent.key);
        const keys = [
            ...(Array.isArray(entry.keys) ? entry.keys : []),
            ...(Array.isArray(entry.key) ? entry.key : []),
            ...(Array.isArray(entry.matchedKeys) ? entry.matchedKeys : []),
        ].map(String);
        return keys.includes(needle);
    }

    // No targeting info — never broadcast to every entry.
    return false;
}

/** Merge diagnostic fact without overriding engine accepted stage. */
export function reconcileDiagnosticEvent(entry, diagEvent) {
    if (!entry || !diagEvent) return entry;
    if (!diagnosticEventMatchesEntry(entry, diagEvent)) return entry;

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
