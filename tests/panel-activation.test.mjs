import assert from 'node:assert/strict';
import {
    buildActivatedPanelSchema,
    buildPanelStateValidationSchema,
    preserveInactivePanelState,
    resolvePanelActivation,
} from '../src/generation/panel-activation.js';
import { customPanelActivationKey, isCustomPanelLive, normalizePanelActivationStrategy } from '../src/panel-activation-policy.js';

assert.equal(normalizePanelActivationStrategy(undefined), 'manual', 'missing global strategy keeps legacy manual selection');
assert.equal(normalizePanelActivationStrategy(' AUTOMATIC '), 'automatic');
assert.equal(normalizePanelActivationStrategy('invalid'), 'manual', 'unknown strategy fails closed to manual selection');

const panels = [
    {
        id: 'cp_always', name: 'Always', scope: 'global', enabled: true,
        activationMode: 'always', activationTags: [],
        fields: [{ key: 'always_state', type: 'text' }],
    },
    {
        id: 'cp_combat', name: 'Combat', scope: 'global', enabled: true,
        activationMode: 'auto', activationTags: ['combat'],
        fields: [{ key: 'combat_state', type: 'text' }],
    },
    {
        id: 'cp_injury', name: 'Injury', scope: 'character', enabled: true,
        activationMode: 'auto', activationTags: ['injury', 'medical'],
        fields: [{ key: 'injury_state', type: 'text' }],
    },
    {
        id: 'cp_social', name: 'Social', scope: 'character', enabled: true,
        activationMode: 'auto', activationTags: ['social'],
        fields: [{ key: 'social_state', type: 'text' }],
    },
    {
        id: 'cp_manual', name: 'Manual', scope: 'global', enabled: true,
        activationMode: 'manual', activationTags: ['stealth'],
        fields: [{ key: 'manual_state', type: 'text' }],
    },
    {
        id: 'cp_disabled', name: 'Disabled', scope: 'global', enabled: false,
        activationMode: 'auto', activationTags: ['nsfw'],
        fields: [{ key: 'disabled_state', type: 'text' }],
    },
];

const keys = Object.fromEntries(panels.map(panel => [panel.id, customPanelActivationKey(panel)]));

const first = resolvePanelActivation({ panels, sceneTags: ['SOCIAL', 'unknown', 'social'], resolvedTags: [] });
assert.deepEqual(first.sceneTags, ['social'], 'router tags are canonical and deduplicated');
assert.deepEqual(first.activeTags, ['social']);
assert.ok(first.activePanelIds.includes(keys.cp_always), 'legacy always panel is active');
assert.ok(first.activePanelIds.includes(keys.cp_manual), 'manual enabled panel is forced on');
assert.ok(first.activePanelIds.includes(keys.cp_social), 'matching auto panel activates immediately');
assert.ok(first.inactivePanelIds.includes(keys.cp_combat));
assert.ok(first.inactivePanelIds.includes(keys.cp_injury));
assert.ok(first.disabledPanelIds.includes(keys.cp_disabled));

const simultaneous = resolvePanelActivation({ panels, sceneTags: ['nsfw', 'combat', 'stealth'] });
assert.deepEqual(simultaneous.activeTags, ['combat', 'nsfw', 'stealth'], 'multiple canonical situations coexist in registry order');
assert.ok(simultaneous.activePanelIds.includes(keys.cp_combat), 'simultaneous tags still activate matching panels');
assert.ok(!simultaneous.activePanelIds.includes(keys.cp_disabled), 'master-disabled panel never activates even when its tag matches');

const enteredCombat = resolvePanelActivation({
    panels,
    sceneTags: ['combat', 'injury'],
    previousState: first,
});
assert.deepEqual(enteredCombat.activeTags, ['social', 'combat', 'injury'], 'new tags activate immediately while the prior tag gets one grace turn');
assert.equal(enteredCombat.graceByTag.social, 0);

const leftCombat = resolvePanelActivation({ panels, sceneTags: [], previousState: enteredCombat });
assert.ok(leftCombat.activeTags.includes('combat'), 'non-sticky tag survives one absent turn');
assert.ok(leftCombat.activeTags.includes('injury'), 'injury remains sticky while unresolved');
assert.ok(!leftCombat.activeTags.includes('social'), 'expired grace tag deactivates');

const settled = resolvePanelActivation({ panels, sceneTags: [], previousState: leftCombat });
assert.ok(!settled.activeTags.includes('combat'), 'non-sticky tag deactivates after grace');
assert.ok(settled.activeTags.includes('injury'));

const resolved = resolvePanelActivation({ panels, sceneTags: ['medical'], resolvedTags: ['injury'], previousState: settled });
assert.ok(!resolved.activeTags.includes('injury'), 'resolved sticky tag is removed even when it was previously active');
assert.ok(resolved.activeTags.includes('medical'));

