export const WI_SCAN_STATE = { NONE: 0, INITIAL: 1, RECURSION: 2, MIN_ACTIVATIONS: 3 };

export function entryKey(world, uid) {
    return `${String(world ?? '')}::${String(uid ?? '')}`;
}

export function scanStateName(n) {
    if (n === 1) return 'INITIAL';
    if (n === 2) return 'RECURSION';
    if (n === 3) return 'MIN_ACTIVATIONS';
    return 'NONE';
}

export function snapshotScanDone(args) {
    const map = args?.activated?.entries;
    const accepted = [];
    if (map instanceof Map) {
        for (const entry of map.values()) {
            accepted.push(entryKey(entry?.world, entry?.uid));
        }
    }
    const timed = {};
    if (map instanceof Map && args?.timedEffects?.isEffectActive) {
        for (const entry of map.values()) {
            const key = entryKey(entry?.world, entry?.uid);
            try {
                timed[key] = {
                    sticky: !!args.timedEffects.isEffectActive('sticky', entry),
                    cooldown: !!args.timedEffects.isEffectActive('cooldown', entry),
                    delay: !!args.timedEffects.isEffectActive('delay', entry),
                };
            } catch {
                timed[key] = { sticky: false, cooldown: false, delay: false };
            }
        }
    }
    return {
        loopCount: Number(args?.state?.loopCount) || 0,
        state: scanStateName(args?.state?.current),
        nextState: scanStateName(args?.state?.next),
        budgetCurrent: Number(args?.budget?.current) || 0,
        budgetOverflowed: !!args?.budget?.overflowed,
        acceptedEntryKeys: accepted.slice(),
        timedEffectsByKey: timed,
        phase: args?.phase || 'scan',
        decisions: Array.isArray(args?.decisions) ? args.decisions.slice() : [],
    };
}

export function snapshotEntriesLoaded(payload) {
    const buckets = [
        ['global', payload?.globalLore],
        ['character', payload?.characterLore],
        ['chat', payload?.chatLore],
        ['persona', payload?.personaLore],
    ];
    const byWorld = new Map();
    const loadedEntryKeys = [];
    const titleByKey = new Map();

    for (const [source, list] of buckets) {
        if (!Array.isArray(list)) continue;
        for (const entry of list) {
            const world = String(entry?.world ?? '').trim() || '—';
            const uid = entry?.uid;
            const key = entryKey(world, uid);
            loadedEntryKeys.push(key);
            const title = String(entry?.comment ?? entry?.title ?? entry?.name ?? (uid != null ? `#${uid}` : '')).trim();
            titleByKey.set(key, { world, uid: uid != null ? String(uid) : '', title });
            if (!byWorld.has(world)) {
                byWorld.set(world, { id: world, name: world, attachmentSources: [] });
            }
            const book = byWorld.get(world);
            if (!book.attachmentSources.includes(source)) book.attachmentSources.push(source);
        }
    }

    return {
        lorebooks: [...byWorld.values()],
        loadedEntryKeys: [...new Set(loadedEntryKeys)],
        loadedCount: loadedEntryKeys.length,
        titleByKey,
    };
}
