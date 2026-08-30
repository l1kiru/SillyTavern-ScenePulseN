// Profile-bound full/delta fan-out. The module is transport/persistence neutral:
// it receives frozen schema/context, performs bounded lane requests, and returns
// one fully validated candidate. It never saves or paints state.

import { characterNameKey } from '../character-identity.js';
import { normalizeProviderResponse, parseTrackerCandidate } from './extraction.js';
import { buildLaneSchema, mergeOwnedLaneResults, projectLaneResult } from './lane-contract.js';
import { requestWithConnectionProfile } from './profile-request.js';
import { classifyRequestError, correctiveInstruction } from './request.js';
import { validateCharacterAudienceRequirements, validateExtraction } from './validation.js';
import { customPanelActivationKey, hasAutomaticPanels } from '../panel-activation-policy.js';
import { customPanelScope, isBuiltInCharacterFieldKey, isValidCustomFieldKey } from '../profiles.js';
import { buildRequestSchema } from '../schema.js';
import { mergeDelta } from './delta-merge.js';
import {
    buildActivatedPanelSchema,
    buildPanelStateValidationSchema,
    buildRouterSchema,
    preserveInactivePanelState,
    resolvePanelActivation,
} from './panel-activation.js';

export const PARALLEL_CORE_FIELDS = Object.freeze([
    'elapsed', 'temporalIntent', 'time', 'date', 'location', 'weather', 'temperature',
    'soundEnvironment', 'sceneTopic', 'sceneMood', 'sceneInteraction', 'sceneTension',
    'sceneSummary', 'charactersPresent', 'witnesses',
]);

const DEFAULT_BUDGETS = Object.freeze({ core: 2048, global: 4096, character1: 6144, character2: 8192 });
const DEFAULT_TIMEOUTS = Object.freeze({ core: 20000, global: 45000, characters: 60000 });
const DEFAULT_DELTA_BATCH_SIZE = 2;
const DELTA_HEAVY_SCORE = 120;
const DELTA_MANY_CHARACTERS = 4;
const DELTA_HEAVY_CHARACTER_FIELDS = 40;
const PARSE_FAILURE_CODES = new Set(['NO_JSON_OBJECT', 'TOO_SMALL', 'MALFORMED_JSON', 'TRUNCATED']);

function now() {
    return globalThis.performance?.now?.() ?? Date.now();
}

