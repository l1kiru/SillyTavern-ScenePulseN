import assert from 'node:assert/strict';
import {
    snapshotScanDone,
    entryKey,
    snapshotEntriesLoaded,
} from '../src/scene-source-trace/event-adapters.js';
import { snapshotWorldInfoSettings } from '../src/scene-source-trace/settings-snapshot.js';
import {
    startSceneSourceTrace,
    recordWorldInfoScanDone,
    recordWorldInfoActivation,
    recordWorldInfoEntriesLoaded,
    recordWorldInfoForceActivate,
    finishSceneSourceTrace,
    _resetSceneSourceTraceForTests,
} from '../src/scene-source-trace.js';

{
    const settings = snapshotWorldInfoSettings({
        world_info_depth: 4,
        world_info_budget: 25,
        world_info_include_names: true,
        world_info_case_sensitive: false,
        world_info_match_whole_words: true,
        world_info_max_recursion_steps: 3,
    });
    assert.equal(settings.scanDepth, 4);
    assert.equal(settings.matchWholeWords, true);
    assert.equal(settings.recursionLimit, 3);
}

{
    const e1 = { world: 'Fate', uid: 42, comment: 'Artoria', key: ['a'], content: 'x' };
    const map1 = new Map([['Fate.42', e1]]);
    const args1 = {
        state: { current: 1, next: 2, loopCount: 0 },
        new: { all: [e1], successful: [e1] },
        activated: { entries: map1, text: 'x' },
        budget: { current: 100, overflowed: false },
        timedEffects: { isEffectActive: () => false },
        recursionDelay: { availableLevels: [], currentLevel: 0 },
        sortedEntries: [e1],
    };
    const snap = snapshotScanDone(args1);
    assert.equal(snap.state, 'INITIAL');
    assert.deepEqual(snap.acceptedEntryKeys, [entryKey('Fate', 42)]);
    snap.acceptedEntryKeys.push('nope');
    assert.equal(args1.activated.entries.size, 1);
}

{
    _resetSceneSourceTraceForTests();
    startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, { enabled: true, chat: [{ mes: 'a' }] });
    const e1 = { world: 'Fate', uid: 42, comment: 'Artoria', key: ['a'], content: 'x' };
    const e2 = { world: 'Fate', uid: 7, comment: 'Camelot', key: ['c'], content: 'y' };
    recordWorldInfoScanDone({
        state: { current: 1, next: 2, loopCount: 0 },
        new: { all: [e1], successful: [e1] },
        activated: { entries: new Map([['Fate.42', e1]]), text: 'x' },
        budget: { current: 50, overflowed: false },
        timedEffects: { isEffectActive: () => false },
    });
    recordWorldInfoScanDone({
        state: { current: 2, next: 0, loopCount: 1 },
        new: { all: [e2], successful: [e2] },
        activated: { entries: new Map([['Fate.42', e1], ['Fate.7', e2]]), text: 'y\nx' },
        budget: { current: 20, overflowed: true },
        timedEffects: { isEffectActive: (type, entry) => type === 'sticky' && entry.uid === 42 },
    });
    recordWorldInfoActivation([e1, e2]);
    const trace = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
    assert.equal(trace.v, 3);
    assert.equal(trace.loops.length, 2);
    assert.deepEqual(trace.loops[1].newAcceptedEntryKeys, [entryKey('Fate', 7)]);
    assert.equal(trace.summary.budgetOverflowed, true);
    const art = trace.lorebook.entries.find(e => String(e.uid) === '42');
    assert.equal(art.firstSeenLoop, 0);
    assert.equal(art.timedEffects.sticky, true);
}

{
    _resetSceneSourceTraceForTests();
    startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, { enabled: true, chat: [{ mes: 'x' }] });
    recordWorldInfoEntriesLoaded({
        globalLore: [{ world: 'GlobalBook', uid: 1, key: ['g'], content: 'a' }],
        characterLore: [{ world: 'Fate', uid: 42, key: ['a'], content: 'b' }],
        chatLore: [{ world: 'Fate', uid: 99, key: ['c'], content: 'd' }],
        personaLore: [],
    });
    const forced = [{ world: 'Fate', uid: 42, key: ['a'], comment: 'Artoria', content: 'b' }];
    recordWorldInfoForceActivate(forced);
    recordWorldInfoActivation(forced);
    const trace = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
    const fate = trace.lorebooks.find(l => l.name === 'Fate' || l.id === 'Fate');
    assert.ok(fate.attachmentSources.includes('character'));
    assert.ok(fate.attachmentSources.includes('chat'));
    const art = trace.lorebook.entries.find(e => String(e.uid) === '42');
    assert.ok(art.triggers.some(t => t.type === 'force_activate' && t.evidence.type === 'engine'));
    assert.equal(art.matchKind, 'force');
    assert.ok(trace.candidates.some(c => String(c.uid) === '99'));
}

{
    const snap = snapshotEntriesLoaded({
        globalLore: [{ world: 'G', uid: 1 }],
        characterLore: [],
        chatLore: [],
        personaLore: [],
    });
    assert.equal(snap.loadedCount, 1);
    assert.equal(snap.lorebooks[0].attachmentSources[0], 'global');
}

console.log('scene-source-trace-events.test.mjs: all tests passed');
