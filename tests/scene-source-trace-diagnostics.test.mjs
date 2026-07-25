import assert from 'node:assert/strict';
import { installConsoleIntercept } from '../src/scene-source-trace/diagnostics/console-intercept.js';
import {
    parseWiConsoleArgs,
    probeWiLogFormat,
    resetParserContext,
} from '../src/scene-source-trace/diagnostics/parsers/st-1-18.js';
import {
    reconcileDiagnosticEvent,
    resolveDiagnosticTarget,
} from '../src/scene-source-trace/diagnostics/reconcile.js';
import {
    startDiagnostics,
    stopDiagnostics,
    getDiagnosticsStatus,
} from '../src/scene-source-trace/diagnostics/index.js';
import {
    startSceneSourceTrace,
    recordWorldInfoActivation,
    finishSceneSourceTrace,
    _resetSceneSourceTraceForTests,
} from '../src/scene-source-trace.js';

{
    const seen = [];
    const calls = [];
    const orig = console.debug;
    console.debug = (...args) => { calls.push(args); };
    const uninstall = installConsoleIntercept({
        onDebug: (args) => { seen.push(args); throw new Error('listener boom'); },
    });
    console.debug('[WI] test', 1);
    assert.equal(calls.length, 1);
    assert.equal(seen.length, 1);
    uninstall();
    console.debug = orig;
}

{
    const p = parseWiConsoleArgs(['[WI] Entry with primary key match', 'Artoria']);
    assert.equal(p.kind, 'primary_match');
    assert.equal(p.key, 'Artoria');
    assert.equal(probeWiLogFormat(['[WI] Entry with primary key match']).ok, true);
    assert.equal(probeWiLogFormat([
        '[WI] --- START WI SCAN ---',
        '[WI] Character lore has 3 world info entries',
        '[WI] --- LOOP #0 START ---',
    ]).ok, false);
}

{
    resetParserContext();
    parseWiConsoleArgs(['[WI] Entry 42', "from 'Fate' processing", {}]);
    const sticky = parseWiConsoleArgs(['[WI] Entry 42', 'activated because active sticky']);
    assert.equal(sticky.kind, 'sticky');
    assert.equal(sticky.uid, '42');
    assert.equal(sticky.world, 'Fate');
    const primary = parseWiConsoleArgs(['[WI] Entry 7', 'activated by primary key match', 'Artoria']);
    assert.equal(primary.kind, 'primary_match');
    assert.equal(primary.uid, '7');
    assert.equal(primary.key, 'Artoria');
}

{
    const entry = {
        world: 'Fate',
        uid: 42,
        keys: ['Artoria'],
        stages: { accepted: { value: true, evidence: 'engine' } },
        triggers: [{ type: 'primary_key', matchedText: 'A', evidence: { type: 'inferred' } }],
    };
    const out = reconcileDiagnosticEvent(entry, {
        kind: 'primary_match', key: 'Artoria', world: 'Fate', uid: 42,
    });
    assert.equal(out.stages.accepted.evidence, 'engine');
    assert.ok(out.triggers.some(t => t.evidence.type === 'diagnostic' && t.originalKey === 'Artoria'));
    assert.ok(out.triggers.some(t => t.evidence.type === 'inferred'));
}

{
    const entries = [
        { world: 'W', uid: 1, keys: ['alpha'] },
        { world: 'W', uid: 2, keys: ['beta'] },
    ];
    assert.equal(
        resolveDiagnosticTarget(entries, { kind: 'sticky', uid: '1', world: 'W' }),
        'W::1',
    );
    // uid-only — refuse
    assert.equal(resolveDiagnosticTarget(entries, { kind: 'sticky', uid: '1' }), null);
}

{
    // Duplicate key without world/uid — attach to neither
    const entries = [
        { world: 'LoreA', uid: 1, keys: ['dragon'] },
        { world: 'LoreB', uid: 2, keys: ['dragon'] },
    ];
    assert.equal(
        resolveDiagnosticTarget(entries, { kind: 'primary_match', key: 'dragon' }),
        null,
    );
}

{
    // Startup WI noise must not disable mid-scan; sticky targets world from header
    _resetSceneSourceTraceForTests();
    startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, {
        enabled: true,
        chat: [{ mes: 'x' }],
        diagnostics: true,
    });
    assert.equal(getDiagnosticsStatus(), 'active');
    const banners = [
        '[WI] --- START WI SCAN (on 2 messages, trigger = normal) ---',
        '[WI] Context size: 8192; WI budget: 400',
        '[WI] Character lore has 3 world info entries',
        '[WI] Global world info has 1 entries',
        '[WI] --- SEARCHING ENTRIES (on 10 entries) ---',
        '[WI] --- LOOP #0 START ---',
        '[WI] Scan state INITIAL',
        '[WI] Budget 400 exceeds nothing',
    ];
    for (const line of banners) console.debug(line);
    assert.equal(getDiagnosticsStatus(), 'active');
    recordWorldInfoActivation([
        { world: 'Fate', uid: 1, comment: 'A', key: ['k'], content: 'x' },
        { world: 'Other', uid: 1, comment: 'B', key: ['k'], content: 'y' },
    ]);
    console.debug('[WI] Entry 1', "from 'Fate' processing", {});
    console.debug('[WI] Entry 1', 'activated because active sticky');
    const trace = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
    assert.equal(trace.diagnostics.status, 'ok');
    const e1 = trace.lorebook.entries.find(e => e.world === 'Fate' && String(e.uid) === '1');
    const e2 = trace.lorebook.entries.find(e => e.world === 'Other' && String(e.uid) === '1');
    assert.ok(e1.triggers.some(t => t.type === 'sticky' && t.evidence?.type === 'diagnostic'));
    assert.ok(!e2.triggers.some(t => t.type === 'sticky' && t.evidence?.type === 'diagnostic'));
}

{
    // Duplicate key diagnostic without world/uid — neither entry
    _resetSceneSourceTraceForTests();
    startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, {
        enabled: true,
        chat: [{ mes: 'dragon' }],
        diagnostics: true,
    });
    recordWorldInfoActivation([
        { world: 'LoreA', uid: 1, comment: 'A', key: ['dragon'], content: 'x' },
        { world: 'LoreB', uid: 2, comment: 'B', key: ['dragon'], content: 'y' },
    ]);
    resetParserContext();
    console.debug('[WI] Entry with primary key match', 'dragon');
    const coll = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
    for (const e of coll.lorebook.entries) {
        assert.ok(!e.triggers.some(t => t.evidence?.type === 'diagnostic'));
    }
}

{
    stopDiagnostics();
    startDiagnostics({ enabled: true });
    assert.equal(getDiagnosticsStatus(), 'active');
    console.debug('[WI] totally unknown xyz format aaa');
    console.debug('[WI] totally unknown xyz format bbb');
    console.debug('[WI] totally unknown xyz format ccc');
    const st = stopDiagnostics();
    assert.equal(st, 'disabled_unknown_format');
}

console.log('scene-source-trace-diagnostics.test.mjs: all tests passed');
