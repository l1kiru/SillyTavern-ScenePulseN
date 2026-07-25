/** FNV-1a 32-bit → hex (shared by scan-context + fingerprints). */
export function fnv1aHex(str) {
    const s = String(str ?? '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
}
