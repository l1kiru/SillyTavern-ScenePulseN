import assert from 'node:assert/strict';
import { trackerContract, extractionReferenceContext } from '../src/generation/tracker-contract.js';
import { requestTracker } from '../src/generation/request.js';
import { runParallelFullBuild } from '../src/generation/parallel-build.js';

const schema = { type: 'object', properties: { elapsed: { type: 'string', description: 'annotation' }, trackedItems: { type: 'array', items: { type: 'string' } }, description: { type: 'string' }, quantity: { type: ['integer', 'null'], minimum: 0 } }, required: ['elapsed'], additionalProperties: false };
const initial = structuredClone(schema);
const text = trackerContract(schema);
assert.ok(text.includes('"required":["elapsed"]'));
assert.ok(text.includes('"description":{"type":"string"}'), 'field named description is retained');
assert.ok(!text.includes('annotation'));
assert.ok(text.includes('"minimum":0'));
assert.deepEqual(schema, initial);
const source = extractionReferenceContext({ getCharacterCardFields: () => ({ description: 'Confirmed background', persona: 'Player reference', system: 'RP system prompt', mesExamples: 'Sample dialogue', jailbreak: 'RP post history' }) });
assert.ok(source.includes('Confirmed background') && source.includes('Player reference'));
assert.ok(!source.includes('RP system prompt') && !source.includes('Sample dialogue') && !source.includes('RP post history'));

for (const mode of ['json', 'native']) {
    let captured;
    const native = { value: schema, returnInvalid: true };
    await requestTracker({ stContext: { generateRawData: async args => { captured = args; return '{}'; }, generateQuietPrompt: () => { throw new Error('Unexpected quiet transport'); } }, systemPrompt: 'Custom prompt', prompt: 'Scene', jsonSchema: native, promptMode: mode, promptRole: 'user' });
    assert.ok(captured.prompt.includes(text));
    assert.ok(captured.prompt.includes('Custom prompt'));
    assert.equal(captured.systemPrompt, '');
    assert.equal(captured.jsonSchema, mode === 'native' ? native : null);
}
let rawCalled = 0;
await requestTracker({ stContext: { generateRaw: async args => { rawCalled++; assert.ok(args.prompt.includes(text)); return '{}'; } }, prompt: 'Scene', jsonSchema: schema, promptRole: 'system' });
assert.equal(rawCalled, 1);
await assert.rejects(requestTracker({ stContext: { generateRawData: async () => { throw new Error('provider failure'); }, generateQuietPrompt: () => { throw new Error('must not retry on another transport'); } }, prompt: 'Scene', jsonSchema: schema, promptRole: 'system' }), /provider failure/);

const requests = [];
await runParallelFullBuild({ fullSchema: { value: schema }, systemPrompt: 'Custom extraction', contextText: 'Scene', previousSnapshot: { sceneAnalysis: { trackedItems: ['OLD_ITEM'] } }, profileId: 'test', maxRetries: 0,
    request: async args => { requests.push(args); return { value: args.jsonSchema.value.properties.elapsed ? { elapsed: '1m' } : { trackedItems: ['OLD_ITEM'], description: '', quantity: null } }; },
});
assert.ok(requests.every(args => args.messages.some(message => message.content.includes('TRACKER JSON CONTRACT'))));
const global = requests.find(args => args.jsonSchema.value.properties.trackedItems);
assert.ok(global.messages.some(message => message.content.includes('OLD_ITEM')), 'wrapped historical state reaches its owning lane');
requests.length = 0;
const customWrapperSchema = { type: 'object', properties: { elapsed: { type: 'string' }, sceneSummary: { type: 'string' }, sceneAnalysis: { type: 'object', properties: { sceneSummary: { type: 'string' } } } }, required: ['elapsed'] };
await runParallelFullBuild({ fullSchema: { value: customWrapperSchema }, systemPrompt: 'Extract', contextText: 'Scene', previousSnapshot: { sceneAnalysis: { sceneSummary: 'CUSTOM_PANEL_VALUE' } }, profileId: 'test', maxRetries: 0,
    request: async args => { requests.push(args); return { value: args.jsonSchema.value.properties.elapsed ? { elapsed: '1m', sceneSummary: 'Scene' } : { sceneAnalysis: { sceneSummary: 'CUSTOM_PANEL_VALUE' } } }; },
});
assert.ok(!requests.find(args => args.jsonSchema.value.properties.elapsed).messages.some(message => message.content.includes('CUSTOM_PANEL_VALUE')), 'Core must not hoist a custom wrapper owned by Global');
console.log('tracker-contract.test.mjs: passed');
