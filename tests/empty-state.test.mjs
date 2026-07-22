import assert from 'node:assert/strict';

class FakeElement {
    constructor(tag = 'div') {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.dataset = {};
        this.listeners = {};
        this.className = '';
        this.textContent = '';
    }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    click() { return this.listeners.click?.(); }
}

const nodes = new Map();
globalThis.document = {
    createElement: tag => new FakeElement(tag),
    getElementById: id => nodes.get(id) || null,
};

const body = new FakeElement();
nodes.set('sp-panel-body', body);
for (const id of ['sp-tb-regen', 'sp-tb-panels', 'sp-tb-wiki']) {
    const button = new FakeElement('button');
    button.clicks = 0;
    button.addEventListener('click', () => { button.clicks++; });
    nodes.set(id, button);
}

const { renderEmptyState } = await import('../src/ui/empty-state.js');
const state = renderEmptyState();
assert.equal(body.children[0], state);

const actions = state.children.find(child => child.className === 'sp-empty-actions');
assert.ok(actions, 'empty state exposes its actions');
assert.deepEqual(actions.children.map(button => button.dataset.action), [
    'regenerate', 'debug', 'analytics', 'panels', 'wiki',
]);

actions.children.find(button => button.dataset.action === 'regenerate').click();
actions.children.find(button => button.dataset.action === 'panels').click();
actions.children.find(button => button.dataset.action === 'wiki').click();
assert.equal(nodes.get('sp-tb-regen').clicks, 1);
assert.equal(nodes.get('sp-tb-panels').clicks, 1);
assert.equal(nodes.get('sp-tb-wiki').clicks, 1);

let customRegenerations = 0;
const stale = renderEmptyState({ onRegenerate: () => { customRegenerations++; } });
stale.children.find(child => child.className === 'sp-empty-actions')
    .children.find(button => button.dataset.action === 'regenerate').click();
assert.equal(customRegenerations, 1, 'stale state keeps its targeted regeneration handler');

console.log('empty-state.test.mjs: all tests passed');
