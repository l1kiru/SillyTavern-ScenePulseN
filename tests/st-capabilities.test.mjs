import assert from 'node:assert/strict';
import { inspectStCapabilities, readStCapabilities } from '../src/st-capabilities.js';
import { requestTracker } from '../src/generation/request.js';

const unavailable = inspectStCapabilities(null);
assert.equal(unavailable.version, null);
assert.equal(unavailable.rawGeneration, 'unavailable');
assert.equal(unavailable.formatter.available, false);

// Only property inspection is allowed: detection must never generate, subscribe,
// register a hook or read a secret. These are API-shaped inputs, not module mocks.
const doNotCall = () => { throw new Error('Capability inspection invoked an API'); };
const context = {
    version: '1.18.0',
    generateRawData: doNotCall,
    generateRaw: doNotCall,
    generateQuietPrompt: doNotCall,
    ConnectionManagerRequestService: { sendRequest: doNotCall },
    eventSource: { on: doNotCall },
    event_types: { APP_READY: 'app_ready', MESSAGE_SWIPED: 'message_swiped' },
};
let result = inspectStCapabilities(context);
assert.equal(result.version, '1.18.0');
assert.equal(result.rawGeneration, 'raw-data');
assert.equal(result.connectionProfile, true);
assert.equal(result.events.APP_READY, true);
assert.equal(result.events.MESSAGE_SWIPED, true);
assert.equal(result.events.CHAT_CHANGED, false);
assert.equal(result.formatter.available, false);
assert.equal(result.displayPath, 'legacy-regex-dom');

context.version = '1.19.0';
assert.equal(inspectStCapabilities(context).formatter.available, false, 'version is not a capability');
context.version = 'custom-build';
context.messageFormatter = { addHook: doNotCall, stage: { BEFORE_REGEX: 'beforeRegex' } };
result = inspectStCapabilities(context);
assert.equal(result.formatter.available, true, 'backported API is recognized');
assert.equal(result.displayPath, 'legacy-regex-dom', 'available formatter is not yet installed by ScenePulse');
context.messageFormatter.stage = {};
assert.equal(inspectStCapabilities(context).formatter.available, false, 'incomplete formatter is unavailable');
delete context.generateRawData;
assert.equal(inspectStCapabilities(context).rawGeneration, 'raw');
delete context.generateRaw;
assert.equal(inspectStCapabilities(context).rawGeneration, 'quiet');
delete context.generateQuietPrompt;
assert.equal(inspectStCapabilities(context).rawGeneration, 'unavailable');
context.generateRawData = true;
context.ConnectionManagerRequestService.sendRequest = true;
context.eventSource.on = true;
result = inspectStCapabilities(context);
assert.equal(result.rawGeneration, 'unavailable');
assert.equal(result.connectionProfile, false);
assert.equal(result.events.APP_READY, false, 'event constants alone do not provide subscriptions');
assert.equal(inspectStCapabilities({}, 'SillyTavern 1.19.0').version, 'SillyTavern 1.19.0');
assert.equal(inspectStCapabilities({ version: {} }, '  ').version, null);
assert.equal(inspectStCapabilities({ version: ' ' }, '1.18.0').version, '1.18.0');
assert.equal(JSON.stringify(result).includes('doNotCall'), false);

// The report and the actual ordinary transport must agree as APIs disappear.
const calls = [];
const transport = Object.fromEntries(['generateRawData', 'generateRaw', 'generateQuietPrompt']
    .map(name => [name, async () => { calls.push(name); return '{}'; }]));
for (const name of ['generateRawData', 'generateRaw', 'generateQuietPrompt']) {
    const expected = inspectStCapabilities(transport).rawGeneration;
    const response = await requestTracker({ stContext: transport, prompt: 'test', responseLength: 16 });
    assert.equal(response.strategy, expected);
    assert.deepEqual(calls.splice(0), [name]);
    delete transport[name];
}
await assert.rejects(requestTracker({ stContext: transport, prompt: 'test' }), /no supported generation API/);

globalThis.SillyTavern = { getContext: () => ({ version: '1.18.0' }) };
assert.equal(readStCapabilities().version, '1.18.0');
globalThis.SillyTavern.getContext = () => ({ version: '1.19.0', generateRaw: doNotCall });
assert.equal(readStCapabilities().rawGeneration, 'raw', 'capabilities are read fresh');
globalThis.SillyTavern.getContext = () => { throw new Error('host not ready'); };
globalThis.document = { getElementById: () => ({ textContent: 'SillyTavern 1.18.0' }) };
assert.equal(readStCapabilities().version, 'SillyTavern 1.18.0');
delete globalThis.SillyTavern;
delete globalThis.document;
assert.equal(readStCapabilities().version, null);
console.log('PASS ST capability detection, API priority, optional formatter and side-effect boundaries');
