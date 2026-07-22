// src/profiles.js — Prompt + Schema Profile system (issue #15, v6.13.0)
//
// A "profile" is a self-contained bundle that drives schema + prompt
// generation: { id, name, schema, systemPrompt, panels, fieldToggles,
// dashCards, customPanels }. Switching profiles swaps which bundle the
// active schema/prompt is read from — no destructive copy, no merging.
//
// The legacy single-pair model (`s.schema`, `s.systemPrompt`,
// `s.customPanels`, `s.panels`, `s.fieldToggles`, `s.dashCards`) is
// preserved as `profiles[0]` named "Default (migrated)" on first run.
// Subsequent reads route through the active profile via the four
// chokepoint getters in src/settings.js.
//
// Per-chat profile override: a chat may set
// `chatMetadata.scenepulse.activeProfileId` to override the global
// `s.activeProfileId`. Used by the dropdown switcher when "this chat
// only" is selected.

import { DEFAULTS } from './constants.js';
import { log } from './logger.js';

const CUSTOM_PANEL_LIMITS = Object.freeze({
    panels: 32,
    fieldsPerPanel: 64,
    enumOptions: 32,
    id: 96,
    name: 100,
    key: 64,
    label: 100,
    description: 1000,
    option: 100,
});
const CUSTOM_FIELD_TYPES = new Set(['text', 'number', 'meter', 'list', 'enum']);
const RESERVED_FIELD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const FIELD_KEY_RE = /^[a-z_][a-z0-9_]*$/;
const PANEL_ID_RE = /^cp_[a-z0-9_-]+$/i;
const SAFE_MAP_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CONFIG_SCALAR_KEYS = new Set([
    'injectionMethod', 'deltaMode', 'language', 'theme', 'fontScale',
    'contextMessages', 'maxRetries', 'promptMode', 'embedSnapshots',
    'embedRole', 'autoGenerate', 'showThoughts', 'showEmptyFields',
    'sceneTransitions', 'openSections',
]);
const PROFILE_CONFIG_KEYS = new Set(['panels', 'fieldToggles', 'dashCards', 'customPanels']);

export function customPanelSectionKey(name) {
    return 'custom_' + String(name || 'untitled').replace(/\s+/g, '_').toLowerCase();
}

export function isValidCustomFieldKey(value) {
    return typeof value === 'string'
        && value.length <= CUSTOM_PANEL_LIMITS.key
        && FIELD_KEY_RE.test(value)
        && !RESERVED_FIELD_KEYS.has(value);
}

// v6.18.0: promptOverrides (per-slot overrides) added.
// v6.19.0: systemPromptRole (issue #16 — choose system/user/assistant for the
// outgoing system-prompt message) added.
// v6.20.0: appliedPresetId tracks which bundled preset (src/presets/built-in.js)
// the user accepted, so we don't re-prompt for the same model + preset pair.
const PROFILE_FIELDS = ['schema', 'systemPrompt', 'promptOverrides', 'systemPromptRole', 'appliedPresetId', 'panels', 'fieldToggles', 'dashCards', 'customPanels'];
const SCHEMA_VERSION = 1;

function _uuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // Cheap fallback for older environments
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

function _nowIso() { return new Date().toISOString(); }

function _isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function _cleanString(value, label, maxLength, errors, { required = false } = {}) {
    if (typeof value !== 'string') {
        errors.push(`${label} must be a string`);
        return '';
    }
    const cleaned = value.trim();
    if (required && !cleaned) errors.push(`${label} must not be empty`);
    if (cleaned.length > maxLength) errors.push(`${label} must be at most ${maxLength} characters`);
    return cleaned.slice(0, maxLength);
}

function _newPanelId(rawId) {
    if (typeof rawId === 'string') {
        const id = rawId.trim();
        if (id.length <= CUSTOM_PANEL_LIMITS.id && PANEL_ID_RE.test(id)) return id;
    }
    return 'cp_' + _uuid();
}

/**
 * Validate and normalize custom panels from an untrusted JSON payload.
 * Returns fresh plain objects containing only supported properties.
 */
