// Known provider envelopes only. Never flatten arbitrary custom-panel objects.
const ENVIRONMENT = ['elapsed', 'time', 'date', 'location', 'weather', 'temperature'];
const SCENE = ['sceneTopic', 'sceneMood', 'sceneInteraction', 'sceneTension', 'sceneSummary', 'soundEnvironment', 'charactersPresent', 'witnesses', 'storyThreads', 'narrativeHooks', 'trackedItems', 'worldFacts'];
const QUESTS = ['northStar', 'mainQuests', 'sideQuests'];
const WRAPPERS = { environment: ENVIRONMENT, scene: SCENE, sceneDetails: SCENE, sceneInfo: SCENE, sceneAnalysis: SCENE, questJournal: QUESTS, quests: QUESTS };

// Mutates only the supplied working object. Callers projecting saved history clone first.
export function canonicalizeTracker(data, schema, warnings = []) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
    const props = (schema?.value || schema)?.properties;
    for (const [wrapperKey, keys] of Object.entries(WRAPPERS)) {
        if (props && Object.hasOwn(props, wrapperKey)) continue;
        const wrapper = data[wrapperKey];
        if (!Object.hasOwn(data, wrapperKey)) continue;
        let moved = 0;
        if (wrapper && typeof wrapper === 'object' && !Array.isArray(wrapper)) {
            for (const key of keys) {
                const operationalRoster = key === 'charactersPresent' && (props?.characters || props?.relationships);
                if ((props && !Object.hasOwn(props, key) && !operationalRoster) || !Object.hasOwn(wrapper, key) || Object.hasOwn(data, key)) continue;
                data[key] = wrapper[key];
                moved++;
            }
        }
        delete data[wrapperKey];
        warnings.push(`root.${wrapperKey}: removed provider envelope, hoisted ${moved} field(s)`);
    }
    return data;
}

// Prompt projection is an allowlist even when validation tolerates unknown keys.
// Open leaves (custom objects without properties) retain their schema-defined contents.
export function projectSchemaFields(value, schema) {
    if (Array.isArray(value)) return value.map(item => schema?.items ? projectSchemaFields(item, schema.items) : structuredClone(item));
    if (!value || typeof value !== 'object') return value;
    if (!schema?.properties) return structuredClone(value);
    const out = {};
    for (const [key, spec] of Object.entries(schema.properties)) {
        if (Object.hasOwn(value, key)) out[key] = projectSchemaFields(value[key], spec);
    }
    return out;
}
