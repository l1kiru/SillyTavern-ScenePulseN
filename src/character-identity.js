// ScenePulse — shared character identity helpers

export const characterNameKey = value => String(value || '').toLowerCase().trim();

/**
 * Resolve canonical names and aliases without guessing when an alias belongs
 * to more than one character. Exact canonical names always win.
 */
export function buildCharacterNameMap(characters) {
    const canonical = new Map();
    const aliasOwners = new Map();
    for (const ch of Array.isArray(characters) ? characters : []) {
        const name = String(ch?.name || '').trim();
        const key = characterNameKey(name);
        if (!key) continue;
        canonical.set(key, name);
        for (const alias of Array.isArray(ch.aliases) ? ch.aliases : []) {
            const aliasKey = characterNameKey(alias);
            if (!aliasKey || aliasKey === key) continue;
            if (!aliasOwners.has(aliasKey)) aliasOwners.set(aliasKey, new Set());
            aliasOwners.get(aliasKey).add(key);
        }
    }
    const result = new Map(canonical);
    for (const [aliasKey, owners] of aliasOwners) {
        if (canonical.has(aliasKey) || owners.size !== 1) continue;
        const ownerKey = owners.values().next().value;
        result.set(aliasKey, canonical.get(ownerKey));
    }
    return result;
}

export function updateCharacterField(characters, name, field, value) {
    const key = characterNameKey(name);
    if (!key || !Array.isArray(characters)) return false;
    const target = characters.find(ch => characterNameKey(ch?.name) === key);
    if (!target) return false;
    target[field] = value;
    return true;
}
