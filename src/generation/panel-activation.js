// Deterministic dynamic-panel routing and inactive-state preservation.
// LLM output is limited to canonical scene tags; panel selection, grace,
// schema projection, and state restoration are code-owned.

import { characterNameKey } from '../character-identity.js';
import {
    customPanelActivationKey,
    normalizePanelActivationMode,
    normalizeSceneTags,
    SCENE_TAG_REGISTRY,
    STICKY_SCENE_TAGS,
} from '../panel-activation-policy.js';
import { customPanelScope, isBuiltInCharacterFieldKey, isValidCustomFieldKey } from '../profiles.js';

const DEFAULT_GRACE_TURNS = 1;
const STICKY_TAG_SET = new Set(STICKY_SCENE_TAGS);

function clone(value) {
    if (value === undefined || value === null) return value;
    return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function schemaRoot(schemaWrapper) {
    const root = schemaWrapper?.value && typeof schemaWrapper.value === 'object'
        ? schemaWrapper.value
        : schemaWrapper;
    if (!root?.properties || typeof root.properties !== 'object') {
        const error = new Error('Panel activation requires an object schema with root properties');
        error.code = 'PANEL_ACTIVATION_SCHEMA_INVALID';
        throw error;
    }
    return root;
}

function enabledPanelFields(panel) {
    const scope = customPanelScope(panel);
    return (Array.isArray(panel?.fields) ? panel.fields : [])
        .filter(field => field?.enabled !== false && isValidCustomFieldKey(field?.key))
        .filter(field => scope !== 'character' || !isBuiltInCharacterFieldKey(field.key));
}

function mutatePanelFields(schemaWrapper, panels, panelIds, operation) {
    const wrapper = clone(schemaWrapper);
    const root = schemaRoot(wrapper);
    const selected = new Set(Array.isArray(panelIds) ? panelIds : []);
    for (const panel of Array.isArray(panels) ? panels : []) {
        if (!panel || panel.enabled === false || !selected.has(customPanelActivationKey(panel))) continue;
        const scope = customPanelScope(panel);
        const fields = enabledPanelFields(panel);
        if (scope === 'global') {
            for (const field of fields) operation(root, field.key);
            continue;
        }
        const items = root.properties.characters?.items;
        if (!items?.properties) continue;
        for (const field of fields) operation(items, field.key);
    }
    return wrapper?.value ? wrapper : { name: 'ScenePulse', strict: false, returnInvalid: true, value: root };
}

function removeProperty(owner, key) {
    delete owner.properties?.[key];
    if (Array.isArray(owner.required)) owner.required = owner.required.filter(field => field !== key);
}

function makeOptional(owner, key) {
    if (Array.isArray(owner.required)) owner.required = owner.required.filter(field => field !== key);
}

export function buildActivatedPanelSchema(fullSchema, panels, activePanelIds) {
    const active = new Set(Array.isArray(activePanelIds) ? activePanelIds : []);
    const inactive = (Array.isArray(panels) ? panels : [])
        .filter(panel => panel?.enabled !== false && !active.has(customPanelActivationKey(panel)))
        .map(customPanelActivationKey);
    return mutatePanelFields(fullSchema, panels, inactive, removeProperty);
}

export function buildPanelStateValidationSchema(fullSchema, panels, inactivePanelIds) {
    return mutatePanelFields(fullSchema, panels, inactivePanelIds, makeOptional);
}

export function buildRouterSchema(fullSchema) {
    const wrapper = clone(fullSchema);
    const root = schemaRoot(wrapper);
    for (const field of ['sceneTags', 'resolvedTags']) {
        if (Object.hasOwn(root.properties, field)) {
            const error = new Error(`Full schema already defines reserved router field: ${field}`);
            error.code = 'PANEL_ACTIVATION_SCHEMA_CONFLICT';
            throw error;
        }
        root.properties[field] = {
            type: 'array',
            items: { type: 'string', enum: [...SCENE_TAG_REGISTRY] },
            uniqueItems: true,
            description: field === 'sceneTags'
                ? 'Canonical situation tags active in the current scene.'
                : 'Previously sticky tags explicitly resolved by the current scene.',
        };
    }
    if (!Array.isArray(root.required)) root.required = [];
    for (const field of ['sceneTags', 'resolvedTags']) {
        if (!root.required.includes(field)) root.required.push(field);
    }
    return wrapper?.value ? wrapper : { name: 'ScenePulse Router', strict: false, returnInvalid: true, value: root };
}

export function resolvePanelActivation({
    panels,
    sceneTags,
    resolvedTags,
    previousState = null,
    graceTurns = DEFAULT_GRACE_TURNS,
} = {}) {
    const observed = normalizeSceneTags(sceneTags);
    const resolved = normalizeSceneTags(resolvedTags);
    const resolvedSet = new Set(resolved);
    const observedSet = new Set(observed.filter(tag => !resolvedSet.has(tag)));
    const previousActive = new Set(normalizeSceneTags(previousState?.activeTags));
    const previousGrace = previousState?.graceByTag && typeof previousState.graceByTag === 'object'
        ? previousState.graceByTag
        : {};
    const boundedGrace = Math.max(0, Math.min(5, Math.floor(Number(graceTurns) || 0)));
    const activeTagSet = new Set();
    const graceByTag = {};

    for (const tag of SCENE_TAG_REGISTRY) {
        if (resolvedSet.has(tag)) continue;
        if (observedSet.has(tag)) {
            activeTagSet.add(tag);
            graceByTag[tag] = boundedGrace;
            continue;
        }
        if (!previousActive.has(tag)) continue;
        if (STICKY_TAG_SET.has(tag)) {
            activeTagSet.add(tag);
            graceByTag[tag] = Math.max(0, Number(previousGrace[tag]) || 0);
            continue;
        }
        const remaining = Number.isFinite(Number(previousGrace[tag]))
            ? Math.max(0, Math.floor(Number(previousGrace[tag])))
            : boundedGrace;
        if (remaining > 0) {
            activeTagSet.add(tag);
            graceByTag[tag] = remaining - 1;
        }
    }

    const activeTags = SCENE_TAG_REGISTRY.filter(tag => activeTagSet.has(tag));
    const activePanelIds = [];
    const inactivePanelIds = [];
    const disabledPanelIds = [];
    for (const panel of Array.isArray(panels) ? panels : []) {
        if (!panel) continue;
        const id = customPanelActivationKey(panel);
        if (panel.enabled === false) {
            disabledPanelIds.push(id);
            continue;
        }
        const mode = normalizePanelActivationMode(panel);
        const panelTags = normalizeSceneTags(panel.activationTags);
        const active = mode !== 'auto' || panelTags.some(tag => activeTagSet.has(tag));
        (active ? activePanelIds : inactivePanelIds).push(id);
    }

    return {
        version: 1,
        sceneTags: observed,
        resolvedTags: resolved,
        activeTags,
        graceByTag,
        activePanelIds,
        inactivePanelIds,
        disabledPanelIds,
    };
}

function characterKeys(character) {
    return [character?.name, ...(Array.isArray(character?.aliases) ? character.aliases : [])]
        .map(characterNameKey)
        .filter(Boolean);
}

export function preserveInactivePanelState(previousSnapshot, current, panels, inactivePanelIds) {
    if (!previousSnapshot || typeof previousSnapshot !== 'object' || !current || typeof current !== 'object') return current;
    const inactive = new Set(Array.isArray(inactivePanelIds) ? inactivePanelIds : []);
    const characterFields = [];
    for (const panel of Array.isArray(panels) ? panels : []) {
        if (!panel || panel.enabled === false || !inactive.has(customPanelActivationKey(panel))) continue;
        const fields = enabledPanelFields(panel);
        if (customPanelScope(panel) === 'global') {
            for (const field of fields) {
                if (Object.hasOwn(previousSnapshot, field.key)) {
                    current[field.key] = clone(previousSnapshot[field.key]);
                } else {
                    delete current[field.key];
                }
            }
        } else {
            characterFields.push(...fields.map(field => field.key));
        }
    }
    if (!characterFields.length || !Array.isArray(current.characters) || !Array.isArray(previousSnapshot.characters)) return current;

    const previousByKey = new Map();
    for (const character of previousSnapshot.characters) {
        for (const key of characterKeys(character)) if (!previousByKey.has(key)) previousByKey.set(key, character);
    }
    for (const character of current.characters) {
        const previous = characterKeys(character).map(key => previousByKey.get(key)).find(Boolean);
        if (!previous) continue;
        for (const key of characterFields) {
            if (Object.hasOwn(previous, key)) character[key] = clone(previous[key]);
            else delete character[key];
        }
    }
    return current;
}
