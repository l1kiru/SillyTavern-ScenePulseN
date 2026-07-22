// Empty panel state. Keep state-independent tools reachable even when there
// is no current scene snapshot.
import { t } from '../i18n.js';

function addAction(container, action, label, handler, primary = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sp-empty-action' + (primary ? ' sp-empty-action-primary' : '');
    button.dataset.action = action;
    button.textContent = t(label);
    button.addEventListener('click', handler);
    container.appendChild(button);
}

export function renderEmptyState({
    icon = '📡',
    title = t('No scene data yet'),
    message = t('Send a message or click ⟳ to generate.'),
    className = '',
    onRegenerate = null,
} = {}) {
    const body = document.getElementById('sp-panel-body');
    if (!body) return null;

    const state = document.createElement('div');
    state.className = 'sp-empty-state' + (className ? ` ${className}` : '');

    const iconEl = document.createElement('div');
    iconEl.className = 'sp-empty-icon';
    iconEl.textContent = icon;
    state.appendChild(iconEl);

    const titleEl = document.createElement('div');
    titleEl.className = 'sp-empty-title';
    titleEl.textContent = title;
    state.appendChild(titleEl);

    const messageEl = document.createElement('div');
    messageEl.className = 'sp-empty-sub';
    messageEl.textContent = message;
    state.appendChild(messageEl);

    const actions = document.createElement('div');
    actions.className = 'sp-empty-actions';
    addAction(actions, 'regenerate', 'Regenerate', () => {
        if (onRegenerate) return onRegenerate();
        document.getElementById('sp-tb-regen')?.click();
    }, true);
    addAction(actions, 'debug', 'Debug Inspector', () => {
        import('./debug-inspector.js').then(module => module.openDebugInspector()).catch(() => {});
    });
    addAction(actions, 'analytics', 'Analytics', () => {
        import('./analytics.js').then(module => module.openAnalytics()).catch(() => {});
    });
    addAction(actions, 'panels', 'Panel Manager', () => {
        document.getElementById('sp-tb-panels')?.click();
    });
    addAction(actions, 'wiki', 'Character Wiki', () => {
        document.getElementById('sp-tb-wiki')?.click();
    });
    state.appendChild(actions);

    body.replaceChildren(state);
    return state;
}
