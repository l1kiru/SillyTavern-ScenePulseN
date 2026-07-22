import assert from 'node:assert/strict';
import { restoreGenerationMeta } from '../src/ui/update-panel.js';
import { genMeta, lastGenSource, setLastGenSource } from '../src/state.js';

setLastGenSource('before');
genMeta.promptTokens = 0;
genMeta.completionTokens = 0;
genMeta.elapsed = 0;

restoreGenerationMeta({
    _spMeta: {
        source: 'auto:separate',
        promptTokens: 120,
        completionTokens: 80,
        elapsed: 4.5,
    },
});

assert.equal(lastGenSource, 'auto:separate');
assert.deepEqual(genMeta, { promptTokens: 120, completionTokens: 80, elapsed: 4.5 });

console.log('update-panel-meta.test.mjs: all tests passed');
