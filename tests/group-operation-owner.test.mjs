import assert from 'node:assert/strict';
import { currentChatKey, captureOperationOwner, validateOperationOwner } from '../src/message-fingerprint.js';

const ctx = { groupId: 'group-a', chatId: 'chat-a', characterId: 3, name2: 'Mira',
    chat: [{ name: 'Mira', mes: 'A map.', swipe_id: 0 }] };
globalThis.SillyTavern = { getContext: () => ctx };
const owner = captureOperationOwner(0, 0);
for (const speaker of [4, undefined]) {
    ctx.characterId = speaker; ctx.name2 = speaker ? 'Alex' : '';
    assert.equal(currentChatKey(), owner.chatKey, 'speaker changes must retain group ownership');
    assert.equal(validateOperationOwner(owner, { requireSource: true }).valid, true);
}
ctx.groupId = 'group-b';
assert.equal(validateOperationOwner(owner).code, 'CHAT_CHANGED');
ctx.groupId = 'group-a'; ctx.chatId = 'branch';
assert.equal(validateOperationOwner(owner).code, 'CHAT_CHANGED');
ctx.chatId = 'chat-a'; ctx.chat[0].mes = 'Edited map.';
assert.equal(validateOperationOwner(owner, { requireSource: true }).code, 'SOURCE_CHANGED');
ctx.groupId = null; ctx.characterId = 3;
const solo = currentChatKey(); ctx.characterId = 4;
assert.notEqual(currentChatKey(), solo, 'solo characters remain isolated');
console.log('group-operation-owner: passed');
