// Scrub must track stored scenes — not chat messages without an active snapshot.

import { resolveScrubMesIdx } from '../src/settings.js';

let pass = 0, fail = 0;
function eq(name, actual, expected) {
    if (actual === expected) { pass++; console.log('  OK   ' + name); }
    else { fail++; console.log('  FAIL ' + name + ' — expected ' + expected + ', got ' + actual); }
}
function assertTrue(name, v) {
    if (v) { pass++; console.log('  OK   ' + name); }
    else { fail++; console.log('  FAIL ' + name); }
}

function shouldShowHistoricalDisclaimer(selectedKey, mirrorIds) {
    const sorted = mirrorIds.slice().sort((a, b) => a - b);
    if (!sorted.length) return false;
    const latest = sorted[sorted.length - 1];
    let selected = selectedKey >= 0 ? selectedKey : latest;
    if (!sorted.includes(selected)) selected = latest;
    return selected !== latest;
}

console.log('\n── resolveScrubMesIdx ──');

const mirror = [3, 5];
eq(
    'missing target with phantom scrub falls back to latest mirror',
    resolveScrubMesIdx({ entry: { id: 7, snapshot: null, status: 'missing' }, mirrorIds: mirror, currentScrub: 7 }),
    5
);
eq(
    'missing target preserves valid historical scrub',
    resolveScrubMesIdx({ entry: { id: 7, snapshot: null, status: 'missing' }, mirrorIds: mirror, currentScrub: 3 }),
    3
);
eq(
    'current snapshot opens that scene',
    resolveScrubMesIdx({ entry: { id: 7, snapshot: { time: '12:00' }, status: 'current' }, mirrorIds: [...mirror, 7], currentScrub: 5 }),
    7
);
eq(
    'stale keeps target id for regen',
    resolveScrubMesIdx({ entry: { id: 7, snapshot: { time: '12:00' }, status: 'stale' }, mirrorIds: mirror, currentScrub: 5 }),
    7
);
eq(
    'no mirrors and missing → -1',
    resolveScrubMesIdx({ entry: { id: 7, snapshot: null, status: 'missing' }, mirrorIds: [], currentScrub: 7 }),
    -1
);

console.log('\n── historical disclaimer gate ──');
assertTrue('phantom scrub does not show disclaimer', !shouldShowHistoricalDisclaimer(7, [3, 5]));
assertTrue('true historical scrub shows disclaimer', shouldShowHistoricalDisclaimer(3, [3, 5]));
assertTrue('on latest — no disclaimer', !shouldShowHistoricalDisclaimer(5, [3, 5]));

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass}/${pass + fail}`);
if (fail) process.exit(1);
