// Canonical runtime policy for situational custom panels.
// This module intentionally has no settings, UI, transport, or persistence imports.

export const PANEL_ACTIVATION_MODES = Object.freeze(['always', 'auto', 'manual']);
export const PANEL_ACTIVATION_STRATEGIES = Object.freeze(['manual', 'automatic']);
export const SCENE_TAG_REGISTRY = Object.freeze([
    'social', 'combat', 'injury', 'nsfw', 'stealth',
    'travel', 'investigation', 'magic', 'vehicle', 'medical',
    'rest',
]);
export const STICKY_SCENE_TAGS = Object.freeze(['injury']);

const MODE_SET = new Set(PANEL_ACTIVATION_MODES);
const STRATEGY_SET = new Set(PANEL_ACTIVATION_STRATEGIES);
const TAG_SET = new Set(SCENE_TAG_REGISTRY);

export function normalizePanelActivationMode(panel) {
    const value = typeof panel?.activationMode === 'string'
        ? panel.activationMode.trim().toLowerCase()
        : '';
    return MODE_SET.has(value) ? value : 'always';
}

export function normalizePanelActivationStrategy(value) {
    const strategy = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return STRATEGY_SET.has(strategy) ? strategy : 'manual';
}

export function normalizeSceneTags(values) {
    const found = new Set();
    for (const value of Array.isArray(values) ? values : []) {
        const tag = typeof value === 'string' ? value.trim().toLowerCase() : '';
        if (TAG_SET.has(tag)) found.add(tag);
    }
    return SCENE_TAG_REGISTRY.filter(tag => found.has(tag));
}

export function customPanelActivationKey(panel) {
    const explicit = typeof panel?.id === 'string' ? panel.id.trim() : '';
    if (explicit) return explicit;
    const scope = panel?.scope === 'character' ? 'character' : 'global';
    const name = String(panel?.name || 'untitled').trim().toLowerCase().replace(/\s+/g, '_');
    return `legacy:${scope}:${name}`;
}

export function hasAutomaticPanels(panels) {
    return (Array.isArray(panels) ? panels : []).some(panel =>
        panel?.enabled !== false && normalizePanelActivationMode(panel) === 'auto',
    );
}

export function isCustomPanelLive(panel, {
    strategy = 'manual',
    activation = null,
} = {}) {
    if (!panel || panel.enabled === false) return false;
    if (normalizePanelActivationStrategy(strategy) !== 'automatic') return true;
    if (normalizePanelActivationMode(panel) !== 'auto') return true;
    const id = customPanelActivationKey(panel);
    return Array.isArray(activation?.activePanelIds) && activation.activePanelIds.includes(id);
}
