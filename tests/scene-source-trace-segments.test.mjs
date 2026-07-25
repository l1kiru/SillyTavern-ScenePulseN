import assert from 'node:assert/strict';
import { buildInferredSegments, inferTriggerSources } from '../src/scene-source-trace/segments.js';
import { explainWhyNot } from '../src/scene-source-trace/why-not.js';
import { classifyForceEntries } from '../src/scene-source-trace/force-source.js';

{
    const segs = buildInferredSegments({
        chat: [{ mes: 'Hello', name: 'User' }, { mes: 'Hi', name: 'Bot' }],
        depth: 2,
        includeNames: true,
        character: { description: 'Knight Artoria', personality: 'Proud', scenario: 'Camelot' },
        persona: { description: 'Traveler' },
        recurseTexts: ['Rhongomyniad lore'],
    });
    assert.ok(segs.some(s => s.type === 'character_description' && /Artoria/.test(s.text)));
    assert.ok(segs.some(s => s.type === 'recursive_wi'));
}

{
    const triggers = inferTriggerSources(
        { key: ['Artoria'], constant: false },
        [{ type: 'character_description', text: 'Knight Artoria lives', messageId: null, depth: null }],
        { caseSensitive: false, matchWholeWords: false },
    );
    assert.equal(triggers[0].source.type, 'character_description');
    assert.equal(triggers[0].evidence.type, 'inferred');
}

{
    assert.equal(classifyForceEntries([{ world: 'W', uid: 1, vectorized: true }]).source, 'vectors');
    assert.equal(classifyForceEntries([{ world: 'W', uid: 2 }]).source, 'external');
}

{
    const r = explainWhyNot(
        { world: 'W', uid: '1', title: 'Skipped' },
        {
            trace: {
                summary: { budgetOverflowed: true },
                loadedEntryKeys: ['W::1'],
                lorebook: { entries: [] },
                candidates: [{ world: 'W', uid: '1', title: 'Skipped' }],
            },
        },
    );
    assert.ok(r.lines.some(l => /budget/i.test(l)));
    assert.equal(r.evidence, 'inferred');
}

console.log('scene-source-trace-segments.test.mjs: all tests passed');
