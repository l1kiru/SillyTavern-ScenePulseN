import { fnv1aHex } from './hash.js';

export function capturePreGenScanContext(chat, { depth = 10, includeNames = false } = {}) {
    const list = Array.isArray(chat) ? chat : [];
    const n = Math.max(1, Number(depth) || 10);
    const slice = list.slice(-n);
    const startIdx = Math.max(0, list.length - slice.length);
    const messageIds = slice.map((_, i) => startIdx + i);
    const parts = slice.map(m => {
        const mes = String(m?.mes ?? '');
        if (!includeNames) return mes;
        const name = String(m?.name ?? '').trim();
        return name ? `${name}: ${mes}` : mes;
    });
    const buffer = parts.join('\n');
    return {
        depth: n,
        includeNames: !!includeNames,
        messageIds,
        buffer,
        bufferHash: fnv1aHex(buffer),
    };
}
