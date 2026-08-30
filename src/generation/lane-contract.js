// Pure contracts for the opt-in full-generation fan-out.
//
// This module deliberately has no transport, settings, UI, or persistence
// dependencies. It only projects one lane onto its declared ownership and
// deterministically combines already accepted lane results. Runtime use stays
// behind the explicit parallel-full feature flag.

import { characterNameKey } from '../character-identity.js';
import { buildRequestSchema } from '../schema.js';

const LANE_KINDS = new Set(['core', 'characters', 'global']);

function clone(value) {
    if (value === undefined || value === null) return value;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function fail(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
}

function schemaValue(schemaWrapper) {
    const value = schemaWrapper?.value && typeof schemaWrapper.value === 'object'
        ? schemaWrapper.value
        : schemaWrapper;
    if (!value || typeof value !== 'object' || Array.isArray(value) || !value.properties) {
        fail('LANE_SCHEMA_INVALID', 'Lane schema source must be an object schema with properties');
    }
    return value;
}

function uniqueStrings(values, label, { required = false } = {}) {
    if (!Array.isArray(values)) fail('LANE_SPEC_INVALID', `${label} must be an array`);
    const result = [];
    const seen = new Set();
    for (const value of values) {
        if (typeof value !== 'string' || !value.trim()) {
            fail('LANE_SPEC_INVALID', `${label} must contain non-empty strings`);
        }
        const clean = value.trim();
        const key = clean.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(clean);
    }
    if (required && result.length === 0) fail('LANE_SPEC_INVALID', `${label} must not be empty`);
    return result;
}

function normalizeSpec(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        fail('LANE_SPEC_INVALID', 'Lane spec must be an object');
    }
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const kind = typeof raw.kind === 'string' ? raw.kind.trim().toLowerCase() : '';
    if (!id) fail('LANE_SPEC_INVALID', 'Lane spec id must not be empty');
    if (!LANE_KINDS.has(kind)) fail('LANE_SPEC_INVALID', `Unsupported lane kind: ${kind || '(empty)'}`);
    const fields = uniqueStrings(raw.fields, `Lane ${id} fields`, { required: true });
    const ownsCharacters = fields.includes('characters');
    if (kind === 'characters' && (fields.length !== 1 || !ownsCharacters)) {
        fail('LANE_SPEC_INVALID', `Character lane ${id} may own only the characters root field`);
    }
    if (kind !== 'characters' && ownsCharacters) {
        fail('LANE_SPEC_INVALID', `Non-character lane ${id} may not own the characters root field`);
    }
    const characterNames = kind === 'characters'
        ? uniqueStrings(raw.characterNames, `Lane ${id} characterNames`, { required: true })
        : [];
    const characterFields = raw.characterFields === undefined || raw.characterFields === null
        ? null
        : uniqueStrings(raw.characterFields, `Lane ${id} characterFields`);
    return { id, kind, fields, characterNames, characterFields };
}

function matchingCharacterKeys(name, aliases, allowedNames) {
    const keys = [name, ...(Array.isArray(aliases) ? aliases : [])]
        .map(characterNameKey)
        .filter(Boolean);
    return [...new Set(keys.filter(key => allowedNames.has(key)))];
}

/**
 * Build a non-mutating section-like schema for one lane.
 * Character lanes may further restrict characters[].properties; identity
 * fields are retained automatically so batches can be matched safely.
 */
