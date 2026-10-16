import assert from 'node:assert/strict';

let requests = 0;
const ctx = {
    groupId: 'test-group', characterId: 1, chatId: 'group-queue', name1: 'User', name2: 'Mira',
    chat: [{ is_user: true, mes: 'Continue' }, { is_user: false, mes: 'Narrative. '.repeat(300), swipe_id: 0 }],
    chatMetadata: { scenepulse: { snapshots: {} } },
    extensionSettings: { scenepulse: { enabled: true, injectionMethod: 'separate', autoGenerate: true,
        fallbackEnabled: true, maxRetries: 0, showThoughts: false } },
    saveMetadata() {}, saveSettingsDebounced() {}, saveChat: async () => {},
    generateRawData: async () => { requests++; return '{}'; },
};
globalThis.SillyTavern = { getContext: () => ctx };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.toastr = { error() {}, warning() {}, info() {}, success() {} };
const element = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false },
    querySelector: () => null, querySelectorAll: () => [], getAttribute: () => '1', setAttribute() {}, removeAttribute() {},
    appendChild() {}, addEventListener() {} });
globalThis.document = { createElement: element, body: element(), addEventListener() {},
    querySelector: selector => selector.startsWith('.mes[mesid=') ? element() : null,
    querySelectorAll: () => [], getElementById: () => null };
globalThis.window = { addEventListener() {}, innerWidth: 1280, innerHeight: 720 };
globalThis.getComputedStyle = () => ({ display: 'none', visibility: 'hidden' });

const state = await import('../src/state.js');
const ctrl = await import('../src/generation/scene-build-controller.js');
const { currentChatKey } = await import('../src/message-fingerprint.js');
const { onCharMsg } = await import('../src/ui/message.js');

ctx.chat.push({is_user:false,name:'Alex',mes:'Second reply.',swipe_id:0});
let releaseFirst, entered;
const dispatched = new Promise(resolve => { entered = resolve; });
ctx.generateRawData = async () => {
 requests++;
 if(requests===1){entered();await new Promise(resolve=>{releaseFirst=resolve;});}
 return '{}';
};
const first = onCharMsg(1);
await dispatched;
const second = onCharMsg(2);
await new Promise(resolve=>setTimeout(resolve,4500));
releaseFirst();
await Promise.all([first,second]);
assert.equal(requests,2,'both group replies must be analysed when first request is slow');
let startNext;
const nextDispatched=new Promise(resolve=>{startNext=resolve;});
ctx.generateRawData=async()=>{requests++;startNext();await new Promise(resolve=>{releaseFirst=resolve;});return '{}';};
const next=onCharMsg(1);
await nextDispatched;
const stale=onCharMsg(2);
ctx.chatId='another-chat';
releaseFirst();
await Promise.all([next,stale]);
assert.equal(requests,3,'queued reply must not dispatch after switching chats');
ctrl._resetSceneBuildRegistryForTests();
console.log('group-auto-build: passed');
