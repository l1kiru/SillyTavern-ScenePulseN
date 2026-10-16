import assert from 'node:assert/strict';
import { captureError, clearForCleanup, flushNow, isCaptureEnabled, _resetForTests } from '../src/crash-log.js';

globalThis.localStorage = { setItem() {}, removeItem() {} };
globalThis.SillyTavern = { getContext: () => ({}) };
let finishOld;
const uploads = [];
globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(Buffer.from(JSON.parse(options.body).data, 'base64').toString('utf8'));
    uploads.push(payload);
    if (uploads.length === 1) await new Promise(resolve => { finishOld = resolve; });
    return { ok: true };
};
captureError({ source: 'scenepulse', message: 'old diagnostic' });
const old = flushNow();
const cleaning = clearForCleanup();
assert.equal(uploads.length, 1, 'cleanup waits for in-flight older upload');
assert.equal(isCaptureEnabled(), false);
captureError({ source: 'scenepulse', message: 'must not repopulate log' });
finishOld();
await Promise.all([old, cleaning]);
assert.equal(uploads.length, 2);
assert.equal(uploads[0].entries.length, 1);
assert.equal(uploads[1].entries.length, 0, 'last server write is empty');
globalThis.fetch = async () => ({ ok: false });
await assert.rejects(clearForCleanup(), /server crash log/);
_resetForTests();
console.log('crash-log-cleanup: passed');