export function validateCustomPanels(raw) {
    const errors = [];
    if (!Array.isArray(raw)) {
        return { ok: false, panels: null, errors: ['"customPanels" must be an array'] };
    }
    if (raw.length > CUSTOM_PANEL_LIMITS.panels) {
        errors.push(`"customPanels" must contain at most ${CUSTOM_PANEL_LIMITS.panels} panels`);
    }

    const cleanPanels = [];
    const panelKeys = new Set();
    const fieldKeys = new Set();

    for (let panelIndex = 0; panelIndex < Math.min(raw.length, CUSTOM_PANEL_LIMITS.panels); panelIndex++) {
        const rawPanel = raw[panelIndex];
        const panelLabel = `customPanels[${panelIndex}]`;
        if (!_isPlainObject(rawPanel)) {
            errors.push(`${panelLabel} must be an object`);
            continue;
        }

        const name = _cleanString(rawPanel.name, `${panelLabel}.name`, CUSTOM_PANEL_LIMITS.name, errors, { required: true });
        const sectionKey = customPanelSectionKey(name);
        if (name && panelKeys.has(sectionKey)) errors.push(`${panelLabel}.name duplicates another panel name`);
        if (name) panelKeys.add(sectionKey);

        if (!Array.isArray(rawPanel.fields)) {
            errors.push(`${panelLabel}.fields must be an array`);
            continue;
        }
        if (rawPanel.fields.length > CUSTOM_PANEL_LIMITS.fieldsPerPanel) {
            errors.push(`${panelLabel}.fields must contain at most ${CUSTOM_PANEL_LIMITS.fieldsPerPanel} fields`);
        }
        if (Object.hasOwn(rawPanel, 'enabled') && typeof rawPanel.enabled !== 'boolean') {
            errors.push(`${panelLabel}.enabled must be a boolean`);
        }

        const fields = [];
        for (let fieldIndex = 0; fieldIndex < Math.min(rawPanel.fields.length, CUSTOM_PANEL_LIMITS.fieldsPerPanel); fieldIndex++) {
            const rawField = rawPanel.fields[fieldIndex];
            const fieldLabel = `${panelLabel}.fields[${fieldIndex}]`;
            if (!_isPlainObject(rawField)) {
                errors.push(`${fieldLabel} must be an object`);
                continue;
            }

            const key = _cleanString(rawField.key, `${fieldLabel}.key`, CUSTOM_PANEL_LIMITS.key, errors, { required: true }).toLowerCase();
            if (key && !FIELD_KEY_RE.test(key)) errors.push(`${fieldLabel}.key must match ${FIELD_KEY_RE}`);
            if (RESERVED_FIELD_KEYS.has(key)) errors.push(`${fieldLabel}.key is reserved`);
            if (key && fieldKeys.has(key)) errors.push(`${fieldLabel}.key duplicates another custom field key`);
            if (key) fieldKeys.add(key);

            const label = _cleanString(Object.hasOwn(rawField, 'label') ? rawField.label : '', `${fieldLabel}.label`, CUSTOM_PANEL_LIMITS.label, errors);
            const desc = _cleanString(Object.hasOwn(rawField, 'desc') ? rawField.desc : '', `${fieldLabel}.desc`, CUSTOM_PANEL_LIMITS.description, errors);
            const type = typeof rawField.type === 'string' ? rawField.type.trim().toLowerCase() : '';
            if (!CUSTOM_FIELD_TYPES.has(type)) errors.push(`${fieldLabel}.type must be one of ${[...CUSTOM_FIELD_TYPES].join(', ')}`);
            if (Object.hasOwn(rawField, 'enabled') && typeof rawField.enabled !== 'boolean') {
                errors.push(`${fieldLabel}.enabled must be a boolean`);
            }
            if (Object.hasOwn(rawField, 'invert') && typeof rawField.invert !== 'boolean') {
                errors.push(`${fieldLabel}.invert must be a boolean`);
            }

            const field = { key, label, type, desc };
            if (rawField.enabled === false) field.enabled = false;
            if (type === 'meter' && rawField.invert === true) field.invert = true;

            if (type === 'enum') {
                if (!Array.isArray(rawField.options)) {
                    errors.push(`${fieldLabel}.options must be an array for enum fields`);
                } else {
                    if (rawField.options.length === 0) errors.push(`${fieldLabel}.options must not be empty for enum fields`);
                    if (rawField.options.length > CUSTOM_PANEL_LIMITS.enumOptions) {
                        errors.push(`${fieldLabel}.options must contain at most ${CUSTOM_PANEL_LIMITS.enumOptions} values`);
                    }
                    const options = [];
                    const optionSet = new Set();
                    for (let optionIndex = 0; optionIndex < Math.min(rawField.options.length, CUSTOM_PANEL_LIMITS.enumOptions); optionIndex++) {
                        const option = _cleanString(rawField.options[optionIndex], `${fieldLabel}.options[${optionIndex}]`, CUSTOM_PANEL_LIMITS.option, errors, { required: true });
                        const normalized = option.toLowerCase();
                        if (option && optionSet.has(normalized)) errors.push(`${fieldLabel}.options contains a duplicate value`);
                        if (option) optionSet.add(normalized);
                        options.push(option);
                    }
                    field.options = options;
                }
            }
            fields.push(field);
        }

        const panel = { id: _newPanelId(rawPanel.id), name, fields };
        if (rawPanel.enabled === false) panel.enabled = false;
        cleanPanels.push(panel);
    }

    return errors.length
        ? { ok: false, panels: null, errors }
        : { ok: true, panels: cleanPanels, errors: [] };
}

