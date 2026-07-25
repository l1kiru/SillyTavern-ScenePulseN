// tests/together-framing.test.mjs — Together Compatible/Full framing module

import {
    normalizeTrackerPromptStyle,
    getTogetherRulesBlock,
    getTogetherOutputFormatBlock,
    TRACKER_PROMPT_STYLES,
} from '../src/prompts/together-framing.js';

let pass = 0, fail = 0;

function eq(name, actual, expected) {
    if (actual === expected) { pass++; console.log('  OK   ' + name); }
    else { fail++; console.log('  FAIL ' + name + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual)); }
}

function ok(name, v) {
    if (v) { pass++; console.log('  OK   ' + name); }
    else { fail++; console.log('  FAIL ' + name); }
}

console.log('\n── Together framing module ──');

eq('TRACKER_PROMPT_STYLES', JSON.stringify(TRACKER_PROMPT_STYLES), JSON.stringify(['compatible', 'full']));
eq('normalize full', normalizeTrackerPromptStyle('full'), 'full');
eq('normalize unknown', normalizeTrackerPromptStyle('nope'), 'compatible');
eq('normalize compatible', normalizeTrackerPromptStyle('compatible'), 'compatible');

const compat = getTogetherRulesBlock('compatible');
ok('compatible has ANTI-OMNISCIENT', compat.includes('ANTI-OMNISCIENT'));
ok('compatible lacks INTERNAL REASONING', !compat.includes('INTERNAL REASONING'));
ok('compatible lacks Valence', !compat.includes('Valence'));
ok('compatible has handover ban', compat.includes('handover cue'));
ok('compatible has always-include carve-out', compat.includes('always-include'));
ok('compatible has SP markers in rules block only via output helper', !compat.includes('SP_TRACKER_START'));

const full = getTogetherRulesBlock('full');
ok('full has INTERNAL REASONING', full.includes('INTERNAL REASONING'));
ok('full has Valence', full.includes('Valence'));
ok('full still has ANTI-OMNISCIENT', full.includes('ANTI-OMNISCIENT'));

const deltaOut = getTogetherOutputFormatBlock({
    isDelta: true,
    deltaAlways: 'time, date, elapsed',
    deltaExample: '{"time":"14:30","date":"03/15/2025"}',
    fieldList: 'time, date, location',
});
ok('delta output has markers', deltaOut.includes('<!--SP_TRACKER_START-->') && deltaOut.includes('<!--SP_TRACKER_END-->'));
ok('delta output uses deltaExample', deltaOut.includes('{"time":"14:30","date":"03/15/2025"}'));
ok('delta output mentions always-include fields', deltaOut.includes('time, date, elapsed'));
ok('delta output has no markdown fence rule', deltaOut.includes('Do not wrap the JSON in markdown code blocks'));

const fullOut = getTogetherOutputFormatBlock({
    isDelta: false,
    deltaAlways: '',
    deltaExample: '',
    fieldList: 'time, date, location',
});
ok('full output has Required keys', fullOut.includes('Required keys: time, date, location'));
ok('full output has markers', fullOut.includes('<!--SP_TRACKER_START-->'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
