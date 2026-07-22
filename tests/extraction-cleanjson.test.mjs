// Regression coverage for the production JSON candidate extractor.

globalThis.SillyTavern={getContext:()=>({
    name1:'User',name2:'Character',characterId:1,chatId:'clean-json',
    chat:[],chatMetadata:{scenepulse:{snapshots:{},swipeSnapshots:{}}},
    extensionSettings:{scenepulse:{deltaMode:false}},saveMetadata(){},saveSettingsDebounced(){},
})};
globalThis.localStorage={getItem:()=>null,setItem(){}};
globalThis.document={querySelector:()=>null};

const{cleanJson}=await import('../src/generation/extraction.js');

// ═══════════════════════════════════════════════════════════════════════
// Test cases
// ═══════════════════════════════════════════════════════════════════════

const cases = [
    // ─── Trailing-junk cases (the real failure from today's log) ───
    ['trailing schema tag (msg 34)',
     '{"time":"15:18","sceneMood":"tense","plotBranches":[{"type":"dramatic","name":"x","hook":"y - the dam breaking piece by piece"}]}{"@schema":"1.1"}',
     { time: '15:18', sceneMood: 'tense', plotBranches: [{ type: 'dramatic', name: 'x', hook: 'y - the dam breaking piece by piece' }] }],
    ['trailing schema tag with whitespace',
     '{"a":1}\n\n{"@schema":"1.1"}',
     { a: 1 }],
    ['trailing second object',
     '{"a":1,"b":[1,2,3]}  {"other":true}',
     { a: 1, b: [1, 2, 3] }],
    ['prose after valid object',
     '{"a":1} some trailing text',
     { a: 1 }],

    // ─── Normal valid JSON passthrough ───
    ['simple valid',
     '{"a":1,"b":2}',
     { a: 1, b: 2 }],
    ['nested valid',
     '{"a":{"b":{"c":[1,2,3]}}}',
     { a: { b: { c: [1, 2, 3] } } }],
    ['wrapped in markdown fence',
     '```json\n{"a":1}\n```',
     { a: 1 }],
    ['wrapped in prose',
     'Here is the tracker: {"time":"15:00","location":"park"} that is it.',
     { time: '15:00', location: 'park' }],

    // ─── String-awareness tests (critical — braces inside strings must not count) ───
    ['brace in string value',
     '{"note":"a } inside a string","x":1}',
     { note: 'a } inside a string', x: 1 }],
    ['multiple braces in strings',
     '{"a":"{ {{ }}","b":"}{}{","c":42}',
     { a: '{ {{ }}', b: '}{}{', c: 42 }],
    ['escaped quote in string with brace',
     '{"s":"he said \\"}\\" to me","x":1}',
     { s: 'he said "}" to me', x: 1 }],
    ['escaped backslash before brace',
     '{"path":"C:\\\\folder\\\\","x":1}',
     { path: 'C:\\folder\\', x: 1 }],

    // ─── The exact unescaped-quote case that jsonrepair fixes ───
    ['unescaped quote in milestone (jsonrepair passthrough)',
     '{"milestone":"the "best" idea","affection":42}',
     'PARSES'],

    // ─── Unbalanced → fallback path ───
    ['unclosed object (should throw after fallback)',
     '{"a":1',
     'THROWS'],
    ['unclosed nested (should throw after fallback)',
     '{"a":{"b":{"c":1',
     'THROWS'],

    // ─── Pre-existing cases (regression guard) ───
    ['trailing comma',
     '{"a":1,"b":2,}',
     { a: 1, b: 2 }],
    ['double trailing comma',
     '{"a":1,,}',
     { a: 1 }],
    ['leading plus number',
     '{"a":+5}',
     { a: 5 }],
    ['single quotes (jsonrepair fixes)',
     "{'a':'hi'}",
     { a: 'hi' }],
    ['python literals',
     '{"a":True,"b":False,"c":None}',
     { a: true, b: false, c: null }],
];

function deepEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
    return true;
}

let pass = 0, fail = 0;
const failures = [];

for (const [name, input, expected] of cases) {
    try {
        const result = cleanJson(input);
        if (expected === 'THROWS') {
            fail++;
            failures.push({ name, why: 'expected THROWS, got: ' + JSON.stringify(result).slice(0, 80) });
        } else if (expected === 'PARSES') {
            pass++;
        } else if (deepEqual(result, expected)) {
            pass++;
        } else {
            fail++;
            failures.push({ name, why: 'expected ' + JSON.stringify(expected) + ' got ' + JSON.stringify(result) });
        }
    } catch (e) {
        if (expected === 'THROWS') pass++;
        else { fail++; failures.push({ name, why: 'threw: ' + (e?.message || String(e)) }); }
    }
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('cleanJson() balanced-brace extraction — ' + cases.length + ' cases');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log((fail === 0 ? 'PASS ' : 'FAIL ') + pass + '/' + cases.length);

if (failures.length) {
    console.log('');
    console.log('Failures:');
    for (const f of failures) {
        console.log('  [' + f.name + ']');
        console.log('    ' + f.why);
    }
}

process.exit(failures.length ? 1 : 0);
