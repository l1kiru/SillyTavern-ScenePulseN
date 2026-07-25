import { entryKey } from './event-adapters.js';

/**
 * Best-effort explanations from observables only.
 * @returns {{ lines: string[], evidence: 'inferred'|'unknown'|'engine' }}
 */
export function explainWhyNot(candidateOrEntry, { trace } = {}) {
    const lines = [];
    let evid = 'unknown';
    if (!candidateOrEntry) return { lines: ['No entry'], evidence: evid };

    if (candidateOrEntry.rejection?.evidence === 'engine' || candidateOrEntry.rejection?.reason) {
        evid = candidateOrEntry.rejection.evidence === 'engine' ? 'engine' : 'inferred';
        const reason = candidateOrEntry.rejection.reason || 'rejected';
        if (reason === 'secondary_failed') {
            lines.push('Secondary condition failed');
            if (candidateOrEntry.selectiveEvaluation?.logic) {
                lines.push(`Selective logic: ${candidateOrEntry.selectiveEvaluation.logic}`);
            }
        } else if (reason === 'content_empty_after_regex') {
            lines.push('Content empty after prompt-regex');
        } else if (reason === 'budget_rejected') {
            lines.push('Rejected by World Info budget');
        } else {
            lines.push(`Rejected: ${reason}`);
        }
        return { lines, evidence: evid };
    }

    if (candidateOrEntry.stages?.rendered?.value === false) {
        evid = candidateOrEntry.stages.rendered.evidence === 'engine' ? 'engine' : 'inferred';
        lines.push('Content empty after prompt-regex');
        return { lines, evidence: evid };
    }

    const key = entryKey(candidateOrEntry.world, candidateOrEntry.uid);
    const loaded = Array.isArray(trace?.loadedEntryKeys) ? trace.loadedEntryKeys : [];
    const accepted = new Set(
        (trace?.lorebook?.entries || []).map(e => entryKey(e.world, e.uid)),
    );
    const isCandidate = loaded.includes(key) && !accepted.has(key);

    if (isCandidate && trace?.summary?.budgetOverflowed) {
        evid = 'inferred';
        lines.push('Loaded but not accepted; budget overflow suspected');
    } else if (isCandidate) {
        evid = 'inferred';
        lines.push('Loaded but not accepted');
    }

    if (candidateOrEntry.stages?.accepted?.value && candidateOrEntry.matchKind === 'none') {
        evid = 'inferred';
        lines.push('No inferred primary key in pre-gen context');
    }

    if (!lines.length) {
        lines.push('Reason unknown');
        evid = 'unknown';
    }
    return { lines, evidence: evid };
}
