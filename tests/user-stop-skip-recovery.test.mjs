// User Stop must skip auto scene recovery without blocking a later turn.

import {
    setCancelRequested,
    setInlineGenStartMs,
    inlineGenStartMs,
    shouldSkipAutoSceneRecovery,
} from '../src/state.js';

let pass = 0, fail = 0;
function eq(name, actual, expected) {
    if (actual === expected) { pass++; console.log('  OK   ' + name); }
    else { fail++; console.log('  FAIL ' + name + ' — expected ' + expected + ', got ' + actual); }
}

console.log('\n── User stop skip auto-recovery ──');

setCancelRequested(false);
setInlineGenStartMs(1000);
eq('recovery allowed by default', shouldSkipAutoSceneRecovery(), false);
eq('inline ownership kept before stop', inlineGenStartMs, 1000);

// Mirrors GENERATION_STOPPED: mark cancel, keep inlineGenStartMs for extract.
setCancelRequested(true);
eq('stop skips auto-recovery', shouldSkipAutoSceneRecovery(), true);
eq('inline ownership kept after stop (extract still allowed)', inlineGenStartMs, 1000);

// Mirrors interceptor start of the next ST generation.
setCancelRequested(false);
eq('next generation clears skip', shouldSkipAutoSceneRecovery(), false);

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass}/${pass + fail}`);
if (fail) process.exit(1);
