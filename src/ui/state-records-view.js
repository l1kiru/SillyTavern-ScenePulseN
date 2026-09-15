import { esc } from '../utils.js';
import { t } from '../i18n.js';

function row(label, value) {
    if (value === '' || value == null) return '';
    return `<div class="sp-continuity-row"><span class="sp-continuity-label">${esc(label)}</span><span>${esc(String(value))}</span></div>`;
}
function group(label, toggle, records, render, toggles) {
    if (toggles[toggle] === false || !Array.isArray(records) || !records.length) return '';
    return `<details class="sp-continuity" data-ft="${toggle}"><summary>${esc(label)}</summary><div class="sp-continuity-content">${records.map(item => `<div class="sp-continuity-entry">${render(item)}${row(t('Source'), item.source)}</div>`).join('')}</div></details>`;
}
const heading = value => `<strong>${esc(value)}</strong>`;

export function renderCharacterState(character, toggles = {}) {
    const kinds = { preference: t('Preference'), principle: t('Principle'), fear: t('Fear'), habit: t('Habit'), skill: t('Skill') };
    const valence = { positive: t('Positive'), negative: t('Negative'), mixed: t('Mixed'), neutral: t('Neutral'), unknown: t('Unknown') };
    const activation = { low: t('Low'), moderate: t('Moderate'), high: t('High'), unknown: t('Unknown') };
    const control = { in_control: t('In Control'), overwhelmed: t('Overwhelmed'), mixed: t('Mixed'), unknown: t('Unknown') };
    return group(t('Physical Conditions'), 'char_conditions', character.conditions, item => heading(item.detail)
        + row(t('Status'), item.status === 'resolved' ? t('Resolved') : t('Active')) + row(t('Limitation'), item.limitation), toggles)
        + group(t('Emotional State'), 'char_emotionalState', character.emotionalState, item => heading(item.detail)
            + row(t('Emotional Tone'), valence[item.valence]) + row(t('Emotional Activation'), activation[item.activation])
            + row(t('Sense of Control'), control[item.control]) + row(t('Evidence Type'), item.basis === 'interpreted' ? t('Interpretation') : t('Observed')), toggles)
        + group(t('Established Traits'), 'char_establishedTraits', character.establishedTraits, item => heading(item.detail) + row(t('Trait Type'), kinds[item.kind]), toggles);
}

export function renderSceneState(scene, toggles = {}) {
    const statuses = { held: t('Held'), stored: t('Stored'), lost: t('Lost'), consumed: t('Consumed'), destroyed: t('Destroyed') };
    return group(t('Items and Ownership'), 'trackedItems', scene.trackedItems, item => {
        const holder = item.ownerType === 'player' ? `${t('Player')}${item.owner ? ': ' + item.owner : ''}`
            : item.ownerType === 'none' ? t('No Holder') : item.ownerType === 'unknown' ? t('Unknown') : item.owner;
        return heading(item.name) + row(t('Holder'), holder) + row(t('Location'), item.location)
            + row(t('Quantity'), item.quantity ?? t('Unknown')) + row(t('Item Condition'), item.condition) + row(t('Status'), statuses[item.status]);
    }, toggles) + group(t('World Facts'), 'worldFacts', scene.worldFacts, item => heading(item.detail)
        + row(t('Scope'), item.scope) + row(t('Status'), item.status === 'superseded' ? t('Superseded') : t('Active')), toggles);
}

export function renderKnowledgeProvenance(item, toggles = {}) {
    if (toggles.char_knowledgeProvenance === false) return '';
    const channels = { witnessed: t('Witnessed'), told: t('Told'), document: t('Document'), inference: t('Inference'), unknown: t('Unknown') };
    const verification = { unverified: t('Unverified'), corroborated: t('Corroborated'), disproved: t('Disproved') };
    const body = row(t('Learned From'), item.learnedFrom) + row(t('Information Channel'), channels[item.channel]) + row(t('Verification'), verification[item.verification]);
    return body ? `<div data-ft="char_knowledgeProvenance"><div class="sp-continuity-label">${esc(t('Knowledge Provenance'))}</div>${body}</div>` : '';
}