function _cleanBooleanMap(raw, allowedKeys, label, errors) {
    if (!_isPlainObject(raw)) {
        errors.push(`${label} must be an object`);
        return {};
    }
    const clean = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!allowedKeys.has(key)) continue;
        if (typeof value !== 'boolean') {
            errors.push(`${label}.${key} must be a boolean`);
            continue;
        }
        clean[key] = value;
    }
    return clean;
}

function _cleanFieldToggleMap(raw, errors) {
    if (!_isPlainObject(raw)) {
        errors.push('fieldToggles must be an object');
        return {};
    }
    const clean = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!SAFE_MAP_KEY_RE.test(key) || RESERVED_FIELD_KEYS.has(key) || key.length > 100) {
            errors.push(`fieldToggles contains an invalid key: ${key}`);
            continue;
        }
        if (typeof value !== 'boolean') {
            errors.push(`fieldToggles.${key} must be a boolean`);
            continue;
        }
        clean[key] = value;
    }
    return clean;
}

function _cleanOpenSections(raw, customPanels, errors) {
    if (!_isPlainObject(raw)) {
        errors.push('openSections must be an object');
        return {};
    }
    const allowed = new Set(['scene', 'quests', 'relationships', 'characters', 'branches', 'env', 'plots']);
    for (const panel of customPanels) {
        allowed.add(customPanelSectionKey(panel.name));
    }
    const clean = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!allowed.has(key)) continue;
        if (typeof value !== 'boolean') {
            errors.push(`openSections.${key} must be a boolean`);
            continue;
        }
        clean[key] = value;
    }
    return clean;
}

/**
 * Validate a ScenePulse configuration import without mutating live settings.
 * Unknown keys are ignored; supported values are normalized into clean patches.
 */
