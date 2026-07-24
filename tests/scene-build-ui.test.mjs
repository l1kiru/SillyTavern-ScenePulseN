// Scene-build UI reconcile: stub remounts after DOM wipe

const mes = { children: [], querySelector(sel){ return sel.includes('mes_buttons') ? { parentElement: this, nextSibling: null } : null; }, appendChild(n){ this.children.push(n); return n; }, insertBefore(n){ this.children.push(n); return n; } };
globalThis.document = {
    body: { dataset: {}, appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {} } },
    head: { appendChild() {} },
    addEventListener() {},
    removeEventListener() {},
    visibilityState: 'visible',
    querySelector(sel) {
        if (String(sel).includes('mesid="1"') || String(sel).includes("mesid=\"1\"")) return mes;
        if (String(sel).startsWith('.mes[mesid=')) return mes;
        return null;
    },
    querySelectorAll(sel) {
        if (sel === '.sp-scene-build') return [...(this._stubs || [])];
        if (sel === '.sp-mes-btn') return [];
        return [];
    },
    getElementById(id) {
        if (id === 'sp-scene-build-toast') return this._toast || null;
        if (String(id).startsWith('sp-scene-build-')) {
            return (this._stubs || []).find(s => s.id === id) || null;
        }
        if (id === 'sp-tb-regen') return null;
        return null;
    },
    createElement(tag) {
        const el = {
            tagName: tag, id: '', className: '', style: {}, dataset: {},
            innerHTML: '', children: [],
            setAttribute(k, v) { this[k] = v; },
            getAttribute(k) { return this[k]; },
            classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
            remove() {
                document._stubs = (document._stubs || []).filter(s => s !== el);
                if (document._toast === el) document._toast = null;
            },
            appendChild(c) { this.children.push(c); return c; },
            insertBefore(c) { this.children.push(c); return c; },
            querySelector() { return null; },
            closest() { return null; },
        };
        const origId = Object.getOwnPropertyDescriptor(el, 'id') || { value: '', writable: true };
        let _id = '';
        Object.defineProperty(el, 'id', {
            get() { return _id; },
            set(v) {
                _id = v;
                if (String(v).startsWith('sp-scene-build-') && v !== 'sp-scene-build-toast') {
                    document._stubs = document._stubs || [];
                    if (!document._stubs.includes(el)) document._stubs.push(el);
                }
                if (v === 'sp-scene-build-toast') document._toast = el;
            },
        });
        return el;
    },
    _stubs: [],
    _toast: null,
};
globalThis.window = { addEventListener() {}, innerWidth: 1280, innerHeight: 720 };
globalThis.SillyTavern = {
    getContext: () => ({
        chat: [{ is_user: true, mes: 'hi' }, { is_user: false, mes: 'hello', swipe_id: 0 }],
        groupId: null, characterId: 1, chatId: 'ui-test',
        chatMetadata: { scenepulse: { snapshots: {} } },
        extensionSettings: { scenepulse: {} },
        saveMetadata() {}, saveSettingsDebounced() {},
    }),
};
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.toastr = { error() {}, warning() {}, info() {}, success() {} };

const ctrl = await import('../src/generation/scene-build-controller.js');
const ui = await import('../src/ui/scene-build-ui.js');
const { currentChatKey } = await import('../src/message-fingerprint.js');

let pass = 0, fail = 0;
function assertTrue(name, v) {
    if (v) { pass++; console.log('  OK   ' + name); }
    else { fail++; console.log('  FAIL ' + name); }
}

console.log('\n── SceneBuild UI reconcile ──');
ctrl._resetSceneBuildRegistryForTests();
ui.initSceneBuildUi();
const op = ctrl.startSceneBuild({ messageId: 1, swipeId: 0, source: 'manual:ui', chatKey: currentChatKey() });
ctrl.updateSceneBuild(op.operationId, { status: 'generating' });
assertTrue('stub mounted', !!document.getElementById(`sp-scene-build-${op.operationId}`));
assertTrue('toast mounted', !!document.getElementById('sp-scene-build-toast'));

// Simulate ST wiping message chrome
document._stubs = [];
document._toast = null;
ui.reconcileSceneBuildUi();
assertTrue('stub restored after reconcile', !!document.getElementById(`sp-scene-build-${op.operationId}`));
assertTrue('toast restored after reconcile', !!document.getElementById('sp-scene-build-toast'));

ctrl.cancelSceneBuild(op.operationId, 'user');
assertTrue('active cleared', ctrl.getActiveSceneBuilds().length === 0);

ctrl.disposeSceneBuilds();
ui.disposeSceneBuildUi();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
