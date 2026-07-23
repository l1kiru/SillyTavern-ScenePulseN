const { canGenerateScene, getLastAssistantMessageIndex, hasSelectedChat } = await import('../src/settings.js');

let pass = 0, fail = 0;
function eq(name, actual, expected) {
    if (actual === expected) {
        pass++;
        console.log('  OK   ' + name);
    } else {
        fail++;
        console.log('  FAIL ' + name + ' — expected ' + expected + ', got ' + actual);
    }
}

console.log('\n── No-chat generation guard ──');

const selectedChat = {
    chatId: 'chat-1',
    chat: [
        { is_user: true, mes: 'Hello' },
        { is_user: false, mes: 'Hi there' },
    ],
};

eq('selected chat is detected', hasSelectedChat(selectedChat), true);
eq('last assistant message is found', getLastAssistantMessageIndex(selectedChat), 1);
eq('normal selected conversation can generate', canGenerateScene(selectedChat), true);

const noSelectedChat = {
    chat: selectedChat.chat,
};
eq('chat-shaped state without chat id is not selected', hasSelectedChat(noSelectedChat), false);
eq('no selected chat cannot generate', canGenerateScene(noSelectedChat), false);

const greetingOnly = {
    chatId: 'chat-2',
    chat: [{ is_user: false, mes: 'Greeting' }],
};
eq('greeting-only selected chat can generate', canGenerateScene(greetingOnly), true);

const userOnly = {
    chatId: 'chat-3',
    chat: [{ is_user: true, mes: 'Hello' }],
};
eq('user-only chat has no assistant target', getLastAssistantMessageIndex(userOnly), -1);
eq('user-only chat cannot generate', canGenerateScene(userOnly), false);

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass}/${pass + fail}`);
if (fail) process.exit(1);
