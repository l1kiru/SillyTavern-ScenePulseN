export const EvidenceLevel = {
    ENGINE: 'engine',
    DIAGNOSTIC: 'diagnostic',
    INFERRED: 'inferred',
    UNKNOWN: 'unknown',
};

export const EVIDENCE_RANK = {
    [EvidenceLevel.UNKNOWN]: 0,
    [EvidenceLevel.INFERRED]: 1,
    [EvidenceLevel.DIAGNOSTIC]: 2,
    [EvidenceLevel.ENGINE]: 3,
};

export function evidence(type, confidence) {
    const out = { type };
    if (Number.isFinite(confidence)) out.confidence = confidence;
    return out;
}

/** Highest evidence level among entry triggers. */
export function getBestEvidence(entry) {
    let best = EvidenceLevel.UNKNOWN;
    for (const trigger of entry?.triggers ?? []) {
        const type = trigger?.evidence?.type;
        if ((EVIDENCE_RANK[type] ?? 0) > (EVIDENCE_RANK[best] ?? 0)) {
            best = type;
        }
    }
    return best;
}
