import assert from 'node:assert/strict';
import {
    startSceneSourceTrace,
    recordWorldInfoScanDone,
    recordWorldInfoActivation,
    recordWorldInfoEntriesLoaded,
    finishSceneSourceTrace,
    _resetSceneSourceTraceForTests,
    explainWhyNot,
} from '../src/scene-source-trace.js';

{
    _resetSceneSourceTraceForTests();
    startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, {
        enabled: true, chat: [{ mes: 'no key here' }],
    });
    recordWorldInfoScanDone({
        state: { current: 1, next: 0, loopCount: 0 },
        activated: { entries: new Map([['Fate.42', { world: 'Fate', uid: 42, key: ['Artoria'], keysecondary: ['Camelot'], content: 'x', comment: 'A' }]]), text: 'x' },
        budget: { current: 1, overflowed: false },
        decisions: [{
            entry: { world: 'Fate', uid: 42 },
            loop: 0,
            scanState: 'INITIAL',
            status: 'accepted',
            reason: 'primary_key',
            primaryMatch: { matched: true, text: 'Artoria', index: 0, originalKey: 'Artoria' },
            secondaryMatches: [
                { matched: true, text: 'Camelot', index: 10, originalKey: 'Camelot', polarity: 'positive' },
            ],
            selectiveLogic: 0,
            selectivePassed: true,
        }],
        timedEffects: { isEffectActive: () => false },
    });
    recordWorldInfoActivation([{ world: 'Fate', uid: 42, key: ['Artoria'], keysecondary: ['Camelot'], comment: 'A', content: 'x' }]);
    const trace = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
    const e = trace.lorebook.entries[0];
    assert.equal(e.triggers.find(t => t.type === 'primary_key').evidence.type, 'engine');
    const sec = e.triggers.find(t => t.type === 'secondary_key');
    assert.equal(sec.evidence.type, 'engine');
    assert.equal(sec.polarity, 'positive');
    assert.deepEqual(e.selectiveEvaluation, { logic: 'AND_ANY', passed: true, evidence: 'engine' });
}

{
    _resetSceneSourceTraceForTests();
    startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, {
        enabled: true, chat: [{ mes: 'Artoria' }],
    });
    const entry = { world: 'Fate', uid: 42, key: ['Artoria'], comment: 'A', content: 'will be emptied' };
    recordWorldInfoScanDone({
        state: { current: 1, next: 0, loopCount: 0 },
        activated: { entries: new Map([['Fate.42', entry]]), text: 'x' },
        budget: { current: 1, overflowed: false },
        decisions: [{
            entry: { world: 'Fate', uid: 42 },
            loop: 0, scanState: 'INITIAL', status: 'accepted', reason: 'primary_key',
            primaryMatch: { matched: true, text: 'Artoria', index: 0, originalKey: 'Artoria' },
            secondaryMatches: [], selectiveLogic: 0, selectivePassed: true,
        }],
        timedEffects: { isEffectActive: () => false },
    });
    recordWorldInfoScanDone({
        phase: 'prompt_build',
        state: { current: 0, next: 0, loopCount: -1 },
        activated: { entries: new Map([['Fate.42', entry]]), text: 'x' },
        budget: { current: 1, overflowed: false },
        decisions: [{
            entry: { world: 'Fate', uid: 42 },
            loop: null, scanState: 'NONE', phase: 'prompt_build',
            status: 'suppressed', reason: 'content_empty_after_regex',
            primaryMatch: null, secondaryMatches: [],
        }],
        timedEffects: { isEffectActive: () => false },
    });
    recordWorldInfoActivation([entry]);
    const trace = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
    assert.equal(trace.loops.length, 1);
    assert.equal(trace.lorebook.entries[0].stages.rendered.value, false);
    assert.equal(trace.lorebook.entries[0].stages.rendered.evidence, 'engine');
    assert.equal(trace.lorebook.entries[0].rejection.reason, 'content_empty_after_regex');
}

{
    _resetSceneSourceTraceForTests();
    startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, {
        enabled: true, chat: [{ mes: 'Artoria without second key' }],
    });
    recordWorldInfoEntriesLoaded({
        globalLore: [],
        characterLore: [{ world: 'Fate', uid: 42, key: ['Artoria'], keysecondary: ['Camelot'], comment: 'A', content: 'x' }],
        chatLore: [],
        personaLore: [],
    });
    recordWorldInfoScanDone({
        state: { current: 1, next: 0, loopCount: 0 },
        activated: { entries: new Map(), text: '' },
        budget: { current: 1, overflowed: false },
        decisions: [{
            entry: { world: 'Fate', uid: 42 },
            loop: 0,
            scanState: 'INITIAL',
            status: 'rejected',
            reason: 'secondary_failed',
            primaryMatch: { matched: true, text: 'Artoria', index: 0, originalKey: 'Artoria' },
            secondaryMatches: [
                { matched: false, text: '', index: -1, originalKey: 'Camelot', polarity: 'positive' },
            ],
            selectiveLogic: 3,
            selectivePassed: false,
        }],
        timedEffects: { isEffectActive: () => false },
    });
    const trace = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
    const cand = trace.candidates.find(c => String(c.uid) === '42');
    assert.ok(cand);
    assert.equal(cand.rejection?.reason, 'secondary_failed');
    assert.equal(cand.rejection?.evidence, 'engine');
    assert.deepEqual(cand.selectiveEvaluation, {
        logic: 'AND_ALL', passed: false, evidence: 'engine',
    });
    assert.ok(cand.triggers.some(t => t.type === 'primary_key' && t.evidence.type === 'engine'));
}

