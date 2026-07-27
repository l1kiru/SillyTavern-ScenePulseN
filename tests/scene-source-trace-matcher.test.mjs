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
    const no = inferTriggersForEntry(
        { key: ['red dragon'], matchWholeWords: true },
        'bred dragons',
        { matchWholeWords: true },
    );
    assert.deepEqual(no.matchedKeys, []);

    const yes = inferTriggersForEntry(
        { key: ['red dragon'], matchWholeWords: true },
        'the red dragon flew',
        { matchWholeWords: true },
    );
    assert.ok(yes.matchedKeys.some(k => /red dragon/i.test(k)));

    const substr = inferTriggersForEntry(
        { key: ['red dragon'], matchWholeWords: false },
        'bred dragons',
        { matchWholeWords: false },
    );
    assert.ok(substr.matchedKeys.some(k => /red dragon/i.test(k)));
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

// ST .find() order: only first matching primary key is authoritative for inferred match
{
    const r = inferTriggersForEntry(
        { key: ['Alpha', 'Beta'], caseSensitive: false },
        'Beta and Alpha both appear here',
        {},
    );
    assert.equal(r.matchKind, 'keys');
    assert.deepEqual(r.matchedKeys, ['Alpha']);
    assert.equal(r.triggers.length, 1);
    assert.equal(r.triggers[0].matchedText, 'Alpha');
    assert.equal(r.triggers[0].evidence.type, 'inferred');
}

console.log('scene-source-trace-matcher.test.mjs: all tests passed');
