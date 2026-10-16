import assert from 'node:assert/strict';
import { createPersonaGuard } from '../src/persona-guard.js';

function fixture() {
    let state = { chatKey: 'chat-a', metadata: {}, current: { avatarId: 'a.png', name: 'Alice' }, personas: { 'a.png': 'Alice', 'b.png': 'Bob' }, chat: [] };
    const prompts = [], switches = [];
    let answer = false, saves = 0;
    const guard = createPersonaGuard({
        read: () => state,
        confirm: async (...args) => { prompts.push(args); return typeof answer === 'function' ? answer() : answer; },
        select: async id => { switches.push(id); state.current = { avatarId: id, name: state.personas[id] }; await guard.check(); },
        save: () => { saves++; },
    });
    return { guard, prompts, switches, get state() { return state; }, set state(v) { state = v; }, set answer(v) { answer = v; }, get saves() { return saves; } };
}
const f = fixture();
await f.guard.check();
assert.equal(f.prompts.length, 0);
f.state.current = { avatarId: 'b.png', name: 'Bob' };
f.answer = true;
await f.guard.check();
assert.deepEqual(f.switches, ['a.png']);
assert.equal(f.state.metadata.scenepulse.persona.avatarId, 'a.png');
f.state.current = { avatarId: 'b.png', name: 'Bob' };
f.answer = false;
await f.guard.check();
await f.guard.check();
assert.equal(f.prompts.length, 2, 'decline accepts new persona without repeated prompt');
assert.equal(f.state.metadata.scenepulse.persona.avatarId, 'b.png');

const legacy = fixture();
legacy.state.chat = [{ is_user: true, name: 'Bob', mes: 'hello' }];
await legacy.guard.check();
assert.equal(legacy.prompts[0][0].avatarId, 'b.png');
const ambiguous = fixture();
ambiguous.state.personas['b2.png'] = 'Bob';
ambiguous.state.chat = [{ is_user: true, name: 'Bob' }];
await ambiguous.guard.check();
assert.equal(ambiguous.prompts.length, 0, 'never guess between same-name personas');

const race = fixture();
await race.guard.check();
race.state.current = { avatarId: 'b.png', name: 'Bob' };
let resolve;
race.answer = () => new Promise(r => { resolve = r; });
const pending = race.guard.check();
await race.guard.check();
assert.equal(race.prompts.length, 1, 'duplicate events share one decision');
race.state = { ...race.state, chatKey: 'chat-b', metadata: {} };
resolve(true);
await pending;
assert.equal(race.switches.length, 0, 'old dialog cannot change another chat');
assert.deepEqual(race.state.metadata, {});

for (const action of ['persona-change', 'dispose']) {
    const r = fixture();
    await r.guard.check();
    r.state.current = { avatarId: 'b.png', name: 'Bob' };
    let finish;
    r.answer = () => new Promise(resolve => { finish = resolve; });
    const pending = r.guard.check();
    if (action === 'dispose') r.guard.dispose();
    else r.state.current = { avatarId: 'c.png', name: 'Charlie' };
    finish(true);
    await pending;
    assert.equal(r.switches.length, 0, action + ' invalidates confirmation');
}

const deleted = fixture();
await deleted.guard.check();
delete deleted.state.personas['a.png'];
deleted.state.current = { avatarId: 'b.png', name: 'Bob' };
await deleted.guard.check();
assert.equal(deleted.prompts.length, 0, 'cannot restore a deleted persona');
console.log('persona-guard: passed');