function clone(value) {
    if (value === undefined || value === null) return value;
    return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function fail(code, message, details = null) {
    const error = new Error(message);
    error.code = code;
    if (details) error.details = details;
    return error;
}

function schemaRoot(schemaWrapper) {
    const value = schemaWrapper?.value && typeof schemaWrapper.value === 'object' ? schemaWrapper.value : schemaWrapper;
    if (!value?.properties || typeof value.properties !== 'object') throw fail('PARALLEL_SCHEMA_INVALID', 'Full schema has no root properties');
    return value;
}

function cleanNames(values) {
    const names = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
        const name = String(value || '').trim();
        const key = characterNameKey(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        names.push(name);
    }
    return names;
}

export function createCoreLaneSpec(fullSchema) {
    const root = schemaRoot(fullSchema);
    const fields = [
        ...PARALLEL_CORE_FIELDS.filter(field => Object.hasOwn(root.properties, field)),
        ...['sceneTags', 'resolvedTags'].filter(field => Object.hasOwn(root.properties, field)),
    ];
    if (!fields.length) throw fail('PARALLEL_SCHEMA_INVALID', 'Full schema exposes no Core fields');
    if (Object.hasOwn(root.properties, 'characters') && !fields.includes('charactersPresent')) {
        throw fail('PARALLEL_SCHEMA_INVALID', 'Character fan-out requires charactersPresent in the Core schema');
    }
    return { id: 'core', kind: 'core', fields };
}

export function createFullLanePlan(fullSchema, coreResult, { characterBatchSize = DEFAULT_DELTA_BATCH_SIZE } = {}) {
    const root = schemaRoot(fullSchema);
    const core = createCoreLaneSpec(fullSchema);
    const coreFields = new Set(core.fields);
    const globalFields = Object.keys(root.properties).filter(field => field !== 'characters' && !coreFields.has(field));
    const roster = Object.hasOwn(root.properties, 'characters') ? cleanNames(coreResult?.charactersPresent) : [];
    const batchSize = chooseDeltaCharacterBatchSize(fullSchema, roster.length, { maxBatchSize: characterBatchSize });
    const lanes = [core];
    for (let index = 0; index < roster.length; index += batchSize) {
        lanes.push({
            id: `characters-${Math.floor(index / batchSize)}`,
            kind: 'characters',
            fields: ['characters'],
            characterNames: roster.slice(index, index + batchSize),
        });
    }
    if (globalFields.length) lanes.push({ id: 'global', kind: 'global', fields: globalFields });
    return { core, lanes, roster, hasCharacterField: Object.hasOwn(root.properties, 'characters') };
}

function enabledPanelFields(panel) {
    const scope = customPanelScope(panel);
    return (Array.isArray(panel?.fields) ? panel.fields : [])
        .filter(field => field?.enabled !== false && isValidCustomFieldKey(field?.key))
        .filter(field => scope !== 'character' || !isBuiltInCharacterFieldKey(field.key));
}

function allEnabledPanelIds(panels) {
    return (Array.isArray(panels) ? panels : [])
        .filter(panel => panel && panel.enabled !== false)
        .map(customPanelActivationKey);
}

function globalPanelFieldsForIds(panels, panelIds) {
    const selected = new Set(Array.isArray(panelIds) ? panelIds : []);
    const fields = [];
    const seen = new Set();
    for (const panel of Array.isArray(panels) ? panels : []) {
        if (!panel || panel.enabled === false || customPanelScope(panel) !== 'global') continue;
        if (!selected.has(customPanelActivationKey(panel))) continue;
        for (const field of enabledPanelFields(panel)) {
            if (seen.has(field.key)) continue;
            seen.add(field.key);
            fields.push(field.key);
        }
    }
    return fields;
}

function characterFieldCount(schemaWrapper) {
    const root = schemaRoot(schemaWrapper);
    return Object.keys(root.properties.characters?.items?.properties || {}).length;
}

export function chooseDeltaCharacterBatchSize(schemaWrapper, rosterCount, { maxBatchSize = DEFAULT_DELTA_BATCH_SIZE } = {}) {
    const count = Math.max(0, Math.floor(Number(rosterCount) || 0));
    const fields = characterFieldCount(schemaWrapper);
    const maxBatch = Math.max(1, Math.floor(Number(maxBatchSize) || DEFAULT_DELTA_BATCH_SIZE));
    if (fields >= DELTA_HEAVY_CHARACTER_FIELDS || (count >= DELTA_MANY_CHARACTERS && fields >= 24)) return 1;
    return Math.min(maxBatch, 2);
}

export function shouldUseParallelDeltaBuild({ fullSchema, previousSnapshot = null, automaticRouting = false } = {}) {
    if (automaticRouting) return true;
    if (!previousSnapshot || typeof previousSnapshot !== 'object') return false;
    const root = schemaRoot(fullSchema);
    const roster = cleanNames(
        Array.isArray(previousSnapshot.charactersPresent) && previousSnapshot.charactersPresent.length
            ? previousSnapshot.charactersPresent
            : (Array.isArray(previousSnapshot.characters) ? previousSnapshot.characters.map(character => character?.name) : []),
    );
    const charFields = characterFieldCount(fullSchema);
    const rootFields = Object.keys(root.properties).length;
    const score = roster.length * Math.max(1, charFields) + rootFields;
    return roster.length >= DELTA_MANY_CHARACTERS
        || (roster.length >= 2 && charFields >= DELTA_HEAVY_CHARACTER_FIELDS)
        || rootFields >= 35
        || score >= DELTA_HEAVY_SCORE;
}

function createDeltaLanePlan(deltaSchema, coreResult, { maxCharacterBatchSize = DEFAULT_DELTA_BATCH_SIZE } = {}) {
    const root = schemaRoot(deltaSchema);
    const core = createCoreLaneSpec(deltaSchema);
    const coreFields = new Set(core.fields);
    const globalFields = Object.keys(root.properties).filter(field => field !== 'characters' && !coreFields.has(field));
    const roster = Object.hasOwn(root.properties, 'characters') ? cleanNames(coreResult?.charactersPresent) : [];
    const batchSize = chooseDeltaCharacterBatchSize(deltaSchema, roster.length, { maxBatchSize: maxCharacterBatchSize });
    const lanes = [{ ...core, requestMode: 'delta' }];
    for (let index = 0; index < roster.length; index += batchSize) {
        lanes.push({
            id: `characters-${Math.floor(index / batchSize)}`,
            kind: 'characters',
            requestMode: 'delta',
            fields: ['characters'],
            characterNames: roster.slice(index, index + batchSize),
        });
    }
    if (globalFields.length) lanes.push({ id: 'global', kind: 'global', requestMode: 'delta', allowEmpty: true, fields: globalFields });
    return { core: lanes[0], lanes, roster, batchSize, hasCharacterField: Object.hasOwn(root.properties, 'characters') };
}

function buildParallelDeltaSchema(fullSchema, { panels = [], activePanelIds = [], newlyActivePanelIds = [] } = {}) {
    const deltaSchema = buildRequestSchema(fullSchema, { mode: 'delta', syncActiveCharacterRequirements: false });
    const root = schemaRoot(deltaSchema);
    const active = new Set(Array.isArray(activePanelIds) ? activePanelIds : []);
    const newlyActive = (Array.isArray(newlyActivePanelIds) ? newlyActivePanelIds : []).filter(id => active.has(id));
    const forceRoot = globalPanelFieldsForIds(panels, newlyActive);
    if (!Array.isArray(root.required)) root.required = [];
    for (const routerField of ['sceneTags', 'resolvedTags']) {
        if (Object.hasOwn(root.properties, routerField) && !root.required.includes(routerField)) root.required.push(routerField);
    }
    for (const field of forceRoot) {
        if (Object.hasOwn(root.properties, field) && !root.required.includes(field)) root.required.push(field);
    }
    return deltaSchema;
}

function findPreviousCharacter(previousSnapshot, name) {
    const key = characterNameKey(name);
    if (!key || !previousSnapshot) return null;
    const chars = Array.isArray(previousSnapshot.characters) ? previousSnapshot.characters : [];
    return chars.find(character => {
        if (characterNameKey(character?.name) === key) return true;
        return (Array.isArray(character?.aliases) ? character.aliases : []).some(alias => characterNameKey(alias) === key);
    }) || null;
}

function stubCharacter(name) {
    return { name: String(name || '').trim(), aliases: [] };
}

function fillMergedGapsFromPrevious(mergedValue, previousSnapshot, gaps = []) {
    if (!mergedValue || typeof mergedValue !== 'object') return { filled: [] };
    const filled = [];
    if (!Array.isArray(mergedValue.characters)) mergedValue.characters = [];
    const present = new Set(mergedValue.characters.map(character => characterNameKey(character?.name)).filter(Boolean));
    for (const gap of gaps) {
        if (gap.kind === 'characters') {
            for (const name of gap.names || []) {
                const key = characterNameKey(name);
                if (!key || present.has(key)) continue;
                const prior = findPreviousCharacter(previousSnapshot, name);
                mergedValue.characters.push(clone(prior || stubCharacter(name)));
                present.add(key);
                filled.push(name);
            }
        } else if (gap.kind === 'global') {
            for (const field of gap.fields || []) {
                if (Object.hasOwn(mergedValue, field)) continue;
                if (previousSnapshot && Object.hasOwn(previousSnapshot, field)) {
                    mergedValue[field] = clone(previousSnapshot[field]);
                    filled.push(field);
                }
            }
        }
    }
    return { filled };
}

function previousForLane(previousSnapshot, spec) {
    if (!previousSnapshot || typeof previousSnapshot !== 'object') return null;
    if (spec.kind === 'characters') {
        const allowed = new Set(spec.characterNames.map(characterNameKey));
        const characters = (Array.isArray(previousSnapshot.characters) ? previousSnapshot.characters : []).filter(character => {
            const keys = [character?.name, ...(Array.isArray(character?.aliases) ? character.aliases : [])].map(characterNameKey);
            return keys.some(key => allowed.has(key));
        });
        return { characters: clone(characters) };
    }
    const result = {};
    for (const field of spec.fields) {
        if (!Object.hasOwn(previousSnapshot, field)) continue;
        const value = previousSnapshot[field];
        if ((field === 'mainQuests' || field === 'sideQuests') && Array.isArray(value)) {
            result[field] = clone(value.filter(quest => quest?.urgency !== 'resolved'));
        } else result[field] = clone(value);
    }
    return Object.keys(result).length ? result : null;
}

function laneBudget(spec, budgets) {
    if (spec.kind === 'core') return budgets.core;
    if (spec.kind === 'global') return budgets.global;
    return spec.characterNames.length > 1 ? budgets.character2 : budgets.character1;
}

function lanePrompt({ spec, contextText, previousSnapshot, coreResult, retryInstruction = '' }) {
    const previous = previousForLane(previousSnapshot, spec);
    const frozenCore = spec.kind === 'core' ? '' : `\n\nFROZEN CORE FACTS (read-only; do not return or change them):\n${JSON.stringify(coreResult, null, 2)}`;
    const previousText = previous ? `\n\nPREVIOUS STATE FOR THIS LANE (carry forward unchanged facts):\n${JSON.stringify(previous, null, 2)}` : '';
    const isDelta = spec.requestMode === 'delta';
    const characterRule = spec.kind === 'characters'
        ? `\nGenerate exactly one characters[] entry for each of these names, preserving this batch order: ${spec.characterNames.join(', ')}.${isDelta ? ' Return the complete lane schema for each listed character so required active-panel state is refreshed; unchanged facts must remain consistent with PREVIOUS STATE.' : ''}`
        : '';
    const deltaRule = isDelta
        ? `\nDELTA LANE: this lane updates an existing committed snapshot. Required fields must be returned. Optional fields may be omitted when unchanged; never replace an unchanged value with an empty placeholder.`
        : '';
    const routerRule = spec.kind === 'core' && spec.fields.includes('sceneTags')
        ? `\nsceneTags and resolvedTags are arrays using only these canonical tags: social, combat, injury, nsfw, stealth, travel, investigation, magic, vehicle, medical. Multiple tags may coexist. Return [] when none apply. Activate current situations immediately. Put injury in resolvedTags only when the narrative explicitly establishes that the injury is resolved.`
        : '';
    return `[SCENEPULSE_LANE ${spec.id}]
RECENT SCENE CONTEXT:
${contextText}${frozenCore}${previousText}

Return exactly one JSON object containing ONLY these owned root fields: ${spec.fields.join(', ')}.${characterRule}${deltaRule}${routerRule}
Do not return markdown, commentary, wrapper objects, or fields owned by another lane.${retryInstruction ? `\n\nCORRECTION: ${retryInstruction}` : ''}`;
}

function laneSystemPrompt(systemPrompt, spec) {
    return `${systemPrompt}\n\nPARALLEL LANE OVERRIDE:\nThis request produces only lane "${spec.id}". The lane ownership and JSON schema below override any instruction to emit the complete tracker. Never invent or copy fields outside this lane.`;
}

function childSignal(parentSignal, timeoutMs, label) {
    const controller = new AbortController();
    const abortFromParent = () => {
        try { controller.abort(parentSignal.reason || new DOMException('Parent build aborted', 'AbortError')); } catch {}
    };
    if (parentSignal?.aborted) abortFromParent();
    else parentSignal?.addEventListener?.('abort', abortFromParent, { once: true });
    const timeout = setTimeout(() => {
        try { controller.abort(new DOMException(`${label} timed out after ${timeoutMs}ms`, 'TimeoutError')); } catch {}
    }, timeoutMs);
    return {
        signal: controller.signal,
        cleanup() {
            clearTimeout(timeout);
            parentSignal?.removeEventListener?.('abort', abortFromParent);
        },
    };
}

function responseText(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return { text: JSON.stringify(value), finishReason: '' };
    return normalizeProviderResponse(value);
}

function classifyLaneFailure(error) {
    const coded = typeof error?.code === 'string' ? error.code : '';
    if (coded === 'TRUNCATED') return { code: coded, status: 'truncated', retryable: true, requestInfo: null };
    if (PARSE_FAILURE_CODES.has(coded) || error?.name === 'SyntaxError') {
        return { code: coded || 'MALFORMED_JSON', status: 'parse_failed', retryable: true, requestInfo: null };
    }
    if (coded.startsWith('LANE_')) {
        return { code: 'SEMANTIC_INVALID', status: 'schema_failed', retryable: true, requestInfo: null };
    }
    if (error?.name === 'TimeoutError') {
        return { code: 'TIMEOUT', status: 'timeout', retryable: true, requestInfo: classifyRequestError(error) };
    }
    const requestInfo = classifyRequestError(error);
    return {
        code: requestInfo.kind === 'cancelled' ? 'CANCELLED' : 'REQUEST_FAILED',
        status: requestInfo.kind === 'cancelled' ? 'cancelled' : 'request_failed',
        retryable: requestInfo.retryable,
        requestInfo,
    };
}

function wait(ms, signal) {
    if (!ms) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const cleanup = () => signal?.removeEventListener?.('abort', abort);
        const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
        const abort = () => { clearTimeout(timer); cleanup(); reject(signal.reason || new DOMException('Aborted', 'AbortError')); };
        if (signal?.aborted) abort();
        else signal?.addEventListener?.('abort', abort, { once: true });
    });
}

