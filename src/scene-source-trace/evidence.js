export const EvidenceLevel = {
    ENGINE: 'engine',
    DIAGNOSTIC: 'diagnostic',
    INFERRED: 'inferred',
    UNKNOWN: 'unknown',
};

export function evidence(type, confidence) {
    const out = { type };
    if (Number.isFinite(confidence)) out.confidence = confidence;
    return out;
}
