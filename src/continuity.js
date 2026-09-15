// Descriptive continuity shared by the tracker schema, prompts and snapshots.
// This module never generates, grades, or rewrites narrative responses.

import { CHARACTER_STATE_FIELDS, SCENE_STATE_FIELDS, KNOWLEDGE_PROVENANCE_FIELDS, KNOWLEDGE_PROVENANCE_RULE, normalizeStateRecords, normalizeKnowledgeProvenance } from './state-records.js';

const text = description => ({ type: 'string', description });

export const CHARACTER_CONTINUITY_FIELDS = {
    ...CHARACTER_STATE_FIELDS,
    activityPlans: { toggle: 'char_activityPlans', schema: {
        type: 'array', maxItems: 6, description: 'Up to 6 explicitly established personal plans or ongoing activities of this NPC. Keep stable ids. Record goal, observed progress, established location and time/condition; leave unknown details empty. planned = stated but not begun, active = observed underway, completed/cancelled = explicitly established outcome. Do not assign routine tasks on introduction or departure, invent steps, advance off-screen work per turn, or apply healing, inventory, relationship or quest effects. Return the COMPLETE list on change, [] to clear; omission preserves prior records. Do not duplicate currentIntent or a quest unless this records distinct established progress. Plans are descriptive, never instructions for the next reply.',
        items: { type: 'object', properties: {
            id: text('Stable plan id reused across turns.'),
            goal: text('Explicitly established intended activity or objective.'),
            status: { type: 'string', enum: ['planned', 'active', 'completed', 'cancelled'] },
            progress: text('Last observed progress only; empty if none is established.'),
            location: text('Established place of the activity, not an inferred current NPC location; empty if unknown.'),
            condition: text('Stated time or prerequisite; preserve uncertainty, never invent a deadline.'),
            source: text('Brief narrative evidence establishing or changing the plan. Required, not speculation.'),
        }, required: ['id', 'goal', 'status', 'progress', 'location', 'condition', 'source'] },
    } },
    innerThoughtBasis: { toggle: 'char_innerThoughtBasis', schema: text('Basis for this turn\'s innerThought: cite explicit narration, or label it as an interpretation of observed behavior. Empty when no basis exists. An inferred thought is not evidence of facts, secrets, or completed actions.') },
    currentIntent: { toggle: 'char_currentIntent', schema: text('Intention still held at the END of this scene, grounded in words or actions; qualify an inference. A plan is not a completed action or an instruction for the next reply. Recompute this turn; empty if unknown or already fulfilled.') },
    knowledge: { toggle: 'char_knowledge', schema: {
        type: 'array', description: 'Up to 12 relevant established knowledge records for this NPC. known = information they acquired (not necessarily objective truth); belief = explicitly established uncertain or mistaken belief; secret = information they are established to conceal. source records how they learned or expressed it (witness, conversation, document). Never grant knowledge just because the model, player, or another NPC knows it. Do not invent secrets. Preserve unchanged records; return the complete list on change, [] to clear.',
        items: { type: 'object', properties: {
            kind: { type: 'string', enum: ['known', 'belief', 'secret'] },
            detail: text('The information or belief, with uncertainty preserved.'),
            source: text('Established source of this NPC\'s knowledge or belief.'),
            ...KNOWLEDGE_PROVENANCE_FIELDS,
        }, required: ['kind', 'detail', 'source'] },
    } },
};

export const RELATIONSHIP_CONTINUITY_FIELDS = {
    lastReaction: { toggle: 'rel_lastReaction', schema: text('This turn\'s observed emotional reaction, distinct from the enduring relationship. Empty when no reaction is evidenced this turn; never copy a prior reaction as new.') },
    relationshipBasis: { toggle: 'rel_relationshipBasis', schema: text('Concise established basis of the enduring relationship: accumulated trust, affection, friction, or shared history. Carry forward unchanged unless the narrative changes it. Not a behavioral prescription.') },
    changeReason: { toggle: 'rel_changeReason', schema: text('Concrete event in THIS scene explaining any meter change; name affected meters and why. Empty when meters did not change. Do not invent an event to justify a score.') },
    unresolvedConflicts: { toggle: 'rel_unresolvedConflicts', schema: {
        type: 'array', items: { type: 'string' }, description: 'Up to 6 established unresolved interpersonal conflicts. A pleasant interaction alone does not prove resolution. Remove a conflict when the narrative resolves or invalidates it; return the complete list on change, [] to clear. Do not invent resentment.',
    } },
};