export function buildLaneSchema(schemaWrapper, rawSpec) {
    const spec = normalizeSpec(rawSpec);
    const source = schemaValue(schemaWrapper);
    for (const field of spec.fields) {
        if (!Object.hasOwn(source.properties, field)) {
            fail('LANE_SCHEMA_FIELD_UNKNOWN', `Lane ${spec.id} references unknown root field: ${field}`);
        }
    }

    const laneSchema = buildRequestSchema(schemaWrapper, {
        mode: 'section',
        fields: spec.fields,
        // The source schema is frozen for the generation operation. Re-reading
        // active settings here could make sibling lanes disagree if the user
        // changes profiles while a build is in flight.
        syncActiveCharacterRequirements: false,
    });
    // Section refresh intentionally requires every selected field. Lanes are
    // different: optional fields in the frozen full schema (notably
    // temporalIntent) must remain optional or a valid provider response would
    // trigger a pointless lane-local retry.
    laneSchema.value.required = (Array.isArray(source.required) ? source.required : [])
        .filter(field => spec.fields.includes(field));
    if (spec.kind !== 'characters') return laneSchema;

    const sourceItems = source.properties.characters?.items;
    const laneItems = laneSchema.value.properties.characters?.items;
    if (!sourceItems?.properties || !laneItems?.properties || !Object.hasOwn(sourceItems.properties, 'name')) {
        fail('LANE_SCHEMA_INVALID', 'Character lane requires characters[].properties.name');
    }

    const identityFields = ['name'];
    if (Object.hasOwn(sourceItems.properties, 'aliases')) identityFields.push('aliases');
    const requested = spec.characterFields === null
        ? Object.keys(sourceItems.properties)
        : [...identityFields, ...spec.characterFields];
    const requestedSet = new Set(requested);
    for (const field of requestedSet) {
        if (!Object.hasOwn(sourceItems.properties, field)) {
            fail('LANE_SCHEMA_FIELD_UNKNOWN', `Lane ${spec.id} references unknown character field: ${field}`);
        }
    }
    laneItems.properties = Object.fromEntries(
        Object.entries(sourceItems.properties).filter(([field]) => requestedSet.has(field)),
    );
    laneItems.required = (Array.isArray(sourceItems.required) ? sourceItems.required : [])
        .filter(field => requestedSet.has(field));
    if (!laneItems.required.includes('name')) laneItems.required.unshift('name');
    laneItems.additionalProperties = false;
    return laneSchema;
}

/**
 * Strip everything a lane does not own. This is a security/consistency
 * boundary, not validation: the projected value is still expected to pass
 * its lane schema before it can be merged and committed.
 */
export function projectLaneResult(schemaWrapper, rawSpec, candidate) {
    const spec = normalizeSpec(rawSpec);
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        fail('LANE_RESULT_INVALID', `Lane ${spec.id} result must be an object`);
    }
    const laneSchema = buildLaneSchema(schemaWrapper, spec);
    const allowedRoot = new Set(Object.keys(laneSchema.value.properties));
    const requiredRoot = new Set(Array.isArray(laneSchema.value.required) ? laneSchema.value.required : []);
    const diagnostics = {
        droppedRootFields: Object.keys(candidate).filter(field => !allowedRoot.has(field)),
        droppedCharacters: [],
        droppedCharacterFields: [],
        missingRootFields: [...requiredRoot].filter(field => !Object.hasOwn(candidate, field)),
        missingCharacters: [],
    };
    const value = {};

    for (const field of allowedRoot) {
        if (!Object.hasOwn(candidate, field)) continue;
        if (field !== 'characters' || !Array.isArray(candidate.characters)) {
            value[field] = clone(candidate[field]);
            continue;
        }

        const allowedNames = new Set(spec.characterNames.map(characterNameKey));
        const matchedNames = new Set();
        const itemProperties = laneSchema.value.properties.characters?.items?.properties || {};
        const allowedCharacterFields = new Set(Object.keys(itemProperties));
        value.characters = [];
        for (const character of candidate.characters) {
            const name = character && typeof character === 'object' && !Array.isArray(character)
                ? String(character.name || '').trim()
                : '';
            const aliases = character && typeof character === 'object' && !Array.isArray(character)
                ? character.aliases
                : [];
            const matched = name ? matchingCharacterKeys(name, aliases, allowedNames) : [];
            if (matched.length === 0) {
                diagnostics.droppedCharacters.push(name || '(missing name)');
                continue;
            }
            if (matched.length > 1) {
                fail('LANE_CHARACTER_AMBIGUOUS', `Lane ${spec.id} returned ${name} for multiple owned characters`);
            }
            if (matchedNames.has(matched[0])) {
                fail('LANE_CHARACTER_RESULT_CONFLICT', `Lane ${spec.id} returned more than one result for ${name}`);
            }
            matchedNames.add(matched[0]);
            const projectedCharacter = {};
            for (const [characterField, fieldValue] of Object.entries(character)) {
                if (!allowedCharacterFields.has(characterField)) {
                    diagnostics.droppedCharacterFields.push(`${name}.${characterField}`);
                    continue;
                }
                projectedCharacter[characterField] = clone(fieldValue);
            }
            value.characters.push(projectedCharacter);
        }
        diagnostics.missingCharacters = spec.characterNames
            .filter(name => !matchedNames.has(characterNameKey(name)));
    }
    return { value, diagnostics };
}

