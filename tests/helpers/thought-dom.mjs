// Minimal DOM host for extraction tests that also execute the thought-panel path.
// Main-panel layout and browser events are covered by browser smoke checks.
export function installThoughtDom() {
    const ids = new Map();
    let created = 0;
    const element = () => {
        created++;
        const classes = new Set();
        const children = new Map();
        return {
            style: { setProperty() {}, removeProperty() {} }, dataset: {}, innerHTML: '',
            classList: {
                add: (...names) => names.forEach(name => classes.add(name)),
                remove: (...names) => names.forEach(name => classes.delete(name)),
                contains: name => classes.has(name),
                toggle(name, force) { const on = force ?? !classes.has(name); on ? classes.add(name) : classes.delete(name); return on; },
            },
            addEventListener() {}, removeEventListener() {}, setAttribute() {}, remove() {},
            appendChild(child) { if (child.id) ids.set(child.id, child); },
            querySelector(selector) {
                if (!children.has(selector)) children.set(selector, element());
                return children.get(selector);
            },
            querySelectorAll: () => [],
        };
    };
    const body = element();
    body.appendChild = child => {
        if (child.id) ids.set(child.id, child);
        if (child.id === 'sp-thought-panel') ids.set('sp-tp-body', element());
    };
    globalThis.document = {
        body, createElement: element, addEventListener() {}, removeEventListener() {},
        querySelector: () => null, querySelectorAll: () => [],
        getElementById: id => ids.get(id) ?? null,
    };
    globalThis.window = { innerWidth: 1280, innerHeight: 720, addEventListener() {} };
    globalThis.requestAnimationFrame = callback => { callback(performance.now()); return 0; };
    return { ids, get created() { return created; } };
}
