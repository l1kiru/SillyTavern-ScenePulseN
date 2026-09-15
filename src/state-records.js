// Evidence-backed facets of the final scene. No timers or simulated effects.
const text = description => ({ type: 'string', description });
const choice = (...values) => ({ type: 'string', enum: values });
const evidence = text('Brief narrative evidence. Never invent a source.');
const id = text('Stable id reused across turns.');
const durable = ' Preserve unchanged records. Return the COMPLETE list on change, [] to clear; omission preserves prior records. Never advance state merely because replies or time passed.';
function list(maxItems, description, properties) {
    return { type: 'array', maxItems, description, items: { type: 'object', properties, required: Object.keys(properties) } };
}

export const CHARACTER_STATE_FIELDS = {
    conditions: { toggle: 'char_conditions', schema: list(12,
        'Established injuries, fatigue, intoxication or other lasting physical conditions, separate from current posture. Record only evidenced limitations. Mark resolved only when recovery is narrated; never automatically heal or apply a penalty.' + durable,
        { id, detail: text('Established physical condition.'), status: choice('active', 'resolved'), limitation: text('Evidenced limitation; empty if unknown.'), source: evidence }) },
    emotionalState: { toggle: 'char_emotionalState', schema: list(1,
        'Zero or one emotional state at the END of THIS scene. Recompute from current evidence; [] when unknown. Qualitative dimensions, never invented numeric scores. Label interpretations explicitly. Do not carry an old reaction forward, prescribe dialogue or infer new knowledge from emotion.',
        { detail: text('Concise current feeling with uncertainty preserved.'), valence: choice('positive', 'negative', 'mixed', 'neutral', 'unknown'), activation: choice('low', 'moderate', 'high', 'unknown'), control: choice('in_control', 'overwhelmed', 'mixed', 'unknown'), basis: choice('observed', 'interpreted'), source: evidence }) },
    establishedTraits: { toggle: 'char_establishedTraits', schema: list(12,
        'Established preferences, principles, fears, habits or competencies, grounded in the character definition or explicit narrative. Never generate traits on introduction or infer a lasting personality from one ambiguous reaction. Do not duplicate appearance or current goals.' + durable,
        { id, kind: choice('preference', 'principle', 'fear', 'habit', 'skill'), detail: text('Established trait, qualified where needed.'), source: evidence }) },
};

export const SCENE_STATE_FIELDS = {
    trackedItems: { toggle: 'trackedItems', schema: list(30,
        'One shared register of relevant established objects and their current holders, including the player. ownerType=player represents {{user}} WITHOUT adding them to characters[]. owner is the NPC canonical name, the player name, or empty if none/unknown. Keep the SAME id on transfer; replace its holder, never create two copies. location is last established location, not inferred movement. quantity=null if unknown; never guess amounts or automatically consume items. This register is authoritative for tracked objects; any simple NPC inventory entry must agree. Record loss, consumption or damage only when narrated.' + durable,
        { id, name: text('Object or stack name.'), ownerType: choice('npc', 'player', 'none', 'unknown'), owner: text('Established current holder, not necessarily legal owner.'), location: text('Last established location; empty if unknown.'), quantity: { type: ['integer', 'null'], minimum: 0, description: 'Established remaining count, zero if explicitly exhausted, null if unknown.' }, condition: text('Established condition; empty if unknown.'), status: choice('held', 'stored', 'lost', 'consumed', 'destroyed'), source: evidence }) },
    worldFacts: { toggle: 'worldFacts', schema: list(30,
        'Concise persistent world facts established by narration or setting: rules, places, organizations and past events. scope identifies their applicability. A character statement or rumor is NOT objective truth: keep it in that character\'s knowledge instead. Do not duplicate items, quests, story threads, hooks or personal traits. Mark superseded only when explicitly invalidated; no invented worldbuilding.' + durable,
        { id, detail: text('Established fact.'), scope: text('Place, organization, period or other established scope; empty if unspecified.'), status: choice('active', 'superseded'), source: evidence }) },
};

export const KNOWLEDGE_PROVENANCE_FIELDS = {
    learnedFrom: text('Established informant, witness or document; empty if unknown. No automatic knowledge propagation to other NPCs.'),
    channel: choice('witnessed', 'told', 'document', 'inference', 'unknown'),
    verification: choice('unverified', 'corroborated', 'disproved'),
};
export const KNOWLEDGE_PROVENANCE_RULE = 'Optional knowledge provenance: learnedFrom identifies the established informant/document; channel is witnessed/told/document/inference/unknown; verification is unverified/corroborated/disproved, based on narrative evidence, not on the holder\'s confidence. Never propagate a fact to another NPC without an established transfer.';

// Normalize only this closed family of flat records against its own schema.
// Invalid required enums/evidence are discarded; unknown quantities stay null.
export function normalizeStateRecords(value, schema) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const result = [];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const out = {};
        let valid = true;
        for (const [key, spec] of Object.entries(schema.items.properties)) {
            const raw = entry[key];
            if (spec.enum) {
                if (!spec.enum.includes(raw)) { valid = false; break; }
                out[key] = raw;
            } else if (Array.isArray(spec.type)) {
                out[key] = Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
            } else out[key] = typeof raw === 'string' ? raw.trim() : '';
        }
        if (!valid || !out.source || !(out.detail || out.name)) continue;
        if ('id' in out) {
            if (!out.id || seen.has(out.id)) continue;
            seen.add(out.id);
        }
        if (['none', 'unknown'].includes(out.ownerType)) out.owner = '';
        result.push(out);
        if (result.length >= schema.maxItems) break;
    }
    return result;
}

export function normalizeKnowledgeProvenance(entry) {
    const out = {};
    for (const [key, spec] of Object.entries(KNOWLEDGE_PROVENANCE_FIELDS)) {
        if (!Object.hasOwn(entry, key)) continue;
        if (spec.enum) {
            if (spec.enum.includes(entry[key])) out[key] = entry[key];
        } else out[key] = typeof entry[key] === 'string' ? entry[key].trim() : '';
    }
    return out;
}