async function executeLane({
    spec,
    fullSchema,
    systemPrompt,
    contextText,
    previousSnapshot,
    coreResult,
    profileId,
    promptMode,
    maxRetries,
    retryDelayMs,
    budgets,
    timeouts,
    signal,
    request,
    service,
    stContext,
    timing,
    characterCustomFieldSpecs = [],
}) {
    const started = now();
    const laneSchema = buildLaneSchema(fullSchema, spec);
    const responseBudget = laneBudget(spec, budgets);
    const timeoutMs = timeouts[spec.kind];
    let mode = promptMode === 'native' ? 'native' : 'json';
    let lastCode = '';
    let lastErrors = [];
    let attempts = 0;
    let lastDiagnostics = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (signal?.aborted) throw signal.reason || new DOMException('Parent build aborted', 'AbortError');
        if (attempt > 0) await wait(retryDelayMs * attempt, signal);
        attempts++;
        const prompt = lanePrompt({
            spec,
            contextText,
            previousSnapshot,
            coreResult,
            retryInstruction: attempt ? correctiveInstruction(lastCode, lastErrors) : '',
        });
        const inputTokensEstimate = Math.round((systemPrompt.length + prompt.length) / 4);
        const attemptTiming = timing?.startAttempt?.({
            laneId: spec.id,
            laneKind: spec.kind,
            laneFields: spec.fields,
            characterNames: spec.characterNames || [],
            attempt: attempt + 1,
            promptMode: mode,
            responseBudget,
            inputTokensEstimate,
        });
        const child = childSignal(signal, timeoutMs, spec.id);
        let rawText = '';
        try {
            const response = await request({
                profileId,
                messages: [
                    { role: 'system', content: laneSystemPrompt(systemPrompt, spec) },
                    { role: 'user', content: prompt },
                ],
                maxTokens: responseBudget,
                jsonSchema: laneSchema,
                promptMode: mode,
                signal: child.signal,
                service,
                stContext,
            });
            const provider = responseText(response.value);
            rawText = provider.text;
            timing?.markAttemptResponse?.(attemptTiming, { strategy: response.strategy || 'connection-profile', outputChars: rawText.length });
            if (!rawText || rawText.trim() === '{}') {
                if (spec.allowEmpty === true && (laneSchema.value.required?.length || 0) === 0 && rawText?.trim() === '{}') {
                    timing?.finishAttempt?.(attemptTiming, 'ok', {
                        laneId: spec.id,
                        outputChars: rawText.length,
                        outputTokensEstimate: Math.round(rawText.length / 4),
                        validationWarnings: 0,
                    });
                    return {
                        spec,
                        result: {},
                        warnings: [],
                        metric: {
                            id: spec.id,
                            kind: spec.kind,
                            fields: [...spec.fields],
                            characterNames: [...(spec.characterNames || [])],
                            attempts,
                            durationMs: Math.max(0, Math.round(now() - started)),
                            responseBudget,
                            droppedRootFields: 0,
                            droppedCharacterFields: 0,
                        },
                    };
                }
                lastCode = 'NO_JSON_OBJECT';
                lastErrors = ['Provider returned an empty lane result'];
                if (mode === 'native') mode = 'json';
                timing?.finishAttempt?.(attemptTiming, 'empty_response', { laneId: spec.id, failureCode: lastCode });
                continue;
            }
            const finishReason = String(provider.finishReason || '').toLowerCase();
            if (['length', 'max_tokens', 'max_output_tokens', 'token_limit'].includes(finishReason)) {
                throw fail('TRUNCATED', `Lane ${spec.id} reached its output limit`);
            }
            const parsed = parseTrackerCandidate(rawText, { mode: 'section', knownKeys: spec.fields });
            const projected = projectLaneResult(fullSchema, spec, parsed);
            lastDiagnostics = projected.diagnostics;
            const validation = validateExtraction(projected.value, { schema: laneSchema.value });
            const audienceValidation = validateCharacterAudienceRequirements(projected.value, {
                schema: laneSchema.value,
                customFieldSpecs: characterCustomFieldSpecs,
                mode: spec.requestMode === 'delta' ? 'delta' : 'full',
            });
            const semanticErrors = [...validation.errors, ...audienceValidation.errors];
            const missingCharacters = projected.diagnostics.missingCharacters || [];
            if (missingCharacters.length && attempt < maxRetries) {
                lastCode = 'SEMANTIC_INVALID';
                lastErrors = [`missing characters: ${missingCharacters.join(', ')}`];
                timing?.finishAttempt?.(attemptTiming, 'schema_failed', {
                    laneId: spec.id,
                    failureCode: lastCode,
                    validationErrors: lastErrors.slice(0, 6),
                    outputChars: rawText.length,
                    outputTokensEstimate: Math.round(rawText.length / 4),
                });
                continue;
            }
            if (!validation.valid || semanticErrors.length) {
                lastCode = 'SEMANTIC_INVALID';
                lastErrors = semanticErrors;
                timing?.finishAttempt?.(attemptTiming, 'schema_failed', {
                    laneId: spec.id,
                    failureCode: lastCode,
                    validationErrors: semanticErrors.slice(0, 6),
                    outputChars: rawText.length,
                    outputTokensEstimate: Math.round(rawText.length / 4),
                });
                continue;
            }
            timing?.finishAttempt?.(attemptTiming, 'ok', {
                laneId: spec.id,
                outputChars: rawText.length,
                outputTokensEstimate: Math.round(rawText.length / 4),
                validationWarnings: validation.warnings.length,
            });
            return {
                spec,
                result: projected.value,
                warnings: [...validation.warnings, ...audienceValidation.warnings],
                missingCharacters,
                metric: {
                    id: spec.id,
                    kind: spec.kind,
                    fields: [...spec.fields],
                    characterNames: [...(spec.characterNames || [])],
                    attempts,
                    durationMs: Math.max(0, Math.round(now() - started)),
                    responseBudget,
                    droppedRootFields: projected.diagnostics.droppedRootFields.length,
                    droppedCharacterFields: projected.diagnostics.droppedCharacterFields.length,
                },
            };
        } catch (error) {
            const failure = classifyLaneFailure(error);
            const requestInfo = failure.requestInfo;
            lastCode = failure.code;
            lastErrors = [String(error?.message || error)];
            timing?.markAttemptResponse?.(attemptTiming);
            timing?.finishAttempt?.(attemptTiming, failure.status, {
                laneId: spec.id,
                failureCode: lastCode,
                outputChars: rawText.length,
                outputTokensEstimate: Math.round(rawText.length / 4),
            });
            if (signal?.aborted) throw signal.reason || error;
            if (mode === 'native' && requestInfo?.kind === 'provider') mode = 'json';
            if (attempt >= maxRetries || failure.retryable === false) throw error;
        } finally {
            child.cleanup();
        }
    }
    throw fail('PARALLEL_LANE_FAILED', `Lane ${spec.id} exhausted ${attempts} attempt(s)`, { laneId: spec.id, lastCode, lastErrors, diagnostics: lastDiagnostics });
}

