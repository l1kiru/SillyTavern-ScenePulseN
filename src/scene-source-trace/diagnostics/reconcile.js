import { EvidenceLevel, evidence } from '../evidence.js';
import { entryKey } from '../event-adapters.js';

function _entryKeys(entry) {
    return [
        ...(Array.isArray(entry?.keys) ? entry.keys : []),
        ...(Array.isArray(entry?.key) ? entry.key : []),
        ...(Array.isArray(entry?.matchedKeys) ? entry.matchedKeys : []),
    ].map(String);
}

/**
 * Resolve which lorebook entry a diagnostic event targets.
 * @returns {string|null} entryKey or null when ambiguous / untargeted
 */
export function resolveDiagnosticTarget(entries, diagEvent) {
    if (!diagEvent || !Array.isArray(entries)) return null;

    if (diagEvent.world != null && String(diagEvent.world) !== ''
        && diagEvent.uid != null && String(diagEvent.uid) !== '') {
        const key = entryKey(diagEvent.world, diagEvent.uid);
        return entries.some(e => entryKey(e.world, e.uid) === key) ? key : null;
    }

    if (diagEvent.kind === 'primary_match' && diagEvent.key) {
        const needle = String(diagEvent.key);
        const matches = entries.filter(e => _entryKeys(e).includes(needle));
        if (matches.length === 1) return entryKey(matches[0].world, matches[0].uid);
        return null;
    }

    // No world+uid and not a uniquely keyed primary — refuse (incl. uid-only).
    return null;
}

/** Merge diagnostic fact without overriding engine accepted stage. Caller must target. */
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
