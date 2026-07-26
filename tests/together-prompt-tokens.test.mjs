// tests/together-prompt-tokens.test.mjs — Together Σ full-request prompt estimate
import assert from 'node:assert/strict';
import {
    extractCanonicalPromptText,
    estimateRequestPromptTokens,
    getTogetherPromptTokens,
    beginRequest,
    buildPromptInjectionPlan,
    _resetPromptInjectionModuleForTests,
} from '../src/generation/prompt-injection.js';
import { setActivePromptInjectionRun } from '../src/state.js';

_resetPromptInjectionModuleForTests();

const textPrompt = 'A'.repeat(400); // heuristic → 100 tokens
const textPayload = { prompt: textPrompt };
assert.equal(extractCanonicalPromptText(textPayload), textPrompt);
const textEst = await estimateRequestPromptTokens(textPayload);
assert.equal(textEst.tokens, 100);
assert.equal(textEst.source, 'heuristic');

const msgA = { role: 'system', content: 'B'.repeat(40) }; // 10
const msgB = { role: 'user', content: 'C'.repeat(80) }; // 20
const chatOnly = { messages: [msgA, msgB] };
const chatText = extractCanonicalPromptText(chatOnly);
assert.equal(chatText, msgA.content + '\n' + msgB.content);
const chatEst = await estimateRequestPromptTokens(chatOnly);
assert.equal(chatEst.tokens, 30);

// Duplicate chat array must not double-count when messages is present
const dup = {
    messages: [msgA, msgB],
    chat: [msgA, msgB, { role: 'assistant', content: 'EXTRA'.repeat(100) }],
};
assert.equal(extractCanonicalPromptText(dup), chatText);
const dupEst = await estimateRequestPromptTokens(dup);
assert.equal(dupEst.tokens, chatEst.tokens);

assert.equal(getTogetherPromptTokens(null), 0);
assert.equal(getTogetherPromptTokens({}), 0);
assert.equal(getTogetherPromptTokens({ currentRequest: {} }), 0);
assert.equal(getTogetherPromptTokens({ currentRequest: { fullPromptTokens: 7200 } }), 7200);
assert.equal(getTogetherPromptTokens({ currentRequest: { fullPromptTokens: -1 } }), 0);

const plan = buildPromptInjectionPlan({
    text: 'tracker instructions',
    role: 'system',
    owner: { chatKey: 'k', messageId: 1, swipeId: 0 },
});
beginRequest(null, plan);
assert.equal(plan.currentRequest.fullPromptTokens, null);
assert.equal(getTogetherPromptTokens(plan), 0);
plan.currentRequest.fullPromptTokens = 1234;
assert.equal(getTogetherPromptTokens(plan), 1234);
setActivePromptInjectionRun(plan);
assert.equal(getTogetherPromptTokens(), 1234);

// beginRequest clears stored full prompt tokens for the new seq
beginRequest(null, plan);
assert.equal(plan.currentRequest.fullPromptTokens, null);
assert.equal(getTogetherPromptTokens(plan), 0);

_resetPromptInjectionModuleForTests();
console.log('together-prompt-tokens.test.mjs: ok');
