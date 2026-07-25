import { fnv1aHex } from './hash.js';

const DEPTH_FALLBACK = 10;

/** Normalize WI scan depth: 0 is valid (empty haystack); invalid → fallback. */
export function normalizeScanDepth(depth, fallback = DEPTH_FALLBACK) {
    const n = Number(depth);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.floor(n);
}

export function capturePreGenScanContext(chat, { depth = 10, includeNames = false } = {}) {
    const list = Array.isArray(chat) ? chat : [];
    const n = normalizeScanDepth(depth, DEPTH_FALLBACK);
    if (n === 0) {
        const buffer = '';
        return {
            depth: 0,
            includeNames: !!includeNames,
            messageIds: [],
            messages: [],
            buffer,
            bufferHash: fnv1aHex(buffer),
        };
    }
    const slice = list.slice(-n);
    const startIdx = Math.max(0, list.length - slice.length);
    const messageIds = slice.map((_, i) => startIdx + i);
    // Freeze mes texts at capture time so finish never re-reads live/regen chat.
    const messages = slice.map((m, i) => ({
        messageId: startIdx + i,
        mes: String(m?.mes ?? ''),
        name: String(m?.name ?? ''),
    }));
    const parts = messages.map(m => {
        if (!includeNames) return m.mes;
        const name = m.name.trim();
        return name ? `${name}: ${m.mes}` : m.mes;
    });
    const buffer = parts.join('\n');
    return {
        depth: n,
        includeNames: !!includeNames,
        messageIds,
        messages,
        buffer,
        bufferHash: fnv1aHex(buffer),
    };
}
