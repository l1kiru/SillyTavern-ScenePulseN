// tests/prompt-injection-footer-meta.test.mjs
import assert from 'node:assert/strict';
import {
    setLastPromptInjectionMetrics,
    getLastPromptInjectionMetrics,
    setInlineGenerationContext,
} from '../src/state.js';
import { serializePromptInjectionMeta, _resetPromptInjectionModuleForTests, buildPromptInjectionPlan, beginRequest } from '../src/generation/prompt-injection.js';

_resetPromptInjectionModuleForTests();

setLastPromptInjectionMetrics({
    chatKey: 'c1',
    messageId: 5,
    swipeId: 0,
    tokens: { mainInput: 100, tailInput: 10, totalInput: 110, estimateSource: 'heuristic' },
    integrity: { main: 'verified', tail: 'verified', hook: 'GENERATE_AFTER_DATA' },
});
assert.equal(getLastPromptInjectionMetrics().tokens.totalInput, 110);

setInlineGenerationContext({ chatKey: 'c1', mesIdx: 5, swipeId: 0 });

const plan = buildPromptInjectionPlan({ text: 'x', role: 'system' });
beginRequest('text', plan);
plan.verifiedTokens = { mainInput: 50, tailInput: 5, totalInput: 55, estimateSource: 'st-tokenizer' };
plan.verification.finalHook = 'GENERATE_AFTER_DATA';
plan.verification.main = 'verified';
plan.verification.tail = 'verified';
const meta = serializePromptInjectionMeta(plan);
assert.equal(meta.v, 1);
assert.equal(meta.tokens.totalInput, 55);
assert.equal(meta.output.dedicatedReserve, 0);
assert.ok(!JSON.stringify(meta).includes(plan.main.text));

_resetPromptInjectionModuleForTests();
console.log('prompt-injection-footer-meta.test.mjs: all tests passed');
