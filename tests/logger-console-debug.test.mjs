// Console debug gate: off by default; log/warn/err skip console when false.
import assert from 'node:assert/strict';

const calls = { log: 0, warn: 0, error: 0 };
const orig = {
    log: console.log,
    warn: console.warn,
    error: console.error,
};
console.log = (...a) => { if (String(a[0]).includes('[ScenePulse]')) calls.log++; };
console.warn = (...a) => { if (String(a[0]).includes('[ScenePulse]')) calls.warn++; };
console.error = (...a) => { if (String(a[0]).includes('[ScenePulse]')) calls.error++; };

globalThis.SillyTavern = {
    getContext: () => ({ extensionSettings: { scenepulse: { consoleDebug: false } } }),
};

const { log, warn, err, isConsoleDebug, debugLog } = await import('../src/logger.js');
const { DEFAULTS } = await import('../src/constants.js');

assert.equal(DEFAULTS.consoleDebug, false);
assert.equal(isConsoleDebug(), false);
const before = debugLog.length;
log('quiet');
warn('quiet');
err('quiet');
assert.equal(calls.log, 0);
assert.equal(calls.warn, 0);
assert.equal(calls.error, 0);
assert.ok(debugLog.length >= before + 3);

globalThis.SillyTavern.getContext = () => ({ extensionSettings: { scenepulse: { consoleDebug: true } } });
assert.equal(isConsoleDebug(), true);
log('loud');
warn('loud');
err('loud');
assert.equal(calls.log, 1);
assert.equal(calls.warn, 1);
assert.equal(calls.error, 1);

console.log = orig.log;
console.warn = orig.warn;
console.error = orig.error;
console.log('logger-console-debug.test.mjs: all tests passed');