export function validateImportedConfigSettings(raw) {
    const errors = [];
    if (!_isPlainObject(raw)) {
        return { ok: false, settingsPatch: null, profilePatch: null, errors: ['settings must be a JSON object'] };
    }

    const settingsPatch = {};
    const profilePatch = {};
    let customPanels = [];

    if (Object.hasOwn(raw, 'customPanels')) {
        const result = validateCustomPanels(raw.customPanels);
        if (!result.ok) errors.push(...result.errors);
        else {
            customPanels = result.panels;
            profilePatch.customPanels = customPanels;
        }
    }
    if (Object.hasOwn(raw, 'panels')) {
        profilePatch.panels = _cleanBooleanMap(raw.panels, new Set(Object.keys(DEFAULTS.panels)), 'panels', errors);
    }
    if (Object.hasOwn(raw, 'dashCards')) {
        profilePatch.dashCards = _cleanBooleanMap(raw.dashCards, new Set(Object.keys(DEFAULTS.dashCards)), 'dashCards', errors);
    }
    if (Object.hasOwn(raw, 'fieldToggles')) {
        profilePatch.fieldToggles = _cleanFieldToggleMap(raw.fieldToggles, errors);
    }

    for (const [key, value] of Object.entries(raw)) {
        if (!CONFIG_SCALAR_KEYS.has(key) || PROFILE_CONFIG_KEYS.has(key)) continue;
        if (!Object.hasOwn(DEFAULTS, key)) continue;
        switch (key) {
            case 'injectionMethod':
                if (!['inline', 'separate'].includes(value)) errors.push('injectionMethod must be "inline" or "separate"');
                else settingsPatch[key] = value;
                break;
            case 'promptMode':
                if (!['json', 'native'].includes(value)) errors.push('promptMode must be "json" or "native"');
                else settingsPatch[key] = value;
                break;
            case 'embedRole':
                if (!['system', 'user', 'assistant'].includes(value)) errors.push('embedRole must be system, user, or assistant');
                else settingsPatch[key] = value;
                break;
            case 'language':
            case 'theme':
                if (typeof value !== 'string' || value.length > 100) errors.push(`${key} must be a string up to 100 characters`);
                else settingsPatch[key] = value;
                break;
            case 'fontScale':
                if (!Number.isFinite(value) || value < 0.7 || value > 1.5) errors.push('fontScale must be between 0.7 and 1.5');
                else settingsPatch[key] = value;
                break;
            case 'contextMessages':
                if (!Number.isInteger(value) || value < 1 || value > 30) errors.push('contextMessages must be an integer between 1 and 30');
                else settingsPatch[key] = value;
                break;
            case 'maxRetries':
                if (!Number.isInteger(value) || value < 0 || value > 5) errors.push('maxRetries must be an integer between 0 and 5');
                else settingsPatch[key] = value;
                break;
            case 'embedSnapshots':
                if (!Number.isInteger(value) || value < 0 || value > 5) errors.push('embedSnapshots must be an integer between 0 and 5');
                else settingsPatch[key] = value;
                break;
            case 'openSections':
                settingsPatch[key] = _cleanOpenSections(value, customPanels, errors);
                break;
            default:
                if (typeof value !== 'boolean') errors.push(`${key} must be a boolean`);
                else settingsPatch[key] = value;
        }
    }

    return errors.length
        ? { ok: false, settingsPatch: null, profilePatch: null, errors }
        : { ok: true, settingsPatch, profilePatch, errors: [] };
}

/**
 * Build a fresh profile object from a partial template.
 * Always returns all PROFILE_FIELDS as keys (null/empty defaults).
 */
export function makeProfile(partial = {}) {
    return {
        id: partial.id || _uuid(),
        name: partial.name || 'Untitled Profile',
        schemaVersion: SCHEMA_VERSION,
        createdAt: partial.createdAt || _nowIso(),
        updatedAt: partial.updatedAt || _nowIso(),
        description: partial.description || '',
        schema: partial.schema || null,
        // v6.18.0: legacy full-text override. New profiles should prefer
        // `promptOverrides` (per-slot) so they only diverge from defaults
        // where intentional. systemPrompt still wins over the slot system
        // for backward compatibility with hand-authored prompts.
        systemPrompt: partial.systemPrompt || null,
        // v6.18.0: per-slot prompt overrides keyed by slot id (see
        // src/prompts/slots.js SLOT_IDS). Each value is a string that
        // replaces the default text for that slot. Empty string or missing
        // key means "use the default". The editor in v6.19.0 reads/writes
        // this map; v6.20.0 model presets apply by writing into it.
        promptOverrides: partial.promptOverrides && typeof partial.promptOverrides === 'object'
            ? { ...partial.promptOverrides }
            : {},
        // v6.19.0 (issue #16): role to send the assembled system prompt as.
        // 'system' (default) is what every existing profile gets. 'user' and
        // 'assistant' merge the system prompt into the user-message slot
        // before generateRaw, since the SillyTavern generateRaw signature
        // only exposes one explicit systemPrompt field.
        systemPromptRole: ['system', 'user', 'assistant'].includes(partial.systemPromptRole)
            ? partial.systemPromptRole
            : 'system',
        // v6.20.0: id of the most-recently-applied bundled preset (or null).
        // Suppresses re-prompting once the user has accepted a preset for
        // their active model.
        appliedPresetId: typeof partial.appliedPresetId === 'string' && partial.appliedPresetId.trim()
            ? partial.appliedPresetId
            : null,
        panels: partial.panels && typeof partial.panels === 'object' ? { ...partial.panels } : {},
        fieldToggles: partial.fieldToggles && typeof partial.fieldToggles === 'object' ? { ...partial.fieldToggles } : {},
        dashCards: partial.dashCards && typeof partial.dashCards === 'object' ? { ...partial.dashCards } : {},
        customPanels: Array.isArray(partial.customPanels) ? structuredClone(partial.customPanels) : [],
    };
}

