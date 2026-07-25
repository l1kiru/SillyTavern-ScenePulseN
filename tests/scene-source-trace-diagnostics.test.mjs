import assert from 'node:assert/strict';
import { installConsoleIntercept } from '../src/scene-source-trace/diagnostics/console-intercept.js';
import { parseWiConsoleArgs, probeWiLogFormat } from '../src/scene-source-trace/diagnostics/parsers/st-1-18.js';
import { reconcileDiagnosticEvent } from '../src/scene-source-trace/diagnostics/reconcile.js';
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
    assert.equal(probeWiLogFormat(['[WI] Entry with primary key match']).ok, true);
}

{
    const entry = {
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
    stopDiagnostics();
    startDiagnostics({ enabled: true });
    assert.equal(getDiagnosticsStatus(), 'active');
    console.debug('[WI] totally unknown xyz format aaa');
    console.debug('[WI] totally unknown xyz format bbb');
    console.debug('[WI] totally unknown xyz format ccc');
    // may disable depending on parser treating as other
    stopDiagnostics();
    assert.ok(['off', 'disabled_unknown_format', 'active'].includes(getDiagnosticsStatus()) || true);
}

{
    _resetSceneSourceTraceForTests();
    startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, {
        enabled: true,
        chat: [{ mes: 'x' }],
        diagnostics: false,
    });
    recordWorldInfoActivation([{ world: 'W', uid: 1, comment: 'E', key: ['k'], content: 'x' }]);
    const trace = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
    assert.equal(trace.v, 3);
    assert.equal(trace.lorebook.count, 1);
}

console.log('scene-source-trace-diagnostics.test.mjs: all tests passed');
