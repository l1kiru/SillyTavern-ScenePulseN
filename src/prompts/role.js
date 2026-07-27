// src/prompts/role.js — System prompt role routing (v6.19.0, issue #16)
//
// SillyTavern's generateRaw exposes ONE explicit `systemPrompt` param.
// Some users find that certain models (notably Claude family) follow
// instructions placed in the user message more reliably than instructions
// placed in the system message — see github.com/xenofei/SillyTavern-ScenePulse/issues/16
//
// This helper reads the active profile's `systemPromptRole` (one of
// 'system' / 'user' / 'assistant', default 'system') and adapts the
// {systemPrompt, prompt} arg pair before it is handed to generateRaw:
//
//   - 'system'    → pass through unchanged (default behavior)
//   - 'user'      → empty systemPrompt, prepend the original system text
//                   to the user prompt with a clear separator
//   - 'assistant' → same as 'user' but uses an "(assistant precedent)"
//                   wrapper. This rarely produces useful behavior; we ship
//                   it for parity with the embed-as-role selector and so
//                   power users can experiment without forking.
//
// The fallback profile (if configured separately) reuses the same role
// selection — the routing is per-profile, not per-call-site.

import { getSettings } from '../settings.js';
import { getActiveProfile } from '../profiles.js';

/**
 * Resolve the role configured on the active profile. Defaults to 'system'
 * for any profile that pre-dates v6.19.0 or has an unrecognized value.
 *
 * @returns {'system' | 'user' | 'assistant'}
 */
export function getActivePromptRole() {
    try {
        const s = getSettings();
        const p = getActiveProfile(s);
        const r = p?.systemPromptRole;
        if (r === 'user' || r === 'assistant') return r;
    } catch {}
    return 'system';
}

/** Map a configured role to SillyTavern chat-message flags. */
export function promptRoleFlags(role) {
    const isSystem = role === 'system';
    const isUser = role === 'user';
    return {
        is_user: isUser,
        is_system: isSystem,
        name: isSystem ? 'System' : (isUser ? 'ScenePulse' : 'Assistant'),
    };
}

/**
 * Map a ScenePulse role string to SillyTavern extension_prompt_roles.
 * Prefer live ST enums from context; fall back to numeric 0/1/2.
 *
 * @param {'system'|'user'|'assistant'} role
 * @returns {number}
 */
export function toExtensionPromptRole(role) {
    let roles = null;
    try {
        roles = SillyTavern.getContext()?.extension_prompt_roles
            || SillyTavern.getContext()?.extensionPromptRoles
            || null;
    } catch {}
    if (roles && typeof roles === 'object') {
        if (role === 'user' && roles.USER != null) return Number(roles.USER);
        if (role === 'assistant' && roles.ASSISTANT != null) return Number(roles.ASSISTANT);
        if (roles.SYSTEM != null) return Number(roles.SYSTEM);
    }
    if (role === 'user') return 1;
    if (role === 'assistant') return 2;
    return 0;
}

/** Normalize ST message role (string or extension_prompt_roles number) → name. */
export function normalizePromptRoleName(role) {
    if (role === 0 || role === '0' || role === 'system' || role === 'SYSTEM') return 'system';
    if (role === 1 || role === '1' || role === 'user' || role === 'USER') return 'user';
    if (role === 2 || role === '2' || role === 'assistant' || role === 'ASSISTANT') return 'assistant';
    if (typeof role === 'string') {
        const r = role.toLowerCase();
        if (r === 'system' || r === 'user' || r === 'assistant') return r;
    }
    return null;
}

/**
 * Allowlisted ST role rewrites (e.g. o1 system→user). Anything else is SP_PROMPT_ROLE_MISMATCH.
 * @param {string|null} registered
 * @param {string|null} effective
 */
export function isAllowedRoleTransition(registered, effective) {
    const from = normalizePromptRoleName(registered);
    const to = normalizePromptRoleName(effective);
    if (!from || !to) return false;
    if (from === to) return true;
    // Known SillyTavern / provider rewrite for reasoning models.
    if (from === 'system' && to === 'user') return true;
    return false;
}

/**
 * Apply the active profile's role to a {systemPrompt, prompt} pair before
 * sending to generateRaw.
 *
 * @param {{systemPrompt: string, prompt: string}} pair
 * @param {'system'|'user'|'assistant'} [forceRole]  Override the active role (test/preset use)
 * @returns {{systemPrompt: string, prompt: string}}
 */
export function applyPromptRole(pair, forceRole) {
    const role = forceRole || getActivePromptRole();
    const sys = pair?.systemPrompt || '';
    const usr = pair?.prompt || '';
    if (role === 'system') return { systemPrompt: sys, prompt: usr };
    if (!sys) return { systemPrompt: '', prompt: usr };
    if (role === 'assistant') {
        // Wrap as a faux assistant precedent — the model sees its prior turn
        // listing the rules. Not all backends honor this; documented as
        // experimental in the editor UI.
        return {
            systemPrompt: '',
            prompt: `(Assistant precedent — instructions you yourself laid out in the previous turn:)\n${sys}\n\n(End precedent. Now respond to the user request below.)\n\n${usr}`,
        };
    }
    // role === 'user'
    return {
        systemPrompt: '',
        prompt: `${sys}\n\n---\n\n${usr}`,
    };
}
