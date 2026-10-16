import assert from 'node:assert/strict';
const schema = { type: 'object', properties: { location: { type: 'string' }, elapsed: { type: 'string' } }, required: ['location', 'elapsed'] };
let reply = '{}';
const ctx = { extensionSettings: { scenepulse: { schema: JSON.stringify(schema), systemPrompt: 'Return a scene.' } },
    chat: [], chatMetadata: {}, saveSettingsDebounced() {}, generateRaw: async () => reply };
globalThis.SillyTavern = { getContext: () => ctx };
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { runSingleDoctorCheck, runDoctor } = await import('../src/doctor.js');
const { getActiveSchema } = await import('../src/settings.js');
assert.deepEqual(getActiveSchema().value.required, schema.required);
for (const invalid of [{ unrelated: true }, { location: 9, elapsed: '0m' }, { location: 'Room' }]) {
    reply = JSON.stringify(invalid);
    assert.equal((await runSingleDoctorCheck('schema')).status, 'fail', 'parseable invalid tracker must fail');
}
reply = JSON.stringify({ location: 'Room', elapsed: '0m' });
assert.equal((await runSingleDoctorCheck('schema')).status, 'pass');

let payload, deleted, readFails = false, deleteFails = false;
globalThis.fetch = async (url, opts = {}) => {
    if (url.endsWith('/upload')) { payload = JSON.parse(opts.body); return { ok: true }; }
    if (url.endsWith('/delete')) {
        deleted = JSON.parse(opts.body);
        assert.equal(deleted.path, 'user/files/' + payload.name);
        assert.equal(opts.signal?.aborted, undefined, 'cleanup must survive cancellation');
        return { ok: !deleteFails, status: deleteFails ? 500 : 200 };
    }
    assert.equal(url, '/user/files/' + payload.name);
    return { ok: !readFails, status: readFails ? 503 : 200, json: async () => JSON.parse(Buffer.from(payload.data, 'base64').toString()) };
};
assert.equal((await runSingleDoctorCheck('storage')).status, 'pass');
const firstName = payload.name;
assert.equal((await runSingleDoctorCheck('storage')).status, 'pass');
assert.notEqual(payload.name, firstName, 'concurrent diagnostics must not share a file');
deleted = null; readFails = true;
assert.equal((await runSingleDoctorCheck('storage')).status, 'fail');
assert.ok(deleted, 'read failure must still clean up');
readFails = false; deleteFails = true;
assert.match((await runSingleDoctorCheck('storage')).summary, /Delete HTTP 500/);
deleteFails = false;
const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
assert.equal((await runSingleDoctorCheck('storage')).status, 'pass', 'HTTP LAN contexts need no randomUUID API');
Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
const abort = new AbortController();
deleted = null;
const normalFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
    if (url.endsWith('/upload')) {
        assert.equal(opts.signal, undefined, 'small upload must settle before cleanup');
        const result = await normalFetch(url, opts); abort.abort(); return result;
    }
    if (!url.endsWith('/delete')) opts.signal?.throwIfAborted();
    return normalFetch(url, opts);
};
const cancelled = await runDoctor({ signal: abort.signal });
assert.ok(deleted, 'abort after upload must delete the written probe');
assert.ok(cancelled.slice(1).every(r => r.status === 'cancelled'));
console.log('doctor-checks: passed');