async function runBounded(tasks, concurrency, { stopOnError = null } = {}) {
    const results = new Array(tasks.length);
    let cursor = 0;
    let started = 0;
    let stopReason = null;
    async function worker() {
        while (true) {
            if (stopReason) return;
            const index = cursor++;
            if (index >= tasks.length) return;
            started++;
            try { results[index] = { status: 'fulfilled', value: await tasks[index]() }; }
            catch (reason) {
                results[index] = { status: 'rejected', reason };
                if (!stopReason && stopOnError?.(reason)) stopReason = reason;
            }
        }
    }
    const workerCount = Math.min(tasks.length, Math.max(1, Math.floor(Number(concurrency) || 1)));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return {
        settled: results.filter(Boolean),
        skipped: Math.max(0, tasks.length - started),
        stopReason,
    };
}

export async function runParallelFullBuild({
    fullSchema,
    systemPrompt,
    contextText,
    previousSnapshot = null,
    profileId,
    promptMode = 'json',
    maxRetries = 1,
    retryDelayMs = 500,
    characterBatchSize = 2,
    maxConcurrent = 2,
    budgets: budgetOverrides = {},
    timeouts: timeoutOverrides = {},
    signal = null,
    request = requestWithConnectionProfile,
    service = null,
    stContext = null,
    timing = null,
    characterCustomFieldSpecs = [],
    panels = [],
    systemPromptForActivePanels = null,
    automaticRouting = null,
} = {}) {
    if (!String(profileId || '').trim()) throw fail('PARALLEL_PROFILE_REQUIRED', 'Parallel full build requires a Connection Manager profile');
    if (typeof systemPrompt !== 'string' || typeof contextText !== 'string') throw fail('PARALLEL_CONTEXT_INVALID', 'Parallel full build requires frozen system and scene prompts');
    if (signal?.aborted) throw signal.reason || new DOMException('Parent build aborted', 'AbortError');
    const started = now();
    const budgets = { ...DEFAULT_BUDGETS, ...budgetOverrides };
    const timeouts = { ...DEFAULT_TIMEOUTS, ...timeoutOverrides };
    const boundedRetries = Math.max(0, Math.floor(Number(maxRetries) || 0));
    const concurrency = Math.max(1, Math.floor(Number(maxConcurrent) || 2));
    if (timing?.timing) timing.timing.concurrency = concurrency;

    const activationEnabled = automaticRouting == null ? hasAutomaticPanels(panels) : automaticRouting === true && hasAutomaticPanels(panels);
    if (activationEnabled) {
        timeouts.core = Math.max(timeouts.core, 45000);
        budgets.core = Math.max(budgets.core, 4096);
    }
    const routerSchema = activationEnabled ? buildRouterSchema(fullSchema) : fullSchema;
    const coreSpec = createCoreLaneSpec(routerSchema);
    const core = await executeLane({
        spec: coreSpec, fullSchema: routerSchema, systemPrompt, contextText, previousSnapshot, coreResult: null,
        profileId, promptMode, maxRetries: boundedRetries, retryDelayMs, budgets, timeouts,
        signal, request, service, stContext, timing, characterCustomFieldSpecs,
    });
    const activation = activationEnabled ? resolvePanelActivation({
        panels,
        sceneTags: core.result.sceneTags,
        resolvedTags: core.result.resolvedTags,
        previousState: previousSnapshot?._spMeta?.panelActivation || previousSnapshot?._spMeta?.parallel?.activation || null,
    }) : null;
    const runtimeSchema = activation
        ? buildActivatedPanelSchema(fullSchema, panels, activation.activePanelIds)
        : fullSchema;
    let runtimeSystemPrompt = systemPrompt;
    if (activation && typeof systemPromptForActivePanels === 'function') {
        runtimeSystemPrompt = await systemPromptForActivePanels([...activation.activePanelIds]);
        if (typeof runtimeSystemPrompt !== 'string') throw fail('PARALLEL_CONTEXT_INVALID', 'Active-panel prompt builder must return a string');
    }
    const plan = createFullLanePlan(runtimeSchema, core.result, { characterBatchSize });
    const heavySpecs = plan.lanes.filter(spec => spec.id !== 'core');
    const schedule = await runBounded(heavySpecs.map(spec => async () => {
        try {
            return await executeLane({
                spec, fullSchema: runtimeSchema, systemPrompt: runtimeSystemPrompt, contextText, previousSnapshot, coreResult: core.result,
                profileId, promptMode, maxRetries: boundedRetries, retryDelayMs, budgets, timeouts,
                signal, request, service, stContext, timing, characterCustomFieldSpecs,
            });
        } catch (error) {
            if (error && typeof error === 'object') error.laneSpec = spec;
            throw error;
        }
    }), concurrency, {
        stopOnError: error => {
            const kind = classifyRequestError(error).kind;
            return kind === 'rate_limit' || kind === 'fatal';
        },
    });
    const settled = schedule.settled;
    if (signal?.aborted) throw signal.reason || new DOMException('Parent build aborted', 'AbortError');
    const rejected = settled.filter(item => item.status === 'rejected');
    const fulfilled = settled.filter(item => item.status === 'fulfilled').map(item => item.value);
    const rejectedSpecs = rejected.map(item => item.reason?.laneSpec).filter(Boolean);
    const knownIds = new Set([
        ...fulfilled.map(item => item.spec.id),
        ...rejectedSpecs.map(spec => spec.id),
    ]);
    const skippedSpecs = heavySpecs.filter(spec => !knownIds.has(spec.id));
    const failedSpecs = [...rejectedSpecs, ...skippedSpecs];
    const canPartial = !!(previousSnapshot && typeof previousSnapshot === 'object');
    if (rejected.length && !canPartial) {
        const details = rejected.map(item => ({
            code: item.reason?.code,
            message: item.reason?.message,
            details: item.reason?.details || null,
        }));
        if (schedule.skipped) details.push({
            code: 'LANES_SKIPPED',
            message: `${schedule.skipped} queued lane(s) were not started after a fatal provider response`,
            details: null,
        });
        const skippedSuffix = schedule.skipped ? `; ${schedule.skipped} queued lane(s) skipped` : '';
        throw fail('PARALLEL_BUILD_FAILED', `${rejected.length} parallel lane(s) failed${skippedSuffix}`, details);
    }
    const mergeCoreSpec = createCoreLaneSpec(runtimeSchema);
    const mergeCoreResult = Object.fromEntries(
        mergeCoreSpec.fields.filter(field => Object.hasOwn(core.result, field)).map(field => [field, core.result[field]]),
    );
    const completed = [{ ...core, spec: mergeCoreSpec, result: mergeCoreResult }, ...fulfilled];
    const merged = mergeOwnedLaneResults(
        runtimeSchema,
        completed.map(item => ({ spec: item.spec, result: item.result })),
        { allowMissingCharacters: true },
    );
    const gaps = [];
    for (const item of fulfilled) {
        if (item.missingCharacters?.length) gaps.push({ kind: 'characters', names: item.missingCharacters });
    }
    for (const spec of failedSpecs) {
        if (spec.kind === 'characters') gaps.push({ kind: 'characters', names: spec.characterNames || [] });
        if (spec.kind === 'global') gaps.push({ kind: 'global', fields: spec.fields || [] });
    }
    const filled = fillMergedGapsFromPrevious(merged.value, previousSnapshot, gaps);
    const partial = !!(rejected.length || skippedSpecs.length || fulfilled.some(item => item.missingCharacters?.length) || filled.filled.length);
    if (plan.hasCharacterField && plan.roster.length === 0) merged.value.characters = [];
    if (activation) preserveInactivePanelState(previousSnapshot, merged.value, panels, activation.inactivePanelIds);
    const validationSchema = activation
        ? buildPanelStateValidationSchema(fullSchema, panels, activation.inactivePanelIds)
        : fullSchema;
    const finalValidation = validateExtraction(merged.value, { schema: schemaRoot(validationSchema) });
    const finalAudienceValidation = validateCharacterAudienceRequirements(merged.value, {
        schema: schemaRoot(validationSchema),
        customFieldSpecs: characterCustomFieldSpecs,
        mode: 'full',
        activePanelIds: activation?.activePanelIds || null,
    });
    const finalErrors=[...finalValidation.errors,...finalAudienceValidation.errors];
    if (finalErrors.length) {
        throw fail('PARALLEL_FINAL_INVALID', 'Merged parallel result failed the full schema', finalErrors);
    }
    finalValidation.warnings.push(...finalAudienceValidation.warnings);
    const wallMs = Math.max(0, Math.round(now() - started));
    const lanes = completed.map(item => item.metric);
    const sumLaneMs = lanes.reduce((sum, lane) => sum + lane.durationMs, 0);
    const promptTokens = timing?.timing?.attempts?.reduce((sum, attempt) => sum + (attempt.inputTokensEstimate || 0), 0) || 0;
    const completionTokens = timing?.timing?.attempts?.reduce((sum, attempt) => sum + (attempt.outputTokensEstimate || 0), 0) || 0;
    return {
        value: merged.value,
        warnings: [...completed.flatMap(item => item.warnings || []), ...finalValidation.warnings],
        meta: {
            mode: 'parallel-full',
            concurrency,
            characterBatchSize: Math.max(1, Math.floor(Number(characterBatchSize) || 2)),
            wallMs,
            sumLaneMs,
            parallelGain: wallMs > 0 ? Math.round((sumLaneMs / wallMs) * 100) / 100 : 0,
            promptTokens,
            completionTokens,
            lanes,
            partial,
            filledFromPrevious: filled.filled,
            failedLanes: failedSpecs.map(spec => ({ id: spec.id, kind: spec.kind })),
            ...(activation ? { activation } : {}),
        },
    };
}

