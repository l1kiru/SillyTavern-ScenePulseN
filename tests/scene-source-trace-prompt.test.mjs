import assert from 'node:assert/strict';
import {
    fingerprintContent,
    extractWiSlotsFromPromptChat,
    extractTextCompletionSlots,
    matchFingerprintInSlots,
} from '../src/scene-source-trace/prompt-insertion.js';
import { fnv1aHex } from '../src/scene-source-trace/hash.js';
import {
    startSceneSourceTrace,
    recordWorldInfoActivation,
    recordPromptReady,
    recordTextCompletionPrompt,
    finishSceneSourceTrace,
    _resetSceneSourceTraceForTests,
} from '../src/scene-source-trace.js';

{
    const a = fingerprintContent('Hello Артория');
    const b = fingerprintContent('Hello Артория');
    const c = fingerprintContent('Hello Артория!');
    assert.equal(a.hash, b.hash);
    assert.equal(a.hash, fnv1aHex('Hello Артория'));
    assert.equal(a.length, 'Hello Артория'.length);
    assert.notEqual(a.hash, c.hash);
}

{
    assert.equal(extractTextCompletionSlots({ dryRun: true, prompt: 'x' }), null);
    assert.equal(extractTextCompletionSlots({ prompt: [{ role: 'system', content: 'x' }] }), null);
    assert.equal(extractTextCompletionSlots({ prompt: '' }), null);
    const slots = extractTextCompletionSlots({ prompt: 'PREFIX unique lore head SUFFIX', dryRun: false });
    assert.match(slots.textCompletionPrompt, /unique lore head/);
    const r = matchFingerprintInSlots(
        { hash: 'x', length: 10 },
        slots,
        { contentHead: 'unique lore head' },
    );
    assert.equal(r.status, 'yes');
    assert.equal(r.position, 'text_completion_prompt');
}

{
    const slots = extractWiSlotsFromPromptChat([
        { role: 'system', identifier: 'worldInfoBefore', content: 'AAA unique lore head BBB' },
        { role: 'system', identifier: 'worldInfoAfter', content: '' },
    ]);
    assert.match(slots.worldInfoBefore, /unique lore head/);
    const r = matchFingerprintInSlots(
        { hash: 'x', length: 100 },
        slots,
        { contentHead: 'unique lore head' },
    );
    assert.equal(r.status, 'yes');
    assert.equal(r.position, 'worldInfoBefore');
}

{
    _resetSceneSourceTraceForTests();
    startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, {
        enabled: true,
        chat: [{ mes: 'hi' }],
    });
    recordWorldInfoActivation([{
        world: 'W', uid: 1, comment: 'E', key: ['k'], content: 'unique lore head and more text here',
    }]);
    recordTextCompletionPrompt({ prompt: 'sys\nunique lore head and more text here\nuser', dryRun: false });
    const trace = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
    assert.equal(trace.lorebook.entries[0].promptInsertion.status, 'yes');
    assert.equal(trace.lorebook.entries[0].promptInsertion.position, 'text_completion_prompt');
}

{
    _resetSceneSourceTraceForTests();
    startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, {
        enabled: true,
        chat: [{ mes: 'hi' }],
    });
    recordWorldInfoActivation([{
        world: 'W', uid: 2, comment: 'E', key: ['k'], content: 'unique lore head and more text here',
    }]);
    recordPromptReady({
        dryRun: false,
        chat: [{ role: 'system', identifier: 'worldInfoBefore', content: 'unique lore head and more text here' }],
    });
    const trace = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
    assert.equal(trace.lorebook.entries[0].promptInsertion.status, 'yes');
    assert.equal(trace.lorebook.entries[0].promptInsertion.position, 'worldInfoBefore');
}

{
    _resetSceneSourceTraceForTests();
    startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, {
        enabled: true,
        chat: [{ mes: 'hi' }],
    });
    recordWorldInfoActivation([{
        world: 'W', uid: 3, comment: 'E', key: ['k'], content: 'unique lore head and more text here',
    }]);
    const trace = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
    assert.equal(trace.lorebook.entries[0].promptInsertion.status, 'unknown');
}

console.log('scene-source-trace-prompt.test.mjs: all tests passed');