const fullSchema = {
    name: 'activation-test', strict: false,
    value: {
        type: 'object', additionalProperties: false,
        properties: {
            elapsed: { type: 'string' },
            charactersPresent: { type: 'array', items: { type: 'string' } },
            always_state: { type: 'string' },
            combat_state: { type: 'string' },
            manual_state: { type: 'string' },
            characters: {
                type: 'array',
                items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                        name: { type: 'string' }, role: { type: 'string' },
                        injury_state: { type: 'string' }, social_state: { type: 'string' },
                    },
                    required: ['name', 'role', 'injury_state', 'social_state'],
                },
            },
        },
        required: ['elapsed', 'charactersPresent', 'always_state', 'combat_state', 'manual_state', 'characters'],
    },
};

const socialSchema = buildActivatedPanelSchema(fullSchema, panels, first.activePanelIds);
assert.ok(Object.hasOwn(socialSchema.value.properties, 'always_state'));
assert.ok(Object.hasOwn(socialSchema.value.properties, 'manual_state'));
assert.ok(!Object.hasOwn(socialSchema.value.properties, 'combat_state'), 'inactive global field is removed from request schema');
assert.ok(Object.hasOwn(socialSchema.value.properties.characters.items.properties, 'social_state'));
assert.ok(!Object.hasOwn(socialSchema.value.properties.characters.items.properties, 'injury_state'), 'inactive character field is removed from request schema');
assert.ok(!socialSchema.value.properties.characters.items.required.includes('injury_state'));
assert.ok(fullSchema.value.properties.combat_state, 'source schema is not mutated');

const validationSchema = buildPanelStateValidationSchema(fullSchema, panels, first.inactivePanelIds);
assert.ok(Object.hasOwn(validationSchema.value.properties, 'combat_state'), 'inactive field remains a known stored-state property');
assert.ok(!validationSchema.value.required.includes('combat_state'), 'cold-start inactive field is optional in final state validation');
assert.ok(Object.hasOwn(validationSchema.value.properties.characters.items.properties, 'injury_state'));
assert.ok(!validationSchema.value.properties.characters.items.required.includes('injury_state'));

const previous = {
    combat_state: 'Waiting encounter',
    characters: [{ name: 'Alice', aliases: ['Scout'], role: 'Ranger', injury_state: 'Bandaged', social_state: 'Old' }],
};
const current = {
    elapsed: '1m', charactersPresent: ['Scout'], always_state: 'Fresh', manual_state: 'Forced',
    characters: [{ name: 'Scout', aliases: ['Alice'], role: 'Ranger', social_state: 'New' }],
};
preserveInactivePanelState(previous, current, panels, first.inactivePanelIds);
assert.equal(current.combat_state, 'Waiting encounter', 'inactive global state is restored');
assert.equal(current.characters[0].injury_state, 'Bandaged', 'inactive character state is restored through aliases');
assert.equal(current.characters[0].social_state, 'New', 'active generated state is never overwritten');

const overwritten = {
    combat_state: 'NEW',
    characters: [{ name: 'Alice', role: 'Ranger', injury_state: 'NEW', social_state: 'New' }],
};
preserveInactivePanelState(previous, overwritten, panels, first.inactivePanelIds);
assert.equal(overwritten.combat_state, 'Waiting encounter', 'inactive Together field is frozen to previous');
assert.equal(overwritten.characters[0].injury_state, 'Bandaged', 'inactive character field is frozen to previous');
assert.equal(overwritten.characters[0].social_state, 'New', 'active field still accepts the new value');

const reactivated = resolvePanelActivation({
    panels,
    sceneTags: ['combat', 'injury'],
    previousState: resolved,
});
const reactivatedCurrent = {
    elapsed: '2m', charactersPresent: ['Alice'], always_state: 'Fresh', manual_state: 'Forced',
    combat_state: 'New encounter',
    characters: [{ name: 'Alice', aliases: ['Scout'], role: 'Ranger', injury_state: 'Reopened wound' }],
};
preserveInactivePanelState(current, reactivatedCurrent, panels, reactivated.inactivePanelIds);
assert.ok(reactivated.activePanelIds.includes(keys.cp_combat), 'deactivated combat panel can reactivate immediately');
assert.ok(reactivated.activePanelIds.includes(keys.cp_injury), 'resolved sticky panel can reactivate on a new injury signal');
assert.equal(reactivatedCurrent.combat_state, 'New encounter', 'reactivated global state is regenerated instead of restored from cold state');
assert.equal(reactivatedCurrent.characters[0].injury_state, 'Reopened wound', 'reactivated character state is regenerated instead of restored from cold state');

assert.equal(isCustomPanelLive(panels[1], { strategy: 'manual', activation: first }), true, 'manual strategy keeps auto panels visible');
assert.equal(isCustomPanelLive(panels[0], { strategy: 'automatic', activation: first }), true, 'always panel stays visible');
assert.equal(isCustomPanelLive(panels[1], { strategy: 'automatic', activation: first }), false, 'inactive auto panel is hidden from the live list');
assert.equal(isCustomPanelLive(panels[3], { strategy: 'automatic', activation: first }), true, 'active auto panel stays visible');
assert.equal(isCustomPanelLive(panels[1], { strategy: 'automatic', activation: null }), false, 'auto panel stays hidden before the first scene activation');

console.log('panel-activation.test.mjs: all tests passed');
