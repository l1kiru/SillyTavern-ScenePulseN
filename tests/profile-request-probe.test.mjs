import { requestWithConnectionProfile } from '../src/generation/profile-request.js';
import { runProfileTransportProbe } from '../src/generation/profile-request-probe.js';

let pass = 0, fail = 0;
function ok(name, value) {
    if (value) { pass++; console.log('  OK   ' + name); }
    else { fail++; console.log('  FAIL ' + name); }
}
function eq(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    ok(`${name} — expected ${e}, got ${a}`, a === e);
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Profile-bound request transport and probe');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

let captured = null;
const directService = {
    getSupportedProfiles() { return [{ id: 'profile-1', name: 'Soji' }]; },
    async sendRequest(...args) {
        captured = args;
        return { content: { probeId: 'direct', ok: true }, reasoning: 'hidden' };
    },
};
const direct = await requestWithConnectionProfile({
    profileId: 'soji',
    messages: [{ role: 'user', content: 'test' }],
    maxTokens: 96.9,
    jsonSchema: { name: 'test', strict: false, value: { type: 'object' } },
    promptMode: 'native',
    service: directService,
});
eq('profile name resolves to stable id', captured[0], 'profile-1');
eq('maxTokens is bounded to an integer', captured[2], 96);
ok('request is non-streaming', captured[3].stream === false);
ok('request extracts data', captured[3].extractData === true);
ok('profile preset is included', captured[3].includePreset === true);
ok('profile instruct template is included', captured[3].includeInstruct === true);
ok('native schema is forwarded through override payload', captured[4].json_schema?.strict === false);
eq('parsed structured content is returned as value', direct.value, { probeId: 'direct', ok: true });
let invalidBudget = '';
try {
    await requestWithConnectionProfile({ profileId: 'profile-1', messages: 'test', maxTokens: 0, service: directService });
} catch (error) {
    invalidBudget = error.message;
}
ok('invalid maxTokens is rejected before transport', invalidBudget.includes('positive'));

const starts = [];
const fakeService = {
    getSupportedProfiles() { return [{ id: 'profile-1', name: 'Soji' }]; },
    sendRequest(profileId, messages, maxTokens, custom, overridePayload) {
        const userPrompt = messages.find(message => message?.role === 'user')?.content || '';
        const match = userPrompt.match(/"probeId":"([^"]+)/);
        const probeId = match?.[1] || 'unknown';
        starts.push({ probeId, profileId, maxTokens, custom, overridePayload });
        const delay = probeId === 'abort-a' ? 50 : 25;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve({ content: JSON.stringify({ probeId, ok: true }) }), delay);
            custom.signal?.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error('API request failed', { cause: custom.signal.reason }));
            }, { once: true });
        });
    },
};

const probe = await runProfileTransportProbe({
    profileId: 'profile-1',
    maxTokens: 64,
    abortAfterMs: 5,
    timeoutMs: 500,
    service: fakeService,
});
ok('two native requests overlap', probe.gate.providerOverlap === true);
ok('aborting one request does not abort its sibling', probe.gate.independentAbort === true);
ok('native schema results validate', probe.gate.nativeSchema === true);
ok('JSON-only survivor validates', probe.gate.jsonMode === true);
ok('all transport GO criteria pass', probe.gate.go === true);
eq('probe sends four requests', starts.length, 4);
ok('native pair carries json_schema', starts.slice(0, 2).every(item => item.overridePayload.json_schema));
ok('JSON-only abort pair omits json_schema', starts.slice(2).every(item => !item.overridePayload.json_schema));
ok('each request receives a distinct AbortSignal', new Set(starts.map(item => item.custom.signal)).size === 4);
ok('requested maxTokens reaches every call', starts.every(item => item.maxTokens === 64));

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass}/${pass + fail}`);
if (fail) process.exit(1);
