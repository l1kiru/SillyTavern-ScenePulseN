// Scene-build UI reconcile: stub remounts after DOM wipe

const mesText = { parentElement: null, nextSibling: null };
const mes = {
    children: [],
    querySelector(sel) {
        if (String(sel).includes('mes_text')) return mesText;
        if (String(sel).includes('mes_buttons')) return { parentElement: this, nextSibling: null };
        return null;
    },
    appendChild(n) { this.children.push(n); return n; },
    insertBefore(n) { this.children.push(n); return n; },
};
mesText.parentElement = mes;
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
        if (sel === '.sp-scene-build' || String(sel).startsWith('.sp-scene-build')) {
            const stubs = [...(this._stubs || [])];
            const m = String(sel).match(/data-sp-mes="(\d+)"/);
            if (m) return stubs.filter(s => String(s.dataset?.spMes) === m[1]);
            return stubs;
        }
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
const together = ctrl.startSceneBuild({ messageId: 1, swipeId: 0, source: 'auto:together', chatKey: currentChatKey() });
ctrl.updateSceneBuild(together.operationId, { status: 'generating' });
assertTrue('together stub hidden while generating', !document.getElementById(`sp-scene-build-${together.operationId}`));
assertTrue('toast still mounts while generating', !!document.getElementById('sp-scene-build-toast'));
ctrl.updateSceneBuild(together.operationId, { status: 'parsing' });
assertTrue('together stub after reply parsed', !!document.getElementById(`sp-scene-build-${together.operationId}`));
ctrl.cancelSceneBuild(together.operationId, 'user');
document._stubs = [];
document._toast = null;

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

const failed = ctrl.startSceneBuild({ messageId: 1, swipeId: 0, source: 'manual:fail', chatKey: currentChatKey() });
ctrl.failSceneBuild(failed.operationId, new Error('Scene build returned no data'));
assertTrue('error stub shown', !!document.getElementById(`sp-scene-build-${failed.operationId}`));
const retry = ctrl.startSceneBuild({ messageId: 1, swipeId: 0, source: 'manual:retry', chatKey: currentChatKey() });
ctrl.updateSceneBuild(retry.operationId, { status: 'generating' });
assertTrue('error stub removed on retry', !document.getElementById(`sp-scene-build-${failed.operationId}`));
assertTrue('retry stub only', !!document.getElementById(`sp-scene-build-${retry.operationId}`));
eq('one stub in DOM', document.querySelectorAll('.sp-scene-build').length, 1);

ctrl.disposeSceneBuilds();
ui.disposeSceneBuildUi();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

function eq(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { pass++; console.log('  OK   ' + name); }
    else { fail++; console.log('  FAIL ' + name + ' — expected ' + e + ', got ' + a); }
}
