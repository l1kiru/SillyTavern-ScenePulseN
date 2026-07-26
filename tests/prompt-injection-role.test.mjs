// tests/prompt-injection-role.test.mjs
import assert from 'node:assert/strict';
import {
    toExtensionPromptRole,
    isAllowedRoleTransition,
    normalizePromptRoleName,
    promptRoleFlags,
} from '../src/prompts/role.js';

assert.deepEqual(promptRoleFlags('system'), { is_user: false, is_system: true, name: 'System' });
assert.equal(toExtensionPromptRole('system'), 0);
assert.equal(toExtensionPromptRole('user'), 1);
assert.equal(toExtensionPromptRole('assistant'), 2);
assert.equal(normalizePromptRoleName('SYSTEM'), 'system');
assert.equal(isAllowedRoleTransition('system', 'user'), true);
assert.equal(isAllowedRoleTransition('user', 'assistant'), false);

console.log('prompt-injection-role.test.mjs: all tests passed');