export const STORY_THREADS_SCHEMA = {
    type: 'array', description: 'Up to 20 concise established promises, appointments, loose ends or unresolved plot threads without a dedicated quest/knowledge/conflict slot. Reuse stable ids; preserve open entries unchanged. Return the COMPLETE list if anything changes (including in delta mode), [] to clear. Mark resolved only when the narrative resolves or invalidates the thread; resolved entries are shown for one snapshot. Do not create events, schedules, instructions or speculative future developments.',
    items: { type: 'object', properties: {
        id: text('Stable thread id reused across turns.'),
        summary: text('Established promise, appointment or unresolved event.'),
        status: { type: 'string', enum: ['open', 'resolved'] },
        condition: text('Established time or condition attached to this thread; empty if none. Not a command to cause the event.'),
        source: text('Brief evidence from the narrative that established or updated this thread.'),
    }, required: ['id', 'summary', 'status', 'condition', 'source'] },
};

export const NARRATIVE_HOOKS_SCHEMA = {
    type: 'array', maxItems: 20, description: 'Up to 20 established significant objects, clues, statements or unexplained events whose relevance remains unresolved. Record evidence, not invented foreshadowing or hidden truth. Keep stable ids. Do not duplicate promises/appointments in storyThreads, quests, or NPC knowledge records. Preserve who knows a fact in their knowledge, never infer universal awareness from this scene-level register. open = unresolved, resolved = narrative supplied an outcome, dismissed = explicitly disproved or no longer applicable. Keep an open hook unchanged without new evidence; do not age, randomly activate, expire or force a payoff. A condition is an established prerequisite, not a command to reveal a secret or cause an event. Return the COMPLETE list on change, [] to clear; omission preserves prior records.',
    items: { type: 'object', properties: {
        id: text('Stable hook id reused across turns.'),
        detail: text('The established significant detail, preserving uncertainty and attribution.'),
        status: { type: 'string', enum: ['open', 'resolved', 'dismissed'] },
        condition: text('Explicitly established relevance condition; empty if none.'),
        source: text('Brief narrative evidence establishing, resolving or dismissing this detail. Required.'),
    }, required: ['id', 'detail', 'status', 'condition', 'source'] },
};

export const CONTINUITY_RULES = `## DESCRIPTIVE CONTINUITY — tracker extraction only
Record the final state AFTER the narrative. The narrative is authoritative even when it differs from earlier intentions, expectations, or relationship estimates. Never rewrite, reject, continue, or regenerate the narrative to make it match tracker state. Do not prescribe dialogue, tone, actions, or the next outcome.
Needs and goals describe the character; intentions remain unexecuted until shown. Inner thoughts inferred from behavior are interpretations, not new evidence or knowledge. Do not turn old inferred thoughts into established facts.
Relationship meters describe observed development. Distinguish a passing reaction from an enduring change: a minor interaction alone usually supports only a small adjustment, while a major established event may support a large one. Do not force changes each turn, clamp real developments to an arbitrary rate, or infer that an unresolved conflict vanished without evidence.
Keep established durable information across turns; do not advance off-screen activities, invent new knowledge, or mark future events completed because time or replies passed. Empty values are valid when evidence is absent.`;

export const CONTINUITY_CONTEXT_NOTE = 'Descriptive state at the end of the previous scene, provided for continuity only. Intentions and open threads are not completed events or instructions for the next response. Inferred thoughts are interpretations, not facts; NPC knowledge is scoped to its recorded holder and source. The next narrative may develop differently.';