/**
 * Idempotent migration: if no profiles exist, wrap the user's current
 * legacy settings (s.schema, s.systemPrompt, s.customPanels, s.panels,
 * s.fieldToggles, s.dashCards) into a "Default" profile and set
 * activeProfileId to it. Safe to call on every settings load.
 *
 * Returns true if a migration ran (caller should saveSettings then).
 */
export function migrateLegacySettingsToProfile(s) {
    if (!s || typeof s !== 'object') return false;
    if (Array.isArray(s.profiles) && s.profiles.length > 0 && s.activeProfileId) {
        // Already migrated; ensure activeProfileId still points at a real
        // profile. If the active one was deleted out-of-band, fall back
        // to the first one to avoid null-pointer crashes downstream.
        const exists = s.profiles.some(p => p && p.id === s.activeProfileId);
        if (!exists) {
            s.activeProfileId = s.profiles[0].id;
            return true;
        }
        return false;
    }
    // Capture legacy values into the migrated profile. Use null/empty
    // defaults rather than copying the DEFAULTS values — the legacy
    // schema/systemPrompt fields are nullable overrides, so null here
    // means "use dynamically built schema/prompt from panels+toggles".
    const legacy = makeProfile({
        name: 'Default',
        description: 'Migrated from your previous configuration.',
        schema: typeof s.schema === 'string' && s.schema.trim() ? s.schema : null,
        systemPrompt: typeof s.systemPrompt === 'string' && s.systemPrompt.trim() ? s.systemPrompt : null,
        panels: s.panels && typeof s.panels === 'object' ? s.panels : {},
        fieldToggles: s.fieldToggles && typeof s.fieldToggles === 'object' ? s.fieldToggles : {},
        dashCards: s.dashCards && typeof s.dashCards === 'object' ? s.dashCards : {},
        customPanels: Array.isArray(s.customPanels) ? s.customPanels : [],
    });
    s.profiles = [legacy];
    s.activeProfileId = legacy.id;
    log('Profiles migration: wrapped legacy settings as "Default" profile', legacy.id);
    return true;
}

/**
 * v6.16.2 backfill — clean up "shadowed root data" orphaned by the v6.13.0
 * migration. The original `migrateLegacySettingsToProfile` COPIED legacy
 * values into the new profile but left the originals at the root. Result:
 * the diagnostics bundle and other consumers that read from raw `s` saw
 * stale data that the UI was no longer using (Panel C synthesis).
 *
 * Rules per Panel C Q3 (treats all six profile-overlay fields uniformly):
 *  - panels / fieldToggles / dashCards / customPanels: ALWAYS overlaid by
 *    profile. If profile has its own value, root is dead → clear. If profile
 *    is empty/missing the field, MOVE root → profile.
 *  - schema / systemPrompt: only overlaid when profile.<x> is non-null. If
 *    profile.<x> IS non-null, root is dead → clear. Otherwise root is
 *    genuinely effective; leave it.
 *
 * Idempotent. Logs each field cleared. Returns the count of fields touched.
 */
