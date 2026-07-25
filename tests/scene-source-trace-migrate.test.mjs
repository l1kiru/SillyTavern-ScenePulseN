import assert from 'node:assert/strict';
import { migrateTraceToV3View, EvidenceLevel } from '../src/scene-source-trace/migrate.js';

{
    const view = migrateTraceToV3View({
        v: 2,
        mode: 'inline',
        capturedAt: 't',
        startedAt: 's',
        lorebook: {
            count: 1,
            totalEvents: 1,
            entries: [{
                world: 'Fate', uid: '42', title: 'Artoria',
                matchedKeys: ['Artoria'], matchKind: 'keys', tokens: 3,
            }],
        },
    });
    assert.equal(view.v, 3);
    assert.equal(view.lorebook.entries[0].stages.accepted.evidence, EvidenceLevel.ENGINE);
    assert.equal(view.lorebook.entries[0].triggers[0].evidence.type, EvidenceLevel.INFERRED);
    assert.deepEqual(view.loops, []);
    assert.equal(view.summary.acceptedEntries, 1);
    assert.deepEqual(view.capabilities, {
        scanDone: false,
        engineDecisions: false,
        promptBuildDecisions: false,
    });
}

{
    const v3 = { v: 3, lorebook: { entries: [] }, loops: [{ loopCount: 0 }] };
    assert.equal(migrateTraceToV3View(v3), v3);
}

console.log('scene-source-trace-migrate.test.mjs: all tests passed');
