import assert from 'node:assert/strict';
import { inferTriggersForEntry } from '../src/scene-source-trace/matcher.js';
import fixture from './fixtures/wi-artoria-regex.json' with { type: 'json' };

{
    const r = inferTriggersForEntry(
        { key: ['Cat'], matchWholeWords: true, caseSensitive: false },
        'Category has Cat inside',
        { matchWholeWords: true, caseSensitive: false },
    );
    assert.ok(r.matchedKeys.some(k => k.toLowerCase() === 'cat'));
}

{
    const r = inferTriggersForEntry(
        { key: ['ion'], matchWholeWords: true },
        'lion',
        { matchWholeWords: true },
    );
    assert.deepEqual(r.matchedKeys, []);
}

{
    const r = inferTriggersForEntry(
        { key: [fixture.key], selectiveLogic: 0, keysecondary: [] },
        'met Арторией Пендрагон',
        {},
    );
    assert.ok(r.triggers[0].matchedText);
    assert.equal(r.triggers[0].evidence.type, 'inferred');
    assert.ok(Number.isInteger(r.triggers[0].matchIndex));
}

{
    const r = inferTriggersForEntry(
        { key: ['Artoria'], keysecondary: ['Camelot'], selectiveLogic: 0 },
        'Artoria walks alone',
        {},
    );
    assert.equal(r.matchKind, 'none');
}

console.log('scene-source-trace-matcher.test.mjs: all tests passed');
