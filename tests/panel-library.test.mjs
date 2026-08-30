import {
    PANEL_LIBRARY_STORAGE_KEY,
    detachLibraryPanels,
    loadPanelLibrary,
    panelSetNameFromFilename,
    removePanelSet,
    savePanelLibrary,
    setPanelSetEnabled,
    syncPinnedLibraryPanels,
    upsertPanelSet,
} from '../src/panel-library.js';

let pass = 0, fail = 0;
function ok(name, value) {
    if (value) { pass++; console.log('  OK   ' + name); }
    else { fail++; console.log('  FAIL ' + name); }
}
function eq(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    ok(`${name} — expected ${e}, got ${a}`, a === e);
}

function fakeStorage() {
    const data = new Map();
    return {
        getItem: key => data.has(key) ? data.get(key) : null,
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: key => data.delete(key),
        _data: data,
    };
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Custom Panel library');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

eq('filename strips standard prefix', panelSetNameFromFilename('scenepulse-panels-fantasy.json'), 'fantasy');
eq('filename fallback', panelSetNameFromFilename('scenepulse-panels.json'), 'Imported Panels');

const first = upsertPanelSet([], {
    name: 'Fantasy',
    sourceFile: 'fantasy.json',
    panels: [{ id: 'cp_old', name: 'Stats', sourceLibraryId: 'old-owner', sourceLibraryName: 'Old', activationMode: 'auto', activationTags: ['combat'], fields: [{ key: 'health', type: 'meter' }] }],
});
ok('new set is added', first.library.length === 1 && first.replaced === false);
ok('saved set strips chat/library provenance', !first.entry.panels[0].sourceLibraryId && !first.entry.panels[0].sourceLibraryName);

const second = upsertPanelSet(first.library, {
    name: 'fantasy',
    sourceFile: 'fantasy-v2.json',
    panels: [{ id: 'cp_new', name: 'Stats', activationMode: 'auto', activationTags: ['injury'], fields: [{ key: 'health', type: 'number' }] }],
});
ok('same name updates instead of duplicating', second.library.length === 1 && second.replaced === true);
eq('updated set keeps stable id', second.entry.id, first.entry.id);
eq('updated payload replaces panels', second.entry.panels[0].fields[0].type, 'number');
eq('updated payload preserves activation mode', second.entry.panels[0].activationMode, 'auto');
eq('updated payload preserves activation tags', second.entry.panels[0].activationTags, ['injury']);

const storage = fakeStorage();
ok('library saves', savePanelLibrary(second.library, storage));
ok('save reports unavailable storage', savePanelLibrary(second.library, {} ) === false);
ok('storage key is stable', storage._data.has(PANEL_LIBRARY_STORAGE_KEY));
const loaded = loadPanelLibrary(storage);
eq('library round trips', loaded[0].name, 'fantasy');
loaded[0].panels[0].name = 'mutated';
eq('load returns detached panels', loadPanelLibrary(storage)[0].panels[0].name, 'Stats');

eq('new set starts disabled', first.entry.enabled, false);
const pinned = setPanelSetEnabled(second.library, second.entry.id, true);
ok('pin marks set enabled', pinned.entry.enabled === true && pinned.changed === true);
const synced = syncPinnedLibraryPanels([], pinned.library);
ok('enabled set is injected into empty chat', synced.added === 1 && synced.panels[0].sourceLibraryId === second.entry.id);
const stillOn = syncPinnedLibraryPanels(synced.panels, pinned.library);
eq('re-stamp keeps a single library copy', stillOn.panels.length, 1);
ok('idempotent re-stamp reports no content change', stillOn.changed === false);
const collision = syncPinnedLibraryPanels(
    [{ name: 'Local', scope: 'global', fields: [{ key: 'health', type: 'meter' }] }],
    pinned.library,
);
ok('pin skips colliding field keys', collision.added === 0 && collision.skipped === 1 && collision.panels.length === 1);
ok('pin reports skipped panel details', collision.skippedPanels?.[0]?.keys?.includes('global:health') === true);
const nameCollision = syncPinnedLibraryPanels(
    [{ id: 'cp_local', name: 'Stats', scope: 'global', fields: [{ key: 'local_only', type: 'text' }] }],
    pinned.library,
);
ok('pin skips duplicate panel names even when field keys differ', nameCollision.skipped === 1 && nameCollision.added === 0);
const idCollisionLibrary = structuredClone(pinned.library);
idCollisionLibrary[0].panels[0].id = 'cp_local';
idCollisionLibrary[0].panels[0].name = 'Other Stats';
idCollisionLibrary[0].panels[0].fields[0].key = 'other_health';
const idCollision = syncPinnedLibraryPanels(
    [{ id: 'cp_local', name: 'Local', scope: 'global', fields: [{ key: 'local_only', type: 'text' }] }],
    idCollisionLibrary,
);
ok('pin skips duplicate runtime panel ids', idCollision.skipped === 1 && idCollision.skippedPanels?.[0]?.panelId === 'cp_local');
const unpinned = setPanelSetEnabled(pinned.library, second.entry.id, false);
const cleared = syncPinnedLibraryPanels(synced.panels, unpinned.library);
ok('disable removes library-sourced panels', cleared.removed === 1 && cleared.panels.length === 0);


const detachedDirect = structuredClone(synced.panels);
eq('detach returns number of matching chat panels', detachLibraryPanels(detachedDirect, second.entry.id), 1);
ok('detach preserves panel but removes library provenance', detachedDirect.length === 1 && !detachedDirect[0].sourceLibraryId && !detachedDirect[0].sourceLibraryName);

const staleSource = syncPinnedLibraryPanels([
    { id: 'cp_stale', name: 'Former Library Panel', sourceLibraryId: 'missing_set', sourceLibraryName: 'Missing', scope: 'global', fields: [{ key: 'stale_value', type: 'text' }] },
], []);
ok('missing library source is detached instead of remaining read-only forever', staleSource.changed === true && staleSource.detachedStale === 1 && staleSource.panels.length === 1 && !staleSource.panels[0].sourceLibraryId);

const removed = removePanelSet(second.library, second.entry.id);
eq('remove deletes only requested set', removed.length, 0);

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass}/${pass + fail}`);
if (fail) process.exit(1);