{
    // Buffer would first-hit Alpha; engine primaryMatch.Beta must win alone
    _resetSceneSourceTraceForTests();
    startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, {
        enabled: true, chat: [{ mes: 'Alpha and Beta both here' }],
    });
    recordWorldInfoScanDone({
        state: { current: 1, next: 0, loopCount: 0 },
        activated: { entries: new Map([['W.1', { world: 'W', uid: 1, key: ['Alpha', 'Beta'], content: 'x', comment: 'E' }]]), text: 'x' },
        budget: { current: 1, overflowed: false },
        decisions: [{
            entry: { world: 'W', uid: 1 },
            loop: 0,
            scanState: 'INITIAL',
            status: 'accepted',
            reason: 'primary_key',
            primaryMatch: { matched: true, text: 'Beta', index: 10, originalKey: 'Beta' },
            secondaryMatches: [],
            selectiveLogic: 0,
            selectivePassed: true,
        }],
        timedEffects: { isEffectActive: () => false },
    });
    recordWorldInfoActivation([{ world: 'W', uid: 1, key: ['Alpha', 'Beta'], comment: 'E', content: 'x' }]);
    const eng = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
    const entry = eng.lorebook.entries[0];
    assert.deepEqual(entry.matchedKeys, ['Beta']);
    assert.ok(!entry.triggers.some(t => t.type === 'primary_key' && t.evidence?.type === 'inferred'));
    assert.equal(entry.triggers.find(t => t.type === 'primary_key')?.matchedText, 'Beta');
    assert.equal(eng.capabilities.engineDecisions, true);
    assert.equal(eng.capabilities.scanDone, true);
}

{
    // Activation without SCAN_DONE → scanDone false
    _resetSceneSourceTraceForTests();
    startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, {
        enabled: true, chat: [{ mes: 'hi' }],
    });
    recordWorldInfoActivation([{ world: 'W', uid: 1, key: ['k'], comment: 'E', content: 'x' }]);
    const actOnly = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
    assert.equal(actOnly.capabilities.scanDone, false);
    assert.equal(actOnly.capabilities.engineDecisions, false);
}

{
    // Stock SCAN_DONE: no decisions field
    _resetSceneSourceTraceForTests();
    startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, {
        enabled: true, chat: [{ mes: 'Artoria' }],
    });
    recordWorldInfoScanDone({
        state: { current: 1, next: 0, loopCount: 0 },
        activated: { entries: new Map([['W.1', { world: 'W', uid: 1, key: ['Artoria'], content: 'x' }]]), text: 'x' },
        budget: { current: 1, overflowed: false },
        timedEffects: { isEffectActive: () => false },
    });
    recordWorldInfoActivation([{ world: 'W', uid: 1, key: ['Artoria'], content: 'x', comment: 'E' }]);
    const stock = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
    assert.equal(stock.capabilities.scanDone, true);
    assert.equal(stock.capabilities.engineDecisions, false);
    assert.ok(!stock.lorebook.entries[0].triggers.some(t =>
        t.type === 'primary_key' && t.evidence?.type === 'engine'));
}

{
    // Patched contract present with empty decisions array
    _resetSceneSourceTraceForTests();
    startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, {
        enabled: true, chat: [{ mes: 'hi' }],
    });
    recordWorldInfoScanDone({
        state: { current: 1, next: 0, loopCount: 0 },
        activated: { entries: new Map(), text: '' },
        budget: { current: 1, overflowed: false },
        decisions: [],
        timedEffects: { isEffectActive: () => false },
    });
    const patchedEmpty = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
    assert.equal(patchedEmpty.capabilities.scanDone, true);
    assert.equal(patchedEmpty.capabilities.engineDecisions, true);
}

{
    const why = explainWhyNot(
        { world: 'Fate', uid: '42', rejection: { reason: 'secondary_failed', evidence: 'engine' },
            selectiveEvaluation: { logic: 'AND_ALL', passed: false, evidence: 'engine' } },
        { trace: { summary: {}, lorebook: { entries: [] }, candidates: [] } },
    );
    assert.equal(why.evidence, 'engine');
    assert.ok(why.lines.some(l => /secondary/i.test(l) || /AND_ALL/i.test(l)));
}

{
    const why = explainWhyNot(
        { world: 'Fate', uid: '42',
            stages: { accepted: { value: true, evidence: 'engine' }, rendered: { value: false, evidence: 'engine' } },
            rejection: { reason: 'content_empty_after_regex', evidence: 'engine' } },
        { trace: {} },
    );
    assert.equal(why.evidence, 'engine');
    assert.ok(why.lines.some(l => /regex|empty|content/i.test(l)));
}

console.log('scene-source-trace-engine-match.test.mjs: all tests passed');