/**
 * Deterministically merge lane-owned values. The result is only a candidate:
 * callers must run final full-schema validation, ownership checks, normalize,
 * and the single snapshot commit outside this module.
 */
export function mergeOwnedLaneResults(schemaWrapper, lanes, { allowMissingCharacters = false } = {}) {
    if (!Array.isArray(lanes) || lanes.length === 0) {
        fail('LANE_RESULT_INVALID', 'Lane results must be a non-empty array');
    }
    const normalized = lanes.map(item => ({
        spec: normalizeSpec(item?.spec),
        result: item?.result,
    }));
    const laneIds = new Set();
    const rootOwners = new Map();
    const characterOwners = new Map();
    for (const { spec } of normalized) {
        if (laneIds.has(spec.id)) fail('LANE_ID_CONFLICT', `Duplicate lane id: ${spec.id}`);
        laneIds.add(spec.id);
        for (const field of spec.fields) {
            if (field === 'characters' && spec.kind === 'characters') continue;
            const previous = rootOwners.get(field);
            if (previous) {
                fail('LANE_OWNERSHIP_CONFLICT', `Root field ${field} is owned by both ${previous} and ${spec.id}`);
            }
            rootOwners.set(field, spec.id);
        }
        for (const name of spec.characterNames) {
            const key = characterNameKey(name);
            const previous = characterOwners.get(key);
            if (previous) {
                fail('LANE_CHARACTER_OWNERSHIP_CONFLICT', `Character ${name} is owned by both ${previous} and ${spec.id}`);
            }
            characterOwners.set(key, spec.id);
        }
    }

    const value = {};
    const diagnostics = [];
    const mergedCharacterNames = new Map();
    for (const { spec, result } of normalized) {
        const projected = projectLaneResult(schemaWrapper, spec, result);
        diagnostics.push({ laneId: spec.id, ...projected.diagnostics });
        if (projected.diagnostics.missingRootFields.length) {
            fail('LANE_RESULT_FIELD_MISSING', `Lane ${spec.id} omitted: ${projected.diagnostics.missingRootFields.join(', ')}`);
        }
        if (projected.diagnostics.missingCharacters.length && !allowMissingCharacters) {
            fail('LANE_CHARACTER_MISSING', `Lane ${spec.id} omitted: ${projected.diagnostics.missingCharacters.join(', ')}`);
        }
        for (const [field, fieldValue] of Object.entries(projected.value)) {
            if (field !== 'characters') {
                value[field] = clone(fieldValue);
                continue;
            }
            if (!Array.isArray(fieldValue)) {
                fail('LANE_RESULT_INVALID', `Lane ${spec.id} characters result must be an array`);
            }
            if (!Array.isArray(value.characters)) value.characters = [];
            for (const character of fieldValue) {
                const key = characterNameKey(character?.name);
                if (key && mergedCharacterNames.has(key)) {
                    fail('LANE_CHARACTER_RESULT_CONFLICT', `Character ${character.name} was returned by both ${mergedCharacterNames.get(key)} and ${spec.id}`);
                }
                if (key) mergedCharacterNames.set(key, spec.id);
                value.characters.push(clone(character));
            }
        }
    }
    return { value, diagnostics };
}
