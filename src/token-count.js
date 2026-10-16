// Match ST 1.17+ tokenizers.guesstimate. Estimates remain model-independent;
// never apply the current connection's tokenizer to an unrelated profile.
const encoder = new TextEncoder();
const BYTES_PER_TOKEN = 3.35;

export function estimateTokens(text) {
    return Math.ceil(encoder.encode(String(text ?? '')).length / BYTES_PER_TOKEN);
}

export async function countTextTokens(text, context) {
    const value = String(text ?? '');
    try {
        if (typeof context?.getTokenCountAsync === 'function') {
            const tokens = await context.getTokenCountAsync(value);
            if (Number.isFinite(tokens) && tokens >= 0) {
                return { tokens: Math.round(tokens), source: 'st-tokenizer' };
            }
        }
    } catch { /* Tokenizer unavailable: retain a usable estimate. */ }
    return { tokens: estimateTokens(value), source: 'heuristic' };
}