export function migrateOrphanRootData(s) {
    if (!s || typeof s !== 'object') return 0;
    if (!Array.isArray(s.profiles) || !s.profiles.length || !s.activeProfileId) return 0;
    const profile = s.profiles.find(p => p && p.id === s.activeProfileId);
    if (!profile) return 0;

    // v6.22.1: ONE-SHOT GUARD. Previously this ran on EVERY getActivePrompt /
    // getActiveSchema call, which created a race with user actions: the user
    // would clear customPanels via Profile Manager, the migration would fire
    // on the next read, see profile.customPanels=[] AND root.customPanels
    // still populated (because v6.13.0 COPIED rather than MOVED), and
    // promote root → profile, undoing the user's clear.
    //
    // Fix: a per-installation flag on `s` itself so the migration runs at
    // most ONCE post-upgrade. After it runs, root data is drained and the
    // promote/clear branches never fire again. Users who explicitly clear
    // a profile's overlay field at the manager level will see their clear
    // stick because the migration won't be re-running on every read.
    if (s._spOrphanMigrationDone) return 0;

    let touched = 0;

    // Always-overlaid object/array fields
    const _alwaysOverlaid = [
        { key: 'panels',        emptyVal: () => ({}) },
        { key: 'fieldToggles',  emptyVal: () => ({}) },
        { key: 'dashCards',     emptyVal: () => ({}) },
        { key: 'customPanels',  emptyVal: () => [] },
    ];
    for (const { key, emptyVal } of _alwaysOverlaid) {
        const rootVal = s[key];
        const profVal = profile[key];
        const rootHas = (Array.isArray(rootVal) ? rootVal.length > 0
                          : (rootVal && typeof rootVal === 'object' && Object.keys(rootVal).length > 0));
        if (!rootHas) continue;
        const profHas = (Array.isArray(profVal) ? profVal.length > 0
                          : (profVal && typeof profVal === 'object' && Object.keys(profVal).length > 0));
        if (profHas) {
            // Profile owns it; root is dead weight.
            log(`Orphan migration: cleared root.${key} (shadowed by profile "${profile.name}")`);
            s[key] = emptyVal();
            touched++;
        } else {
            // Profile is empty; promote root → profile.
            log(`Orphan migration: moved root.${key} → profile "${profile.name}"`);
            profile[key] = rootVal;
            s[key] = emptyVal();
            touched++;
        }
    }

    // Conditionally-overlaid scalar fields — only touch if profile sets them.
    const _conditionallyOverlaid = ['schema', 'systemPrompt'];
    for (const key of _conditionallyOverlaid) {
        const profSet = (typeof profile[key] === 'string' && profile[key].trim().length > 0);
        if (!profSet) continue; // root is genuinely effective; leave it
        const rootVal = s[key];
        if (typeof rootVal === 'string' && rootVal.trim().length > 0) {
            log(`Orphan migration: cleared root.${key} (shadowed by profile.${key})`);
            s[key] = null;
            touched++;
        }
    }

    // Set the one-shot flag whether or not anything was touched — running
    // once and finding nothing to do is the success state.
    s._spOrphanMigrationDone = true;

    if (touched > 0) {
        profile.updatedAt = new Date().toISOString();
    }
    return touched;
}

/**
 * Resolve the currently-active profile.
 *
 * Resolution order:
 *   1. If chat metadata has scenepulse.activeProfileId AND that profile
 *      exists, use it (per-chat override).
 *   2. Else use s.activeProfileId.
 *   3. Else fall back to s.profiles[0].
 *   4. Else (no profiles at all — shouldn't happen post-migration) build
 *      an emergency stub from legacy fields directly. Defensive only.
 */
export function getActiveProfile(s, chatMetadata) {
    if (!s || typeof s !== 'object') s = {};
    const profiles = Array.isArray(s.profiles) ? s.profiles : [];

    let activeId = null;
    try {
        const cm = chatMetadata || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext().chatMetadata : null);
        if (cm && cm.scenepulse && cm.scenepulse.activeProfileId) {
            const overrideId = cm.scenepulse.activeProfileId;
            if (profiles.some(p => p && p.id === overrideId)) {
                activeId = overrideId;
            }
        }
    } catch {}

    if (!activeId && s.activeProfileId) {
        if (profiles.some(p => p && p.id === s.activeProfileId)) {
            activeId = s.activeProfileId;
        }
    }

    if (!activeId && profiles.length > 0) {
        activeId = profiles[0].id;
    }

    if (activeId) {
        const found = profiles.find(p => p && p.id === activeId);
        if (found) return found;
    }

    // Emergency fallback — synthesize from legacy fields. Only happens if
    // migration never ran (e.g. settings stub from a test).
    return makeProfile({
        name: 'Emergency Default',
        schema: typeof s.schema === 'string' && s.schema.trim() ? s.schema : null,
        systemPrompt: typeof s.systemPrompt === 'string' && s.systemPrompt.trim() ? s.systemPrompt : null,
        panels: s.panels || {},
        fieldToggles: s.fieldToggles || {},
        dashCards: s.dashCards || {},
        customPanels: Array.isArray(s.customPanels) ? s.customPanels : [],
    });
}

/**
 * CRUD: create a new profile, append to s.profiles. Returns the new
 * profile. Caller is responsible for saveSettings().
 */
export function createProfile(s, partial = {}) {
    if (!Array.isArray(s.profiles)) s.profiles = [];
    const name = _uniqueName(s.profiles, partial.name || 'New Profile');
    const p = makeProfile({ ...partial, name });
    s.profiles.push(p);
    return p;
}

/**
 * Duplicate the named profile. Auto-suffixes "(copy)" / "(copy 2)" so
 * the new name is unique. Returns the duplicate.
 */
