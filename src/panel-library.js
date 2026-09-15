// ScenePulse — reusable Custom Panel set library.
// Stored locally in the browser and intentionally separate from profile seeds
// and per-chat panel working copies.

export const PANEL_LIBRARY_STORAGE_KEY = 'scenepulse_panel_library_v1';

function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function cleanName(value) {
    return String(value || '').trim();
}

export function stripPanelLibraryProvenance(panels) {
    return (Array.isArray(panels) ? clone(panels) : []).map(panel => {
        if (!panel || typeof panel !== 'object') return panel;
        const clean = { ...panel };
        delete clean.sourceLibraryId;
        delete clean.sourceLibraryName;
        return clean;
    });
}

function makeId() {
    return `panelset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function panelSetNameFromFilename(filename) {
    const base = String(filename || '')
        .replace(/\.json$/i, '')
        .replace(/^scenepulse[-_ ]*panels[-_ ]*/i, '')
        .trim();
    return base || 'Imported Panels';
}

export function loadPanelLibrary(storage) {
    try {
        const target = storage ?? globalThis.localStorage;
        const raw = target?.getItem?.(PANEL_LIBRARY_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter(entry => entry && typeof entry === 'object'
                && typeof entry.id === 'string'
                && typeof entry.name === 'string'
                && Array.isArray(entry.panels))
            .map(entry => ({
                ...entry,
                enabled: entry.enabled === true,
                panels: stripPanelLibraryProvenance(entry.panels),
            }));
    } catch {
        return [];
    }
}

export function savePanelLibrary(library, storage) {
    try {
        const target = storage ?? globalThis.localStorage;
        if(typeof target?.setItem !== 'function') return false;
        target.setItem(PANEL_LIBRARY_STORAGE_KEY, JSON.stringify(Array.isArray(library) ? library : []));
        return true;
    } catch {
        return false;
    }
}

export function upsertPanelSet(library, { name, panels, sourceFile = '', id = '', enabled } = {}) {
    const safeName = cleanName(name) || 'Panel Set';
    const next = Array.isArray(library) ? clone(library) : [];
    const explicitId = cleanName(id);
    let index = explicitId ? next.findIndex(entry => entry?.id === explicitId) : -1;
    if (index < 0) {
        const key = safeName.toLowerCase();
        index = next.findIndex(entry => cleanName(entry?.name).toLowerCase() === key);
    }

    const now = new Date().toISOString();
    const previous = index >= 0 ? next[index] : null;
    const entry = {
        id: previous?.id || explicitId || makeId(),
        name: safeName,
        panels: stripPanelLibraryProvenance(panels),
        sourceFile: String(sourceFile || previous?.sourceFile || ''),
        enabled: typeof enabled === 'boolean' ? enabled : previous?.enabled === true,
        createdAt: previous?.createdAt || now,
        updatedAt: now,
    };

    if (index >= 0) next[index] = entry;
    else next.push(entry);
    return { library: next, entry, replaced: index >= 0 };
}

export function removePanelSet(library, id) {
    const key = cleanName(id);
    if (!Array.isArray(library) || !key) return Array.isArray(library) ? clone(library) : [];
    return clone(library.filter(entry => entry?.id !== key));
}

/**
 * Convert panels stamped from one library set into ordinary chat-local panels.
 * Used when the source set is removed from the library so the current chat keeps
 * its panel definitions without carrying a dead sourceLibraryId badge forever.
 * Mutates the supplied chat array intentionally; caller owns persistence.
 */
export function detachLibraryPanels(chatPanels, libraryId) {
    const key = cleanName(libraryId);
    if (!Array.isArray(chatPanels) || !key) return 0;
    let detached = 0;
    for (const panel of chatPanels) {
        if (!panel || typeof panel !== 'object') continue;
        if (cleanName(panel.sourceLibraryId) !== key) continue;
        delete panel.sourceLibraryId;
        delete panel.sourceLibraryName;
        detached++;
    }
    return detached;
}

export function setPanelSetEnabled(library, id, enabled) {
    const key = cleanName(id);
    const next = Array.isArray(library) ? clone(library) : [];
    const index = next.findIndex(entry => entry?.id === key);
    if (index < 0) return { library: next, entry: null, changed: false };
    const wasEnabled = next[index].enabled === true;
    const nowEnabled = enabled === true;
    const entry = { ...next[index], enabled: nowEnabled, updatedAt: new Date().toISOString() };
    next[index] = entry;
    return { library: next, entry, changed: wasEnabled !== nowEnabled };
}

export function stampLibraryPanels(entry) {
    const sourceLibraryId = cleanName(entry?.id);
    const sourceLibraryName = cleanName(entry?.name);
    return stripPanelLibraryProvenance(entry?.panels).map(panel => ({
        ...panel,
        sourceLibraryId,
        sourceLibraryName,
    }));
}

export function getEnabledLibrarySets(library) {
    return (Array.isArray(library) ? library : []).filter(entry => entry && entry.enabled === true && cleanName(entry.id));
}

function panelFieldKeys(panel) {
    const scope = String(panel?.scope || 'global').trim().toLowerCase() === 'character' ? 'character' : 'global';
    return (Array.isArray(panel?.fields) ? panel.fields : [])
        .map(field => `${scope}:${String(field?.key || '').trim().toLowerCase()}`)
        .filter(key => !key.endsWith(':'));
}

export function syncPinnedLibraryPanels(chatPanels, library) {
    const target = Array.isArray(chatPanels) ? chatPanels : [];
    const enabled = getEnabledLibrarySets(library);
    const libraryIds = new Set((Array.isArray(library) ? library : []).map(entry => cleanName(entry?.id)).filter(Boolean));
    let detachedStale = 0;
    const local = [];
    for (const panel of target) {
        const source = cleanName(panel?.sourceLibraryId);
        if (source && libraryIds.has(source)) continue;
        if (source && !libraryIds.has(source) && panel && typeof panel === 'object') {
            const detached = { ...panel };
            delete detached.sourceLibraryId;
            delete detached.sourceLibraryName;
            local.push(detached);
            detachedStale++;
        } else {
            local.push(panel);
        }
    }
    const usedKeys = new Set(local.flatMap(panelFieldKeys));
    const usedPanelIds = new Set(local.map(panel => cleanName(panel?.id)).filter(Boolean));
    const usedPanelNames = new Set(local.map(panel => cleanName(panel?.name).toLowerCase().replace(/\s+/g, '_')).filter(Boolean));
    const added = [];
    const skipped = [];
    for (const entry of enabled) {
        for (const panel of stampLibraryPanels(entry)) {
            const keys = panelFieldKeys(panel);
            const collidingKeys = keys.filter(key => usedKeys.has(key));
            const panelId = cleanName(panel?.id);
            const panelNameKey = cleanName(panel?.name).toLowerCase().replace(/\s+/g, '_');
            const idCollision = !!panelId && usedPanelIds.has(panelId);
            const nameCollision = !!panelNameKey && usedPanelNames.has(panelNameKey);
            if (collidingKeys.length || idCollision || nameCollision) {
                skipped.push({
                    sourceLibraryId: entry.id,
                    name: panel.name,
                    keys: collidingKeys,
                    panelId: idCollision ? panelId : '',
                    panelName: nameCollision ? panelNameKey : '',
                });
                continue;
            }
            for (const key of keys) usedKeys.add(key);
            if (panelId) usedPanelIds.add(panelId);
            if (panelNameKey) usedPanelNames.add(panelNameKey);
            added.push(panel);
        }
    }
    const panels = [...local, ...added];
    const changed = JSON.stringify(target) !== JSON.stringify(panels);
    return {
        panels,
        changed,
        added: added.length,
        removed: target.length - local.length,
        detachedStale,
        skipped: skipped.length,
        skippedPanels: skipped,
    };
}
