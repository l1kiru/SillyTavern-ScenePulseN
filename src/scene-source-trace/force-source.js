/**
 * Safe heuristics only — default external.
 * @returns {{ source: 'vectors'|'wi_function_call'|'external', confidence: number }}
 */
export function classifyForceEntries(entries) {
    const list = Array.isArray(entries) ? entries : [];
    if (list.some(e => e?.vectorized === true || e?.extensions?.vectorized === true)) {
        return { source: 'vectors', confidence: 0.8 };
    }
    if (list.some(e => Array.isArray(e?.decorators) && e.decorators.includes('@@activate'))) {
        return { source: 'wi_function_call', confidence: 0.5 };
    }
    return { source: 'external', confidence: 0.4 };
}