export function duplicateProfile(s, profileId) {
    const src = s.profiles.find(p => p.id === profileId);
    if (!src) return null;
    const baseName = src.name + ' (copy)';
    const name = _uniqueName(s.profiles, baseName);
    const copy = makeProfile({
        ...structuredClone(src),
        id: _uuid(),
        name,
        createdAt: _nowIso(),
        updatedAt: _nowIso(),
    });
    s.profiles.push(copy);
    return copy;
}

/**
 * Rename a profile. Returns true if the rename happened. Auto-resolves
 * collisions by adding a numeric suffix.
 */
export function renameProfile(s, profileId, newName) {
    const p = s.profiles.find(x => x.id === profileId);
    if (!p) return false;
    const trimmed = String(newName || '').trim();
    if (!trimmed) return false;
    if (trimmed === p.name) return true;
    p.name = _uniqueName(s.profiles.filter(x => x.id !== profileId), trimmed);
    p.updatedAt = _nowIso();
    return true;
}

/**
 * Delete a profile. Refuses to delete the last remaining profile.
 * If the deleted profile was active, falls back to the first remaining.
 * Returns the new activeProfileId (or null if deletion was refused).
 */
export function deleteProfile(s, profileId) {
    if (!Array.isArray(s.profiles) || s.profiles.length <= 1) return null;
    const idx = s.profiles.findIndex(p => p.id === profileId);
    if (idx < 0) return null;
    s.profiles.splice(idx, 1);
    if (s.activeProfileId === profileId) {
        s.activeProfileId = s.profiles[0].id;
    }
    // Clear any per-chat override pointing at the deleted profile.
    try {
        const cm = SillyTavern.getContext().chatMetadata;
        if (cm && cm.scenepulse && cm.scenepulse.activeProfileId === profileId) {
            cm.scenepulse.activeProfileId = null;
            try { SillyTavern.getContext().saveMetadata(); } catch {}
        }
    } catch {}
    return s.activeProfileId;
}

/**
 * Set the global active profile. Returns true on success. Does NOT save.
 */
export function setActiveProfile(s, profileId) {
    if (!s.profiles || !s.profiles.some(p => p.id === profileId)) return false;
    s.activeProfileId = profileId;
    return true;
}

/**
 * Set or clear the per-chat profile override.
 * Pass null to clear (revert to global).
 */
export function setChatActiveProfile(profileId) {
    try {
        const ctx = SillyTavern.getContext();
        if (!ctx || !ctx.chatMetadata) return false;
        if (!ctx.chatMetadata.scenepulse) ctx.chatMetadata.scenepulse = { snapshots: {} };
        if (profileId) ctx.chatMetadata.scenepulse.activeProfileId = profileId;
        else delete ctx.chatMetadata.scenepulse.activeProfileId;
        try { ctx.saveMetadata(); } catch {}
        return true;
    } catch { return false; }
}

/**
 * Update fields on the active profile. Used when the user edits the
 * schema textarea / system prompt textarea / customPanels list. The
 * read-through getter resolves through profiles, so writes need to land
 * on the active profile, not on legacy s.schema / s.systemPrompt.
 */
export function updateActiveProfile(s, patch) {
    const p = getActiveProfile(s);
    if (!p) return false;
    const live = s.profiles.find(x => x.id === p.id);
    if (!live) return false;
    for (const k of PROFILE_FIELDS) {
        if (Object.hasOwn(patch, k)) live[k] = patch[k];
    }
    live.updatedAt = _nowIso();
    return true;
}

/**
 * Validate an imported profile object. Returns { ok, profile, errors }.
 * Strict-enough to refuse obviously-malformed input but permissive on
 * cosmetic fields.
 */
