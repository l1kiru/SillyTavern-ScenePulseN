import { renderCharacterState, renderKnowledgeProvenance } from './state-records-view.js';
import { esc } from '../utils.js';
import { t } from '../i18n.js';

function row(label, value, toggle, toggles) {
    if (!value || toggles[toggle] === false) return '';
    return `<div class="sp-continuity-row" data-ft="${toggle}"><span class="sp-continuity-label">${esc(label)}</span><span>${esc(value)}</span></div>`;
}

function group(label, body, toggle = '') {
    return body ? `<details class="sp-continuity"${toggle ? ` data-ft="${toggle}"` : ''}><summary>${esc(label)}</summary><div class="sp-continuity-content">${body}</div></details>` : '';
}

export function renderStoryThreads(threads, toggles = {}) {
    if (toggles.storyThreads === false || !Array.isArray(threads)) return '';
    const body = threads.map(thread => `<div class="sp-continuity-entry"><strong>${esc(thread.summary)}</strong><span class="sp-continuity-status">${esc(thread.status === 'resolved' ? t('Resolved') : t('Open'))}</span>${row(t('Condition'), thread.condition, 'storyThreads', toggles)}${row(t('Source'), thread.source, 'storyThreads', toggles)}</div>`).join('');
    return group(t('Story Threads'), body, 'storyThreads');
}

export function renderNarrativeHooks(hooks, toggles = {}) {
    if (toggles.narrativeHooks === false || !Array.isArray(hooks)) return '';
    const statuses = { open: t('Open'), resolved: t('Resolved'), dismissed: t('Dismissed') };
    const body = hooks.map(hook => `<div class="sp-continuity-entry"><strong>${esc(hook.detail)}</strong><span class="sp-continuity-status">${esc(statuses[hook.status] || hook.status)}</span>${row(t('Condition'), hook.condition, 'narrativeHooks', toggles)}${row(t('Source'), hook.source, 'narrativeHooks', toggles)}</div>`).join('');
    return group(t('Story Hooks'), body, 'narrativeHooks');
}

function renderActivityPlans(plans, toggles) {
    if (toggles.char_activityPlans === false || !Array.isArray(plans) || !plans.length) return '';
    const statuses = { planned: t('Planned'), active: t('In Progress'), completed: t('Completed'), cancelled: t('Cancelled') };
    return `<div data-ft="char_activityPlans"><div class="sp-continuity-label">${esc(t('Character Plans'))}</div>`
        + plans.map(plan => `<div class="sp-continuity-entry"><strong>${esc(plan.goal)}</strong><span class="sp-continuity-status">${esc(statuses[plan.status] || plan.status)}</span>${row(t('Observed Progress'), plan.progress, 'char_activityPlans', toggles)}${row(t('Location'), plan.location, 'char_activityPlans', toggles)}${row(t('Condition'), plan.condition, 'char_activityPlans', toggles)}${row(t('Source'), plan.source, 'char_activityPlans', toggles)}</div>`).join('') + '</div>';
}

export function renderCharacterContinuity(character, toggles = {}) {
    let body = row(t('Thought Basis'), character.innerThoughtBasis, 'char_innerThoughtBasis', toggles)
        + row(t('Current Intention'), character.currentIntent, 'char_currentIntent', toggles);
    if (toggles.char_knowledge !== false && Array.isArray(character.knowledge) && character.knowledge.length) {
        const kinds = { known: t('Known Information'), belief: t('Belief'), secret: t('Secret') };
        body += `<div data-ft="char_knowledge"><div class="sp-continuity-label">${esc(t('Knowledge and Beliefs'))}</div>`;
        for (const item of character.knowledge) {
            body += `<div class="sp-continuity-entry"><strong>${esc(kinds[item.kind] || item.kind)}</strong><div>${esc(item.detail)}</div>${row(t('Source'), item.source, 'char_knowledge', toggles)}${renderKnowledgeProvenance(item, toggles)}</div>`;
        }
        body += '</div>';
    }
    body += renderActivityPlans(character.activityPlans, toggles) + renderCharacterState(character, toggles);
    return group(t('Character Context'), body);
}

export function renderRelationshipContinuity(relationship, toggles = {}) {
    if (!relationship) return '';
    let body = row(t('Current Reaction'), relationship.lastReaction, 'rel_lastReaction', toggles)
        + row(t('Relationship Basis'), relationship.relationshipBasis, 'rel_relationshipBasis', toggles)
        + row(t('Reason for Change'), relationship.changeReason, 'rel_changeReason', toggles);
    if (toggles.rel_unresolvedConflicts !== false && Array.isArray(relationship.unresolvedConflicts) && relationship.unresolvedConflicts.length) {
        body += `<div data-ft="rel_unresolvedConflicts"><div class="sp-continuity-label">${esc(t('Unresolved Conflicts'))}</div><ul>${relationship.unresolvedConflicts.map(value => `<li>${esc(value)}</li>`).join('')}</ul></div>`;
    }
    return group(t('Relationship Context'), body);
}

// The dashboard keeps stored fields in the DOM for its CSS-only toggles.
// Hide a context heading only when all of its field groups are hidden.
export function syncContinuityVisibility(root) {
    for (const section of root.querySelectorAll('.sp-continuity:not([data-ft])')) {
        const fields = [...section.querySelectorAll('.sp-continuity-content > [data-ft]')];
        section.hidden = fields.length > 0 && fields.every(field => field.style.display === 'none');
    }
}
