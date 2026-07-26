// tests/prompt-injection-plan.test.mjs — PromptInjectionPlan core
import assert from 'node:assert/strict';
import {
    buildPromptInjectionPlan,
    beginRequest,
    matchAllowlistedTransform,
    materializePromptInjection,
    verifyPromptInjection,
    serializePromptInjectionMeta,
    collapseNewlines,
    digestText,
    normalizeNewlines,
    extractMainInner,
    findTail,
    shouldHandlePromptHook,
    suspendPromptInjection,
    restorePromptInjection,
    getSuspendDepth,
    clearPromptInjection,
    _resetPromptInjectionModuleForTests,
    DEFAULT_TAIL,
} from '../src/generation/prompt-injection.js';
import {
    toExtensionPromptRole,
    isAllowedRoleTransition,
    normalizePromptRoleName,
} from '../src/prompts/role.js';
import {
    setInlineGenStartMs,
    setInlineGenerationContext,
} from '../src/state.js';

_resetPromptInjectionModuleForTests();

const sourceBody = 'Hello\n\nWorld\nTRACKER SCHEMA HERE';
const plan = buildPromptInjectionPlan({
    text: sourceBody,
    role: 'system',
    owner: { chatKey: 'chat-1', messageId: 3, swipeId: 0 },
    frozenRequestSchema: { value: { type: 'object', properties: { time: {} } } },
    frozenDeltaMode: true,
    baseSnapshot: { time: '12:00', secret: 'x' },
});

assert.ok(plan.runId.startsWith('sp-'));
assert.equal(plan.main.position, 'IN_PROMPT');
assert.equal(plan.tail.position, 'IN_CHAT');
assert.equal(plan.tail.depth, 0);
assert.ok(plan.main.text.includes('SP_PROMPT_BEGIN'));
assert.ok(plan.main.text.includes('SP_PROMPT_END'));
assert.ok(plan.tail.text.includes('SP_PROMPT_TAIL'));
assert.equal(plan.main.digest, digestText(plan.main.sourceText));
assert.deepEqual(plan.frozenRequestSchema.value.properties.time, {});
assert.equal(plan.frozenDeltaMode, true);
assert.equal(plan.baseSnapshot.time, '12:00');

// Deep clone: mutating original input must not affect frozen snapshot
_resetPromptInjectionModuleForTests();
const snap = { time: '12:00' };
const plan2 = buildPromptInjectionPlan({
    text: sourceBody,
    role: 'system',
    frozenRequestSchema: { value: { a: 1 } },
    frozenDeltaMode: false,
    baseSnapshot: snap,
});
snap.time = 'mutated';
assert.equal(plan2.baseSnapshot.time, '12:00');

beginRequest('chat', plan2);
assert.equal(plan2.currentRequest.seq, 1);
assert.equal(plan2.currentRequest.phase, 'awaiting-intermediate');
beginRequest('chat', plan2);
assert.equal(plan2.currentRequest.seq, 2);

// Allowlisted transforms
assert.equal(matchAllowlistedTransform('a\n\nb', 'a\n\nb').ok, true);
assert.equal(matchAllowlistedTransform('a\n\nb', collapseNewlines('a\n\nb')).transform, 'collapse_newlines');
assert.equal(matchAllowlistedTransform('a\n\nb', 'CORRUPTED').ok, false);

// Materialize + verify happy path (o1-style system→user is allowlisted)
const flat = plan2.main.text + '\n' + plan2.tail.text;
const payload = { messages: [{ role: 'user', content: flat }] };
const mat = materializePromptInjection(payload, plan2);
assert.equal(mat.ok, true, mat.code);
assert.equal(plan2.effectiveRole, 'user');
assert.equal(plan2.currentRequest.phase, 'materialized');
assert.ok(plan2.currentRequest.materializedDigest);

const ver = verifyPromptInjection(payload, { authority: 'CHAT_COMPLETION_SETTINGS_READY', plan: plan2 });
assert.equal(ver.ok, true, ver.code);
assert.equal(ver.tailFound, true);
assert.equal(plan2.currentRequest.phase, 'verified');

// Corruption before intermediate must not materialize
_resetPromptInjectionModuleForTests();
const plan3 = buildPromptInjectionPlan({ text: 'CLEAN TEXT', role: 'system' });
beginRequest('chat', plan3);
const badInner = 'TAMPERED TEXT';
const badWrapped = `<!--SP_PROMPT_BEGIN run="${plan3.runId}" digest="${plan3.main.digest}"-->\n${badInner}\n<!--SP_PROMPT_END run="${plan3.runId}" digest="${plan3.main.digest}"-->`;
const badMat = materializePromptInjection({ prompt: badWrapped }, plan3);
assert.equal(badMat.ok, false);
assert.equal(badMat.code, 'SP_PROMPT_DIGEST_MISMATCH');