export function validateImportedProfile(raw) {
    const errors = [];
    if (!_isPlainObject(raw)) {
        return { ok: false, profile: null, errors: ['Not a JSON object'] };
    }
    if (typeof raw.name !== 'string' || !raw.name.trim()) {
        errors.push('Missing or empty "name"');
    } else if (raw.name.trim().length > 100) {
        errors.push('"name" must be at most 100 characters');
    }
    if (raw.description != null && typeof raw.description !== 'string') {
        errors.push('"description" must be a string');
    } else if (typeof raw.description === 'string' && raw.description.length > 1000) {
        errors.push('"description" must be at most 1000 characters');
    }
    if (raw.schema != null && typeof raw.schema !== 'string') {
        errors.push('"schema" must be a string (JSON-encoded) or null');
    }
    if (typeof raw.schema === 'string' && raw.schema.trim()) {
        try {
            const parsed = JSON.parse(raw.schema);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                errors.push('"schema" parses but is not a JSON object');
            } else if (parsed.type && parsed.type !== 'object') {
                errors.push('"schema" root type must be "object"');
            }
        } catch (e) {
            errors.push('"schema" is not valid JSON: ' + (e?.message || 'parse error'));
        }
    }
    if (raw.systemPrompt != null && typeof raw.systemPrompt !== 'string') {
        errors.push('"systemPrompt" must be a string or null');
    }
    const customPanelsResult = validateCustomPanels(Object.hasOwn(raw, 'customPanels') ? raw.customPanels : []);
    if (!customPanelsResult.ok) errors.push(...customPanelsResult.errors);
    const panels = _cleanBooleanMap(Object.hasOwn(raw, 'panels') ? raw.panels : {}, new Set(Object.keys(DEFAULTS.panels)), 'panels', errors);
    const dashCards = _cleanBooleanMap(Object.hasOwn(raw, 'dashCards') ? raw.dashCards : {}, new Set(Object.keys(DEFAULTS.dashCards)), 'dashCards', errors);
    const fieldToggles = _cleanFieldToggleMap(Object.hasOwn(raw, 'fieldToggles') ? raw.fieldToggles : {}, errors);
    const promptOverrides = {};
    if (raw.promptOverrides != null && !_isPlainObject(raw.promptOverrides)) {
        errors.push('"promptOverrides" must be an object');
    } else if (_isPlainObject(raw.promptOverrides)) {
        for (const [key, value] of Object.entries(raw.promptOverrides)) {
            if (!SAFE_MAP_KEY_RE.test(key) || RESERVED_FIELD_KEYS.has(key) || key.length > 100) {
                errors.push(`promptOverrides contains an invalid key: ${key}`);
            } else if (typeof value !== 'string') {
                errors.push(`promptOverrides.${key} must be a string`);
            } else {
                promptOverrides[key] = value;
            }
        }
    }
    if (errors.length > 0) {
        return { ok: false, profile: null, errors };
    }
    // Build a clean profile from the raw payload, dropping any unknown
    // top-level keys. Always assigns a fresh id to avoid collisions with
    // existing profiles on import.
    const profile = makeProfile({
        name: raw.name.trim(),
        description: raw.description?.trim() || '',
        schema: raw.schema || null,
        systemPrompt: raw.systemPrompt || null,
        // v6.18.0: per-slot prompt overrides survive export/import so users
        // can share customized prompts via the existing profile JSON file.
        promptOverrides,
        // v6.19.0: role selector also survives export/import.
        systemPromptRole: raw.systemPromptRole,
        panels,
        fieldToggles,
        dashCards,
        customPanels: customPanelsResult.panels,
    });
    return { ok: true, profile, errors: [] };
}

/**
 * Import a validated profile into s.profiles. Auto-suffixes the name to
 * avoid collision with existing profiles. Returns the imported profile.
 */
export function importProfile(s, profile) {
    if (!Array.isArray(s.profiles)) s.profiles = [];
    profile.name = _uniqueName(s.profiles, profile.name);
    s.profiles.push(profile);
    return profile;
}

/**
 * Serialize a profile for export. Strips the id (recipient gets a fresh
 * one on import) and any per-chat residue. Adds an export marker.
 */
export function exportProfile(profile) {
    if (!profile) return null;
    const { id, ...rest } = profile;
    return {
        ...rest,
        _scenepulseExport: 'profile',
        _exportedAt: _nowIso(),
    };
}

// ─── Helpers ───────────────────────────────────────────────────────────

function _uniqueName(profiles, desired) {
    const existing = new Set((profiles || []).map(p => (p?.name || '').toLowerCase().trim()));
    const trimmed = String(desired || 'Profile').trim() || 'Profile';
    if (!existing.has(trimmed.toLowerCase())) return trimmed;
    for (let i = 2; i < 1000; i++) {
        const candidate = `${trimmed} (${i})`;
        if (!existing.has(candidate.toLowerCase())) return candidate;
    }
    return `${trimmed} (${Date.now()})`;
}

// ─── Exports for tests ──────────────────────────────────────────────────
export const _internals = { _uuid, _uniqueName, PROFILE_FIELDS, SCHEMA_VERSION };
