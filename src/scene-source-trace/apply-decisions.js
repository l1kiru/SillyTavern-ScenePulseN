import { EvidenceLevel, evidence } from './evidence.js';
import { entryKey } from './event-adapters.js';
import { WI_LOGIC } from './matcher.js';

const LOGIC_NAME = {
    [WI_LOGIC.AND_ANY]: 'AND_ANY',
    [WI_LOGIC.NOT_ALL]: 'NOT_ALL',
    [WI_LOGIC.NOT_ANY]: 'NOT_ANY',
    [WI_LOGIC.AND_ALL]: 'AND_ALL',
};

function _logicName(n) {
    return LOGIC_NAME[Number(n)] || 'AND_ANY';
}

function _ensureEntry(map, world, uid, title = '') {
    const key = entryKey(world, uid);
    if (!map.has(key)) {
        map.set(key, {
            world: world || '',
            uid: uid != null ? String(uid) : '',
            title: title || '',
            triggers: [],
            stages: {},
            selectiveEvaluation: null,
            rejection: null,
        });
    }
    return map.get(key);
}

/**
 * Apply ST scan/prompt_build decisions onto mutable maps of accepted entries + candidates.
 * @param {{ entriesByKey: Map, candidatesByKey: Map }} traceState
 * @param {object[]} decisions
 * @param {{ phase?: string }} [opts]
 */
export function applyScanDecisions(traceState, decisions, { phase = 'scan' } = {}) {
    if (!traceState || !Array.isArray(decisions)) return traceState;
    const entriesByKey = traceState.entriesByKey instanceof Map ? traceState.entriesByKey : new Map();
    const candidatesByKey = traceState.candidatesByKey instanceof Map ? traceState.candidatesByKey : new Map();

    for (const d of decisions) {
        if (!d?.entry) continue;
        const world = d.entry.world;
        const uid = d.entry.uid;
        const key = entryKey(world, uid);
        const isPromptBuild = phase === 'prompt_build' || d.phase === 'prompt_build';
        const targetMap = (d.status === 'rejected' || (!entriesByKey.has(key) && d.status !== 'accepted' && d.status !== 'suppressed'))
            ? candidatesByKey
            : (entriesByKey.has(key) ? entriesByKey : (d.status === 'accepted' || d.status === 'suppressed' ? entriesByKey : candidatesByKey));

        // Prefer accepted list when entry already accepted
        const map = entriesByKey.has(key) ? entriesByKey : targetMap;
        const rec = _ensureEntry(map, world, uid);

        if (d.selectiveLogic != null || d.selectivePassed != null) {
            rec.selectiveEvaluation = {
                logic: _logicName(d.selectiveLogic),
                passed: !!d.selectivePassed,
                evidence: EvidenceLevel.ENGINE,
            };
        }

        if (isPromptBuild && d.reason === 'content_empty_after_regex') {
            rec.stages = {
                ...(rec.stages || {}),
                rendered: { value: false, evidence: EvidenceLevel.ENGINE },
            };
            rec.rejection = { reason: 'content_empty_after_regex', evidence: EvidenceLevel.ENGINE };
            continue;
        }

        if (d.status === 'rejected') {
            rec.rejection = {
                reason: d.reason || 'rejected',
                evidence: EvidenceLevel.ENGINE,
            };
            // keep on candidates
            if (entriesByKey.has(key) && map !== candidatesByKey) {
                candidatesByKey.set(key, rec);
            } else if (!candidatesByKey.has(key)) {
                candidatesByKey.set(key, rec);
            }
        }

        if (d.primaryMatch?.matched || d.primaryMatch?.text || d.primaryMatch?.originalKey) {
            // Engine primary is sole fact — drop all inferred primary triggers
            rec.triggers = (rec.triggers || []).filter(
                t => !(t.type === 'primary_key' && t.evidence?.type === EvidenceLevel.INFERRED),
            );
            if (d.primaryMatch.matched !== false && (d.primaryMatch.text || d.primaryMatch.originalKey)) {
                const text = d.primaryMatch.text || '';
                rec.triggers = (rec.triggers || []).filter(t => t.type !== 'primary_key');
                rec.triggers.push({
                    type: 'primary_key',
                    originalKey: d.primaryMatch.originalKey || '',
                    matchedText: text,
                    matchIndex: Number.isFinite(d.primaryMatch.index) ? d.primaryMatch.index : -1,
                    groups: d.primaryMatch.groups ?? null,
                    evidence: evidence(EvidenceLevel.ENGINE, 1),
                });
                // Always single engine key — never keep buffer multi-hit list
                rec.matchedKeys = text ? [text] : (d.primaryMatch.originalKey ? [String(d.primaryMatch.originalKey)] : []);
                rec.matchKind = 'keys';
            }
        }

        for (const sm of d.secondaryMatches || []) {
            rec.triggers.push({
                type: 'secondary_key',
                originalKey: sm.originalKey || '',
                matchedText: sm.text || '',
                matchIndex: Number.isFinite(sm.index) ? sm.index : -1,
                groups: sm.groups ?? null,
                polarity: sm.polarity === 'negative' ? 'negative' : 'positive',
                evidence: evidence(EvidenceLevel.ENGINE, 1),
            });
        }
    }

    // Mark rendered true for accepted entries when any prompt_build decisions existed and no suppression
    if (phase === 'prompt_build' || decisions.some(d => d?.phase === 'prompt_build')) {
        for (const [, rec] of entriesByKey) {
            if (rec.stages?.rendered?.value === false) continue;
            if (rec.stages?.accepted?.value !== false) {
                rec.stages = {
                    ...(rec.stages || {}),
                    rendered: { value: true, evidence: EvidenceLevel.ENGINE },
                };
            }
        }
    }

    return { entriesByKey, candidatesByKey };
}
