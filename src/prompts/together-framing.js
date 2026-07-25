// src/prompts/together-framing.js — Together-mode Compatible/Full tracker framing (v6.28.0)
//
// Supplies rule blocks and shared OUTPUT FORMAT text for inline/Together
// tracker injection. Consumed by buildInlineTrackerPrompt() in Task 2;
// this module is data-only — no side effects, safe to import anywhere.

/** @type {readonly ['compatible', 'full']} */
export const TRACKER_PROMPT_STYLES = ['compatible', 'full'];

const _COMPATIBLE_RULES = `<tracker_instructions>
You are simultaneously writing a roleplay response AND maintaining a structured scene tracker.

RULES (strict priority order):
1. First write the complete narrative response according to all other instructions in the prompt.
2. ONLY AFTER the narrative is fully finished, append the tracker block.
3. Never mix any tracker data, field names, JSON keys, or system notes into the narrative text.
4. Never mention the tracker, JSON, markers, or these instructions in the story.
5. The tracker block is invisible to the user and must not influence the story tone.
6. Never end the narrative on a handover cue or a question that expects an immediate reply right before the tracker block.

ANTI-OMNISCIENT & DELTA RULES:
- Use PREVIOUS STATE only for continuity: reuse canonical names/aliases and carry durable facts that did not change. Do not treat previous tracker values as license to invent new story facts.
- New facts, events, and meter/relationship/physical changes: only from what was explicitly shown, stated, or clearly demonstrated in THIS response.
- Do not invent or assume from character cards, world info, or unreferenced history.
- Report ONLY fields that actually changed or became newly relevant this turn — EXCEPT ScenePulse always-include fields, WHEN INCLUDING / MANDATORY FIELDS hints, and any delta always-include list in this prompt (those override omit-unchanged).
- If a category has no meaningful change — omit the field (delta) or use null/empty/[] as appropriate (full).
- Ban semantic re-skinning of the same information.
- Do not repeat, rephrase, or re-describe information that was already present in the previous tracker snapshot unless it truly changed.
- Only record relationship or physical changes that actually occurred and were fully executed in the narrative (no hovering or incomplete actions).
- Mood, tension, and relationship meters must reflect visible/behavioral evidence from this response only.
</tracker_instructions>`;

const _FULL_EXTRA_RULES = `
- Ban repeating distinctive phrases, sensory details, or character descriptions that appeared in the last 3–4 responses unless they have meaningfully changed.
- Prefer visible/behavioral scene changes over unspoken thoughts when assigning mood, tension, and relationship meters.
- When updating mood and tension, consider three axes: Valence (positive/negative), Arousal (high/low energy), Dominance (in control/helpless). Reflect the dominant combination in the values you assign.

INTERNAL REASONING (do this silently before writing the JSON):
- What actually changed in the scene this turn?
- Which characters are currently present and relevant?
- Did any relationships, quests, mood, tension, location, or environment shift?`;

const _OUTPUT_FORMAT_FOOTER = `- No explanations, no commentary, no extra text before or after the markers.
- Do not wrap the JSON in markdown code blocks.
- The tracker block does not count toward any response length limits.`;

const _FULL_JSON_EXAMPLE = '{"time":"14:30","date":"03/15/2025","location":"Town Square",...all fields...}';

/**
 * @param {unknown} value
 * @returns {'compatible' | 'full'}
 */
export function normalizeTrackerPromptStyle(value) {
    return value === 'full' ? 'full' : 'compatible';
}

/**
 * @param {'compatible' | 'full' | string} style
 * @returns {string}
 */
export function getTogetherRulesBlock(style) {
    if (style === 'full') {
        return _COMPATIBLE_RULES.replace(
            '</tracker_instructions>',
            _FULL_EXTRA_RULES + '\n</tracker_instructions>',
        );
    }
    return _COMPATIBLE_RULES;
}

/**
 * @param {{
 *   isDelta: boolean,
 *   deltaAlways: string,
 *   deltaExample: string,
 *   fieldList: string,
 * }} opts
 * @returns {string}
 */
export function getTogetherOutputFormatBlock({ isDelta, deltaAlways, deltaExample, fieldList }) {
    if (isDelta) {
        return `OUTPUT FORMAT (mandatory):
After the narrative, output EXACTLY this and nothing else:

Always include these fields: ${deltaAlways}.

<!--SP_TRACKER_START-->
${deltaExample}
<!--SP_TRACKER_END-->

${_OUTPUT_FORMAT_FOOTER}`;
    }

    return `OUTPUT FORMAT (mandatory):
After the narrative, output EXACTLY this and nothing else:

Required keys: ${fieldList}

<!--SP_TRACKER_START-->
${_FULL_JSON_EXAMPLE}
<!--SP_TRACKER_END-->

${_OUTPUT_FORMAT_FOOTER}`;
}