// Role allowlist
assert.equal(isAllowedRoleTransition('system', 'system'), true);
assert.equal(isAllowedRoleTransition('system', 'user'), true);
assert.equal(isAllowedRoleTransition('system', 'assistant'), false);
assert.equal(normalizePromptRoleName(0), 'system');
assert.equal(normalizePromptRoleName(1), 'user');
assert.equal(toExtensionPromptRole('system'), 0);
assert.equal(toExtensionPromptRole('user'), 1);
assert.equal(toExtensionPromptRole('assistant'), 2);

// Role mismatch on materialize
_resetPromptInjectionModuleForTests();
const plan4 = buildPromptInjectionPlan({ text: 'ROLE CHECK', role: 'system' });
beginRequest('chat', plan4);
const rolePayload = {
    messages: [{ role: 'assistant', content: plan4.main.text + '\n' + plan4.tail.text }],
};
const roleMat = materializePromptInjection(rolePayload, plan4);
assert.equal(roleMat.ok, false);
assert.equal(roleMat.code, 'SP_PROMPT_ROLE_MISMATCH');

// Metadata hygiene
_resetPromptInjectionModuleForTests();
const plan5 = buildPromptInjectionPlan({
    text: 'META ' + 'x'.repeat(200) + ' user-secret-value',
    role: 'system',
});
beginRequest('text', plan5);
plan5.materializedText = plan5.main.sourceText;
plan5.currentRequest.materializedDigest = digestText(plan5.main.sourceText);
plan5.currentRequest.phase = 'materialized';
plan5.verification.finalHook = 'GENERATE_AFTER_DATA';
plan5.verifiedTokens = { mainInput: 10, tailInput: 2, totalInput: 12, estimateSource: 'heuristic' };
const meta = serializePromptInjectionMeta(plan5, 'verified');
const metaJson = JSON.stringify(meta);
assert.ok(!metaJson.includes('user-secret-value'));
assert.ok(!metaJson.includes(plan5.main.text.slice(0, 40)));
assert.equal(meta.tokens.totalInput, 12);
assert.equal(meta.output.sharesMainResponse, true);

// Hook gating
assert.equal(shouldHandlePromptHook({ dryRun: true }), false);
assert.equal(shouldHandlePromptHook({ quiet: true }), false);
assert.equal(shouldHandlePromptHook({}), false); // no mid-flight Together yet
setInlineGenStartMs(Date.now());
setInlineGenerationContext({ chatKey: 'c1', mesIdx: 1, swipeId: 0 });
assert.equal(shouldHandlePromptHook({}), true); // plan5 has currentRequest + mid-flight
assert.equal(shouldHandlePromptHook({}, { dryRunArg: true }), false);
setInlineGenStartMs(0);
setInlineGenerationContext(null);
// Suspend counter
assert.equal(getSuspendDepth(), 0);
suspendPromptInjection(plan5);
assert.equal(getSuspendDepth(), 1);
suspendPromptInjection(plan5);
assert.equal(getSuspendDepth(), 2);
restorePromptInjection(plan5);
assert.equal(getSuspendDepth(), 1);
restorePromptInjection(plan5);
assert.equal(getSuspendDepth(), 0);

// Missing tail = warning not fatal at verify
_resetPromptInjectionModuleForTests();
const plan6 = buildPromptInjectionPlan({ text: 'TAIL OPTIONAL', role: 'system' });
beginRequest('text', plan6);
const mainOnly = { prompt: plan6.main.text };
assert.equal(materializePromptInjection(mainOnly, plan6).ok, true);
const verTail = verifyPromptInjection(mainOnly, { authority: 'GENERATE_AFTER_DATA', plan: plan6 });
assert.equal(verTail.ok, true);
assert.equal(verTail.tailFound, false);
assert.equal(verTail.warning, 'SP_PROMPT_TAIL_MISSING');

clearPromptInjection(plan6.runId);
assert.equal(findTail('nope', 'sp-x'), false);
assert.equal(extractMainInner('nope', 'sp-x'), null);
assert.ok(DEFAULT_TAIL.includes('SP_TRACKER_START'));
assert.equal(normalizeNewlines('a\r\nb\rc'), 'a\nb\nc');

_resetPromptInjectionModuleForTests();
console.log('prompt-injection-plan.test.mjs: all tests passed');
