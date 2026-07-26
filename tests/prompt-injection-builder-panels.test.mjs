// tests/prompt-injection-builder-panels.test.mjs
// Regression: custom-panel content that the Together builder includes must
// remain in the PromptInjectionPlan measured text (no stripping).
import assert from 'node:assert/strict';
import {
    buildPromptInjectionPlan,
    _resetPromptInjectionModuleForTests,
} from '../src/generation/prompt-injection.js';

_resetPromptInjectionModuleForTests();

const builderText = [
    '## FIELD SPECIFICATIONS',
    '- ambientMood: Custom Atmosphere fields — populate from story context.',
    'TRACKER SCHEMA',
].join('\n');

const plan = buildPromptInjectionPlan({
    text: builderText,
    role: 'system',
});

assert.ok(plan.main.sourceText.includes('ambientMood'));
assert.ok(plan.main.text.includes('ambientMood'));
assert.ok(plan.main.sourceText.includes('Custom Atmosphere'));
// No compaction / truncation of long hints
const longHint = 'HINT_' + 'x'.repeat(5000);
const planHuge = buildPromptInjectionPlan({
    text: builderText + '\n' + longHint,
    role: 'system',
});
assert.ok(planHuge.main.sourceText.includes(longHint));
assert.ok(planHuge.main.sourceText.length > 5000);

_resetPromptInjectionModuleForTests();
console.log('prompt-injection-builder-panels.test.mjs: all tests passed');
