import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/generation/engine.js', import.meta.url), 'utf8');
assert.match(source, /const ENGINE_TIMEOUT_MS\s*=/, 'engine exposes one explicit outer watchdog budget');
assert.match(source, /Math\.max\(\s*180000/, 'outer watchdog never drops below 180s');
assert.doesNotMatch(source, /useParallelFull\s*\?\s*90000/, 'Parallel Full is not capped at the old 90s budget');

console.log('parallel-engine-timeout.test.mjs: all tests passed');