export function continuityFieldSpecs(fields, toggles = {}) {
    return Object.entries(fields)
        .filter(([, field]) => toggles[field.toggle] !== false)
        .map(([key, { schema }]) => {
            const keys = Object.keys(schema.items?.properties || {}).filter(field => key !== 'knowledge' || toggles.char_knowledgeProvenance !== false || !Object.hasOwn(KNOWLEDGE_PROVENANCE_FIELDS, field));
            return `- ${key}: ${schema.description}${keys.length ? ` Each entry: ${keys.map(field => schema.items.properties[field].enum ? `${field} (${schema.items.properties[field].enum.join('/')})` : field).join(', ')}.` : ''}${key === 'knowledge' && toggles.char_knowledgeProvenance !== false ? ' ' + KNOWLEDGE_PROVENANCE_RULE : ''}`;
        });
}

const cleanText = value => typeof value === 'string' ? value.trim() : '';
const records = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];

export function normalizeKnowledge(value) {
    return records(value).filter(item => ['known', 'belief', 'secret'].includes(item.kind) && cleanText(item.detail) && cleanText(item.source))
        .map(item => ({ kind: item.kind, detail: cleanText(item.detail), source: cleanText(item.source), ...normalizeKnowledgeProvenance(item) }));
}

export function normalizeActivityPlans(value) {
    const seen = new Set();
    return records(value).filter(item => {
        const id = cleanText(item.id);
        if (!id || seen.has(id) || !cleanText(item.goal) || !cleanText(item.source)
            || !['planned', 'active', 'completed', 'cancelled'].includes(item.status)) return false;
        seen.add(id);
        return true;
    }).slice(0, 6).map(item => ({ id: cleanText(item.id), goal: cleanText(item.goal), status: item.status,
        progress: cleanText(item.progress), location: cleanText(item.location),
        condition: cleanText(item.condition), source: cleanText(item.source) }));
}

export function normalizeNarrativeHooks(value) {
    const seen = new Set();
    return records(value).filter(item => {
        const id = cleanText(item.id);
        if (!id || seen.has(id) || !cleanText(item.detail) || !cleanText(item.source)
            || !['open', 'resolved', 'dismissed'].includes(item.status)) return false;
        seen.add(id);
        return true;
    }).slice(0, 20).map(item => ({ id: cleanText(item.id), detail: cleanText(item.detail), status: item.status,
        condition: cleanText(item.condition), source: cleanText(item.source) }));
}

export function normalizeStoryThreads(value) {
    const seen = new Set();
    return records(value).filter(item => {
        const id = cleanText(item.id);
        if (!id || seen.has(id) || !cleanText(item.summary) || !['open', 'resolved'].includes(item.status)) return false;
        seen.add(id);
        return true;
    }).map(item => ({ id: cleanText(item.id), summary: cleanText(item.summary), status: item.status, condition: cleanText(item.condition), source: cleanText(item.source) }));
}

// Preserve absence for older snapshots and disabled fields. In particular,
// missing arrays mean unchanged; an explicit [] means deliberately cleared.
export function normalizeCharacterContinuity(from, to) {
    for (const [key, { schema }] of Object.entries(CHARACTER_STATE_FIELDS)) if (Object.hasOwn(from, key)) to[key] = normalizeStateRecords(from[key], schema);
    for (const key of ['innerThoughtBasis', 'currentIntent']) if (Object.hasOwn(from, key)) to[key] = cleanText(from[key]);
    if (Object.hasOwn(from, 'knowledge')) to.knowledge = normalizeKnowledge(from.knowledge);
    if (Object.hasOwn(from, 'activityPlans')) to.activityPlans = normalizeActivityPlans(from.activityPlans);
}

export function normalizeRelationshipContinuity(from, to) {
    for (const key of ['lastReaction', 'relationshipBasis', 'changeReason']) if (Object.hasOwn(from, key)) to[key] = cleanText(from[key]);
    if (Object.hasOwn(from, 'unresolvedConflicts')) to.unresolvedConflicts = Array.isArray(from.unresolvedConflicts)
        ? from.unresolvedConflicts.map(cleanText).filter(Boolean) : [];
}