/**
 * Parallel Delta keeps the existing Delta semantics (merge into one previous
 * committed snapshot) but partitions provider work into Core, character
 * batches, and Global lanes. It never persists partial lane state.
 */
export async function runParallelDeltaBuild({
    fullSchema,
    systemPrompt,
    contextText,
    previousSnapshot,
    profileId,
    promptMode = 'json',
    maxRetries = 1,
    retryDelayMs = 500,
    maxCharacterBatchSize = DEFAULT_DELTA_BATCH_SIZE,
    maxConcurrent = 2,
    budgets: budgetOverrides = {},
    timeouts: timeoutOverrides = {},
    signal = null,
    request = requestWithConnectionProfile,
    service = null,
    stContext = null,
    timing = null,
    characterCustomFieldSpecs = [],
    panels = [],
    systemPromptForActivePanels = null,
    automaticRouting = false,
} = {}) {
    if (!previousSnapshot || typeof previousSnapshot !== 'object') {
        throw fail('PARALLEL_DELTA_PREVIOUS_REQUIRED', 'Parallel Delta requires a previous committed snapshot');
    }
    if (!String(profileId || '').trim()) throw fail('PARALLEL_PROFILE_REQUIRED', 'Parallel Delta requires a Connection Manager profile');
    if (typeof systemPrompt !== 'string' || typeof contextText !== 'string') {
        throw fail('PARALLEL_CONTEXT_INVALID', 'Parallel Delta requires frozen system and scene prompts');
    }
    if (signal?.aborted) throw signal.reason || new DOMException('Parent build aborted', 'AbortError');

    const started = now();
    const budgets = { ...DEFAULT_BUDGETS, ...budgetOverrides };
    const timeouts = { ...DEFAULT_TIMEOUTS, ...timeoutOverrides };
    const boundedRetries = Math.max(0, Math.floor(Number(maxRetries) || 0));
    const concurrency = Math.max(1, Math.floor(Number(maxConcurrent) || 2));
    if (timing?.timing) timing.timing.concurrency = concurrency;

    const activationEnabled = automaticRouting === true && hasAutomaticPanels(panels);
    if (activationEnabled) {
        timeouts.core = Math.max(timeouts.core, 45000);
        budgets.core = Math.max(budgets.core, 4096);
    }
    const routerSchema = activationEnabled ? buildRouterSchema(fullSchema) : fullSchema;
    const initialDeltaSchema = buildParallelDeltaSchema(routerSchema, {
        panels,
        activePanelIds: activationEnabled ? [] : allEnabledPanelIds(panels),
    });
    const coreSpec = { ...createCoreLaneSpec(initialDeltaSchema), requestMode: 'delta' };
    const core = await executeLane({
        spec: coreSpec,
        fullSchema: initialDeltaSchema,
        systemPrompt,
        contextText,
        previousSnapshot,
        coreResult: null,
        profileId,
        promptMode,
        maxRetries: boundedRetries,
        retryDelayMs,
        budgets,
        timeouts,
        signal,
        request,
        service,
        stContext,
        timing,
        characterCustomFieldSpecs,
    });

    const previousActivation = previousSnapshot?._spMeta?.panelActivation
        || previousSnapshot?._spMeta?.parallel?.activation
        || null;
    const activation = activationEnabled ? resolvePanelActivation({
        panels,
        sceneTags: core.result.sceneTags,
        resolvedTags: core.result.resolvedTags,
        previousState: previousActivation,
    }) : null;
    const activePanelIds = activation ? activation.activePanelIds : allEnabledPanelIds(panels);
    const previousActive = new Set(Array.isArray(previousActivation?.activePanelIds) ? previousActivation.activePanelIds : []);
    const newlyActivePanelIds = activation
        ? activePanelIds.filter(id => !previousActive.has(id))
        : [];
    const runtimeSchema = activation
        ? buildActivatedPanelSchema(fullSchema, panels, activePanelIds)
        : fullSchema;
    const deltaSchema = buildParallelDeltaSchema(runtimeSchema, { panels, activePanelIds, newlyActivePanelIds });

    let runtimeSystemPrompt = systemPrompt;
    if (activation && typeof systemPromptForActivePanels === 'function') {
        runtimeSystemPrompt = await systemPromptForActivePanels([...activePanelIds]);
        if (typeof runtimeSystemPrompt !== 'string') {
            throw fail('PARALLEL_CONTEXT_INVALID', 'Active-panel prompt builder must return a string');
        }
    }

    const plan = createDeltaLanePlan(deltaSchema, core.result, { maxCharacterBatchSize });
    const heavySpecs = plan.lanes.filter(spec => spec.id !== 'core');
    const schedule = await runBounded(heavySpecs.map(spec => async () => {
        try {
            return await executeLane({
                spec,
                fullSchema: deltaSchema,
                systemPrompt: runtimeSystemPrompt,
                contextText,
                previousSnapshot,
                coreResult: core.result,
                profileId,
                promptMode,
                maxRetries: boundedRetries,
                retryDelayMs,
                budgets,
                timeouts,
                signal,
                request,
                service,
                stContext,
                timing,
                characterCustomFieldSpecs,
            });
        } catch (error) {
            if (error && typeof error === 'object') error.laneSpec = spec;
            throw error;
        }
    }), concurrency, {
        stopOnError: error => {
            const kind = classifyRequestError(error).kind;
            return kind === 'rate_limit' || kind === 'fatal';
        },
    });
    if (signal?.aborted) throw signal.reason || new DOMException('Parent build aborted', 'AbortError');

    const rejected = schedule.settled.filter(item => item.status === 'rejected');
    const fulfilled = schedule.settled.filter(item => item.status === 'fulfilled').map(item => item.value);
    const rejectedSpecs = rejected.map(item => item.reason?.laneSpec).filter(Boolean);
    const knownIds = new Set([
        ...fulfilled.map(item => item.spec.id),
        ...rejectedSpecs.map(spec => spec.id),
    ]);
    const skippedSpecs = heavySpecs.filter(spec => !knownIds.has(spec.id));
    const failedSpecs = [...rejectedSpecs, ...skippedSpecs];

    // Re-project Core against the final runtime Delta schema so router-only
    // sceneTags/resolvedTags never enter the stored tracker.
    const mergeCoreSpec = { ...createCoreLaneSpec(deltaSchema), requestMode: 'delta' };
    const mergeCoreResult = Object.fromEntries(
        mergeCoreSpec.fields
            .filter(field => Object.hasOwn(core.result, field))
            .map(field => [field, core.result[field]]),
    );
    const completed = [
        { ...core, spec: mergeCoreSpec, result: mergeCoreResult },
        ...fulfilled,
    ];
    const combinedDelta = mergeOwnedLaneResults(
        deltaSchema,
        completed.map(item => ({ spec: item.spec, result: item.result })),
        { allowMissingCharacters: true },
    );
    const gaps = [];
    for (const item of fulfilled) {
        if (item.missingCharacters?.length) gaps.push({ kind: 'characters', names: item.missingCharacters });
    }
    for (const spec of failedSpecs) {
        if (spec.kind === 'characters') gaps.push({ kind: 'characters', names: spec.characterNames || [] });
        if (spec.kind === 'global') gaps.push({ kind: 'global', fields: spec.fields || [] });
    }
    const filled = fillMergedGapsFromPrevious(combinedDelta.value, previousSnapshot, gaps);
    const partial = !!(rejected.length || skippedSpecs.length || fulfilled.some(item => item.missingCharacters?.length) || filled.filled.length);
    if (plan.hasCharacterField && plan.roster.length === 0) combinedDelta.value.characters = [];

    const merged = mergeDelta(previousSnapshot, combinedDelta.value);
    if (activation) preserveInactivePanelState(previousSnapshot, merged, panels, activation.inactivePanelIds);
    const validationSchema = activation
        ? buildPanelStateValidationSchema(fullSchema, panels, activation.inactivePanelIds)
        : fullSchema;
    const finalValidation = validateExtraction(merged, { schema: schemaRoot(validationSchema) });
    if (!finalValidation.valid) {
        throw fail('PARALLEL_DELTA_FINAL_INVALID', 'Merged Parallel Delta result failed the full schema', finalValidation.errors);
    }

    const wallMs = Math.max(0, Math.round(now() - started));
    const lanes = completed.map(item => item.metric);
    const sumLaneMs = lanes.reduce((sum, lane) => sum + lane.durationMs, 0);
    const promptTokens = timing?.timing?.attempts?.reduce((sum, attempt) => sum + (attempt.inputTokensEstimate || 0), 0) || 0;
    const completionTokens = timing?.timing?.attempts?.reduce((sum, attempt) => sum + (attempt.outputTokensEstimate || 0), 0) || 0;
    return {
        value: merged,
        delta: combinedDelta.value,
        warnings: [...completed.flatMap(item => item.warnings || []), ...finalValidation.warnings],
        meta: {
            mode: 'parallel-delta',
            concurrency,
            characterBatchSize: plan.batchSize,
            adaptiveCharacterBatching: true,
            wallMs,
            sumLaneMs,
            parallelGain: wallMs > 0 ? Math.round((sumLaneMs / wallMs) * 100) / 100 : 0,
            promptTokens,
            completionTokens,
            lanes,
            partial,
            filledFromPrevious: filled.filled,
            failedLanes: failedSpecs.map(spec => ({ id: spec.id, kind: spec.kind })),
            ...(activation ? { activation } : {}),
        },
    };
}
