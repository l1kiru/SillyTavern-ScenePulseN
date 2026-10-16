import assert from 'node:assert/strict';
import { hideTrackerForDisplay, initializeTrackerDisplay, isTrackerFormatterActive } from '../src/generation/tracker-display.js';
import { inspectStCapabilities } from '../src/st-capabilities.js';

const pairs = [
    ['<!--SP_TRACKER_START-->', '<!--SP_TRACKER_END-->'],
    ['{{//SP_TRACKER_START}}', '{{//SP_TRACKER_END}}'],
    ['{{SP_TRACKER_START}}', '{{SP_TRACKER_END}}'],
    ['[SP_TRACKER_START]', '[SP_TRACKER_END]'],
    ['**SP_TRACKER_START**', '**SP_TRACKER_END**'],
];
for (const [start, end] of pairs) {
    const raw = `Story\n${start}{"time":"12:00"}${end}\nEpilogue`;
    const metadata = Object.freeze({ messageId: -1, isUser: false, isSystem: false, isReasoning: false });
    assert.equal(hideTrackerForDisplay(raw, metadata), 'Story\n\nEpilogue');
    assert.equal(hideTrackerForDisplay(`Story${start}{"time":`, metadata), 'Story');
    assert.equal(hideTrackerForDisplay(raw + raw, metadata), 'Story\n\nEpilogueStory\n\nEpilogue');
    for (const flag of ['isUser', 'isSystem', 'isReasoning']) {
        assert.equal(hideTrackerForDisplay(raw, { [flag]: true }), raw);
    }
    const distinctive = start.indexOf('SP_') + 3;
    for (let size = distinctive; size < start.length; size++) {
        assert.equal(hideTrackerForDisplay(`Story\n${start.slice(0, size)}`, metadata), 'Story\n');
    }
    const message = Object.freeze({ mes: raw, swipe_id: 0 });
    hideTrackerForDisplay(message.mes, metadata);
    assert.equal(message.mes, raw, 'display transformation does not change saved messages');
}
for (const raw of ['Story\n{', 'Story\n{"time":"12:00"}', '```json\n{"time":"12:00","date":"Monday"}\n```', 'An ordinary <!-- comment -->', 'Story {{user}}', 'A [link](url)', '**Bold text**']) {
    assert.equal(hideTrackerForDisplay(raw), raw, 'ordinary narrative/code remains intact');
}
assert.equal(hideTrackerForDisplay('Story\n[SCENE TRACKER instructions]\n{}'), 'Story\n');

const unrelatedRule = { scriptName: 'User regex', findRegex: 'keep' };
const settings = { regex: [unrelatedRule, { scriptName: 'ScenePulse Tracker Hider' }, { scriptName: 'ScenePulse Tracker Hider' }] };
const legacyContext = { extensionSettings: settings };
assert.equal(initializeTrackerDisplay(legacyContext).path, 'legacy-regex-dom');
initializeTrackerDisplay(legacyContext);
assert.equal(settings.regex.length, 2, 'legacy initialization is idempotent');
assert.equal(settings.regex[0], unrelatedRule);
assert.equal(settings.regex[1].markdownOnly, true);
assert.equal(settings.regex[1].promptOnly, false);
assert.equal('Story<!--SP_TRACKER_START-->{}<!--SP_TRACKER_END-->'.replace(new RegExp(settings.regex[1].findRegex, 'g'), ''), 'Story');

const hooks = [];
const formatter = {
    stage: { BEFORE_REGEX: 'beforeRegex' },
    addHook(fn, options) { assert.equal(this, formatter); hooks.push({ fn, options }); },
};
const modernContext = { messageFormatter: formatter, extensionSettings: settings };
assert.equal(initializeTrackerDisplay(modernContext).path, 'message-formatter');
assert.equal(isTrackerFormatterActive(modernContext), true);
assert.equal(inspectStCapabilities(modernContext).displayPath, 'message-formatter');
assert.deepEqual(settings.regex, [unrelatedRule], 'modern mode removes only our legacy rules');
initializeTrackerDisplay(modernContext);
assert.equal(hooks.length, 1, 'ST addHook returns void; repeated initialization must not register twice');
assert.deepEqual(hooks[0].options, { stage: 'beforeRegex', order: 0 });
assert.equal(hooks[0].fn('Story<!--SP_TRACKER_START-->{}', Object.freeze({ messageId: -1 })), 'Story');
const failedContext = {
    messageFormatter: { stage: formatter.stage, addHook() { throw new Error('registration failed'); } },
    extensionSettings: settings,
};
assert.equal(initializeTrackerDisplay(failedContext).error.message, 'registration failed');
assert.equal(isTrackerFormatterActive(failedContext), false);
assert.equal(inspectStCapabilities(failedContext).displayPath, 'legacy-regex-dom');
assert.equal(settings.regex.length, 2, 'failed registration retains legacy fallback');
assert.equal(initializeTrackerDisplay({ extensionSettings: {}, messageFormatter: { addHook() {} } }).path, 'legacy-regex-dom');

// A registered modern path must not create timers, observers, or clipping styles.
globalThis.SillyTavern = { getContext: () => modernContext };
globalThis.document = { querySelectorAll: () => [] };
const originalInterval = globalThis.setInterval;
globalThis.setInterval = () => { throw new Error('legacy polling started'); };
const { startStreamingHider, noteStreamingText } = await import('../src/generation/streaming.js');
startStreamingHider();
noteStreamingText('Story\n<!--SP_TRACKER_START-->{');
globalThis.setInterval = originalInterval;
delete globalThis.SillyTavern;
delete globalThis.document;
console.log('PASS tracker display boundaries, marker families, streaming prefixes and immutable source');
