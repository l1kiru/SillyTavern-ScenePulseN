// Regression coverage for volatile thoughts, character identity, and presence.

const ctx = {
    name1: 'User', name2: 'Alice', groupId: null, selected_group: null,
    groups: [], characters: [],
    chatMetadata: { scenepulse: { snapshots: {} } },
    extensionSettings: { scenepulse: {} },
    saveMetadata() {}, saveSettingsDebounced() {},
};
globalThis.SillyTavern = { getContext: () => ctx };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.toastr = { error() {}, warning() {}, info() {}, success() {} };
if (typeof document === 'undefined') globalThis.document = { createElement: () => ({ style: {} }), body: { appendChild() {} } };

const { mergeDelta, preserveOffSceneEntities, reconcileIdentityAliases } = await import('../src/generation/delta-merge.js');
const { normalizeTracker, filterForView } = await import('../src/normalize.js');
const { updateCharacterField } = await import('../src/character-identity.js');

let pass = 0, fail = 0;
function eq(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { pass++; console.log('  OK   ' + name); }
    else { fail++; console.log('  FAIL ' + name + ' — expected ' + e + ', got ' + a); }
}

console.log('\n── Inner-thought integrity ──');

{
    const prev = {
        witnesses: ['Guard'], charactersPresent: ['Alice', 'Bob'],
        characters: [
            { name: 'Alice', innerThought: 'old Alice', immediateNeed: 'old need' },
            { name: 'Bob', innerThought: 'old Bob', immediateNeed: 'old need' },
        ],
    };
    const merged = mergeDelta(prev, {
        charactersPresent: ['Alice', 'Bob'],
        characters: [{ name: 'Alice', role: 'updated but no thought' }],
    });
    eq('present character without fresh thought is cleared', merged.characters.find(c => c.name === 'Alice').innerThought, '');
    eq('omitted present character thought is cleared', merged.characters.find(c => c.name === 'Bob').innerThought, '');
    eq('omitted immediate need is cleared', merged.characters.find(c => c.name === 'Alice').immediateNeed, '');
    eq('omitted witnesses become empty', merged.witnesses, []);
}

{
    const prev = { charactersPresent: ['Stranger'], characters: [{ name: 'Stranger', innerThought: 'first stranger' }] };
    const merged = mergeDelta(prev, { charactersPresent: ['Stranger'], characters: [{ name: 'Stranger', role: 'different stranger' }] });
    eq('same placeholder cannot inherit a missing thought', merged.characters[0].innerThought, '');
}

{
    const prev = { charactersPresent: ['Stranger'], characters: [{ name: 'Stranger', innerThought: 'old' }], relationships: [] };
    const full = { charactersPresent: ['Jenna'], characters: [{ name: 'Jenna', aliases: ['Stranger'], innerThought: 'fresh' }], relationships: [] };
    preserveOffSceneEntities(full, prev);
    eq('full refresh reveal stays one character', full.characters.map(c => c.name), ['Jenna']);
    const next = mergeDelta(full, { charactersPresent: ['Stranger'], characters: [{ name: 'Stranger', innerThought: 'newest', immediateNeed: 'answer' }] });
    eq('old alias updates canonical character', next.characters.map(c => c.name), ['Jenna']);
    eq('alias update keeps newest thought', next.characters[0].innerThought, 'newest');
    eq('presence is canonicalized', next.charactersPresent, ['Jenna']);
}

{
    const damaged = {
        charactersPresent: ['Stranger'],
        characters: [
            { name: 'Jenna', aliases: ['Stranger'], innerThought: 'canonical old' },
            { name: 'Stranger', innerThought: 'orphaned old' },
        ],
    };
    const repaired = mergeDelta(damaged, {
        charactersPresent: ['Stranger'],
        characters: [{ name: 'Stranger', innerThought: 'fresh after repair' }],
    });
    eq('legacy canonical and alias records are healed', repaired.characters.map(c => c.name), ['Jenna']);
    eq('fresh thought reaches healed canonical record', repaired.characters[0].innerThought, 'fresh after repair');
}

{
    const collision = {
        characters: [
            { name: 'Alice', aliases: ['Stranger'] },
            { name: 'Bob', aliases: ['Stranger'] },
        ],
        charactersPresent: ['Stranger'],
        relationships: [{ name: 'Stranger', trust: 10 }],
    };
    reconcileIdentityAliases(collision);
    eq('ambiguous alias does not choose a character', collision.charactersPresent, ['Stranger']);
    eq('ambiguous relationship is not reassigned', collision.relationships[0].name, 'Stranger');
}

{
    const stored = [{ name: 'Alice', innerThought: 'Alice old' }, { name: 'Bob', innerThought: 'Bob old' }];
    updateCharacterField(stored, 'Bob', 'innerThought', 'Bob edited');
    eq('editing Bob leaves Alice untouched', stored[0].innerThought, 'Alice old');
    eq('editing Bob updates Bob by identity', stored[1].innerThought, 'Bob edited');
}

{
    ctx.chatMetadata.scenepulse.snapshots = {
        20: { charactersPresent: ['Alice'], characters: [{ name: 'Alice', innerThought: 'future thought' }] },
    };
    const historical = { charactersPresent: ['Alice'], characters: [{ name: 'Alice', innerThought: '' }] };
    const first = normalizeTracker(historical);
    eq('historical snapshot does not acquire future thought', first.characters[0].innerThought, '');
    historical.characters[0].innerThought = 'edited after normalize';
    const second = normalizeTracker(historical);
    eq('same-object edit is not hidden by cache', second.characters[0].innerThought, 'edited after normalize');
}

{
    ctx.groupId = 'g1'; ctx.selected_group = 'g1';
    ctx.groups = [{ id: 'g1', members: ['Alice.png', 'Bob.png'] }];
    ctx.characters = [{ name: 'Alice', avatar: 'Alice.png' }, { name: 'Bob', avatar: 'Bob.png' }];
    const view = filterForView({
        charactersPresent: ['Alice'],
        characters: [{ name: 'Alice' }, { name: 'Bob', innerThought: 'stale Bob' }],
        relationships: [],
    });
    eq('group member absent from scene stays hidden', view.characters.map(c => c.name), ['Alice']);
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass}/${pass + fail}`);
if (fail) process.exit(1);
