import { pushPair, getPairs, _resetForTests } from '../src/raw-pairs.js';
import { SESSION_STARTED_AT } from '../src/crash-log.js';

let pass = 0;
let fail = 0;
function eq(name, actual, expected) {
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
        pass++;
        console.log('  OK   ' + name);
    } else {
        fail++;
        console.log('  FAIL ' + name + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
    }
}

console.log('\n── Debug inspector data boundaries ──');
_resetForTests();
pushPair({ prompt: 'one', response: '{}', mesIdx: 1, chatKey: 'chat-a', source: 'engine' });
pushPair({ prompt: 'two', response: '{}', mesIdx: 2, chatKey: 'chat-b', source: 'engine' });
const pairs = getPairs();
eq('prompt/response pairs retain chat ownership', pairs.map(pair => pair.chatKey), ['chat-a', 'chat-b']);
eq('crash log exposes the actual page-session boundary', Number.isFinite(SESSION_STARTED_AT), true);
eq('page-session boundary is not in the future', SESSION_STARTED_AT <= Date.now(), true);

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass}/${pass + fail}`);
if (fail) process.exit(1);
