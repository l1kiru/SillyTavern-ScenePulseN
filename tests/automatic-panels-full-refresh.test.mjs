import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/generation/engine.js', import.meta.url), 'utf8');

assert.match(source, /const automaticPanelRoutingRequested=/, 'engine identifies automatic routing before request planning');
assert.match(
    source,
    /const useDelta=!hasStaleSnapshotBefore\(mesIdx\)&&shouldUseDelta\(baseSnapshot\)/,
    'Automatic routing no longer disables Delta eligibility',
);
assert.match(
    source,
    /shouldUseParallelDeltaBuild\(\{[\s\S]*automaticRouting:automaticPanelRoutingRequested/,
    'Automatic routing is handed to the adaptive Parallel Delta planner',
);
assert.match(
    source,
    /const dynamicPanelRouting=useProfileBoundParallel&&automaticPanelRoutingRequested/,
    'same-turn router is enabled for both parallel Full and parallel Delta',
);
assert.doesNotMatch(
    source,
    /useDelta=!automaticPanelRoutingRequested/,
    'legacy behavior that forced every Automatic turn to Full is removed',
);

console.log('automatic-panels-full-refresh.test.mjs: all tests passed');