export function carryContinuityFields(current, previous, keys) {
    for (const key of keys) if (!Object.hasOwn(current, key) && Object.hasOwn(previous, key)) current[key] = structuredClone(previous[key]);
}

// A prompt projection, never a mutation of stored history. Keep off-scene
// knowledge/goals as last-known data, without simulating their advancement.
export function prepareSnapshotContext(snapshot, schema) {
    if (!snapshot) return null;
    const out = structuredClone(snapshot);
    const props = schema?.value?.properties || schema?.properties || {};
    for (const key of ['mainQuests', 'sideQuests']) if (Array.isArray(out[key])) out[key] = out[key].filter(item => item.urgency !== 'resolved');
    delete out.activeTasks;
    delete out._spMeta;
    for (const key of Object.keys(SCENE_STATE_FIELDS)) if (!props[key]) delete out[key];
    if (Array.isArray(out.worldFacts)) out.worldFacts = out.worldFacts.filter(item => item.status === 'active');
    if (!props.plotBranches) delete out.plotBranches;
    if (!props.storyThreads) delete out.storyThreads;
    else if (Array.isArray(out.storyThreads)) out.storyThreads = out.storyThreads.filter(item => item.status !== 'resolved');
    if (!props.narrativeHooks) delete out.narrativeHooks;
    else if (Array.isArray(out.narrativeHooks)) out.narrativeHooks = out.narrativeHooks.filter(item => item.status === 'open');
    for (const [array, fields] of [['characters', CHARACTER_CONTINUITY_FIELDS], ['relationships', RELATIONSHIP_CONTINUITY_FIELDS]]) {
        for (const entry of out[array] || []) for (const key of Object.keys(fields)) {
            if (!props[array]?.items?.properties?.[key]) delete entry[key];
        }
    }
    for (const character of out.characters || []) {
        for (const item of character.knowledge || []) for (const key of Object.keys(KNOWLEDGE_PROVENANCE_FIELDS)) {
            if (!props.characters?.items?.properties?.knowledge?.items?.properties?.[key]) delete item[key];
        }
        if (Array.isArray(character.conditions)) character.conditions = character.conditions.filter(item => item.status === 'active');
    }
    for (const character of out.characters || []) if (Array.isArray(character.activityPlans)) {
        character.activityPlans = character.activityPlans.filter(item => ['planned', 'active'].includes(item.status));
    }
    if (Array.isArray(out.charactersPresent)) {
        const present = new Set(out.charactersPresent.map(name => String(name).trim().toLowerCase()));
        const isPresent = entry => present.has(String(entry.name).trim().toLowerCase());
        if (Array.isArray(out.characters)) {
            out._offSceneCharacters = out.characters.filter(entry => !isPresent(entry)).map(entry => {
                const stub = { name: entry.name, role: entry.role || '', aliases: entry.aliases || [] };
                for (const key of ['shortTermGoal', 'longTermGoal', 'knowledge', 'activityPlans', 'conditions', 'establishedTraits']) if (props.characters?.items?.properties?.[key] && Object.hasOwn(entry, key)) stub[key] = entry[key];
                return stub;
            });
            out.characters = out.characters.filter(isPresent);
            if (!out._offSceneCharacters.length) delete out._offSceneCharacters;
        }
        if (Array.isArray(out.relationships)) {
            out._offSceneRelationships = out.relationships.filter(entry => !isPresent(entry)).map(entry => {
                const stub = { name: entry.name };
                for (const key of ['relationshipBasis', 'unresolvedConflicts']) if (Object.hasOwn(entry, key)) stub[key] = entry[key];
                return stub;
            }).filter(entry => Object.keys(entry).length > 1);
            out.relationships = out.relationships.filter(isPresent);
            if (!out._offSceneRelationships.length) delete out._offSceneRelationships;
        }
    }
    return out;
}
