import assert from 'node:assert/strict';

const {
    findCaseInsensitiveRanges,
    collectNonOverlappingRanges,
    highlightMatchedKeysInChat,
    clearWiKeyHighlights,
    _resetWiKeyHighlightForTests,
    WI_KEY_HIT_CLASS,
} = await import('../src/ui/wi-key-highlight.js');

assert.deepEqual(findCaseInsensitiveRanges('', 'x'), []);
assert.deepEqual(findCaseInsensitiveRanges('hello', ''), []);
assert.deepEqual(findCaseInsensitiveRanges('Hello World', 'hello'), [{ start: 0, end: 5 }]);
assert.deepEqual(
    findCaseInsensitiveRanges('foo FOO Foo', 'foo'),
    [{ start: 0, end: 3 }, { start: 4, end: 7 }, { start: 8, end: 11 }],
);
assert.deepEqual(
    findCaseInsensitiveRanges('медицинского отсека и ещё медицинского отсека', 'медицинского отсека'),
    [{ start: 0, end: 19 }, { start: 26, end: 45 }],
);

const ranges = collectNonOverlappingRanges('зал Рейшифта и Рейшифта', ['Рейшифта', 'зал Рейшифта']);
assert.deepEqual(ranges, [{ start: 0, end: 12 }, { start: 15, end: 23 }]);
assert.deepEqual(
    collectNonOverlappingRanges('командный центр', ['центр', 'командный центр']),
    [{ start: 0, end: 15 }],
);

// Minimal DOM smoke for wrap / focus / clear
class FakeText {
    constructor(value) {
        this.nodeType = 3;
        this.nodeValue = value;
        this.parentNode = null;
    }
    splitText(offset) {
        const next = new FakeText(this.nodeValue.slice(offset));
        this.nodeValue = this.nodeValue.slice(0, offset);
        next.parentNode = this.parentNode;
        const kids = this.parentNode.childNodes;
        kids.splice(kids.indexOf(this) + 1, 0, next);
        return next;
    }
}
class FakeEl {
    constructor(tag) {
        this.tagName = String(tag).toUpperCase();
        this.nodeType = 1;
        this.childNodes = [];
        this.parentNode = null;
        this.tabIndex = 0;
        this._mesText = null;
        this.focused = false;
        this.scrolled = false;
        this._attrs = Object.create(null);
        const self = this;
        this.classList = {
            _s: new Set(),
            add(c) { this._s.add(c); self._className = [...this._s].join(' '); },
            contains(c) { return this._s.has(c); },
        };
    }
    get className() { return this._className || ''; }
    get firstChild() { return this.childNodes[0] || null; }
    setAttribute(k, v) { this._attrs[k] = String(v); }
    getAttribute(k) { return Object.hasOwn(this._attrs, k) ? this._attrs[k] : null; }
    appendChild(ch) {
        if (ch.parentNode?.removeChild) {
            try { ch.parentNode.removeChild(ch); } catch { /* ignore */ }
        }
        ch.parentNode = this;
        this.childNodes.push(ch);
        return ch;
    }
    insertBefore(ch, ref) {
        if (ch.parentNode?.removeChild && ch.parentNode !== this) {
            try { ch.parentNode.removeChild(ch); } catch { /* ignore */ }
        }
        ch.parentNode = this;
        const i = this.childNodes.indexOf(ref);
        if (i < 0) this.childNodes.push(ch);
        else this.childNodes.splice(i, 0, ch);
        return ch;
    }
    removeChild(ch) {
        const i = this.childNodes.indexOf(ch);
        if (i >= 0) this.childNodes.splice(i, 1);
        ch.parentNode = null;
        return ch;
    }
    normalize() {
        for (let i = 0; i < this.childNodes.length - 1;) {
            const a = this.childNodes[i];
            const b = this.childNodes[i + 1];
            if (a.nodeType === 3 && b?.nodeType === 3) {
                a.nodeValue += b.nodeValue;
                this.removeChild(b);
            } else i++;
        }
    }
    querySelector(sel) {
        if (sel === '.mes_text') return this._mesText;
        return null;
    }
    focus() { this.focused = true; }
    scrollIntoView() { this.scrolled = true; }
}

function walkHits(node, out = []) {
    if (node.nodeType === 1 && node.classList?.contains(WI_KEY_HIT_CLASS)) out.push(node);
    for (const c of node.childNodes || []) walkHits(c, out);
    return out;
}
function allText(node, out = []) {
    if (node.nodeType === 3) out.push(node);
    for (const c of node.childNodes || []) allText(c, out);
    return out;
}

function makeMes(mesid, text) {
    const mesText = new FakeEl('div');
    mesText.classList.add('mes_text');
    mesText.appendChild(new FakeText(text));
    const mes = new FakeEl('div');
    mes.classList.add('mes');
    mes.setAttribute('mesid', String(mesid));
    mes._mesText = mesText;
    mes.appendChild(mesText);
    return mes;
}

const mesOld = makeMes(2, 'old командный центр only here');
const mesNew = makeMes(9, 'new командный центр after growth');
const chat = new FakeEl('div');
chat.appendChild(mesOld);
chat.appendChild(mesNew);
const allMes = [mesOld, mesNew];

globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
globalThis.document = {
    createElement(tag) { return new FakeEl(tag); },
    createTreeWalker(root, _w, filter) {
        const nodes = allText(root).filter(n => filter.acceptNode(n) === NodeFilter.FILTER_ACCEPT);
        let i = -1;
        return { nextNode() { i++; return i < nodes.length ? nodes[i] : null; } };
    },
    querySelectorAll(sel) {
        if (sel === '#chat .mes') return allMes;
        if (String(sel).includes(WI_KEY_HIT_CLASS)) return walkHits(chat);
        return [];
    },
    querySelector(sel) {
        const m = String(sel).match(/#chat \.mes\[mesid="(\d+)"\]/);
        if (m) return allMes.find(el => el.getAttribute('mesid') === m[1]) || null;
        if (String(sel).includes(WI_KEY_HIT_CLASS)) return walkHits(chat)[0] || null;
        return null;
    },
};

_resetWiKeyHighlightForTests();
assert.equal(highlightMatchedKeysInChat(['командный центр'], { messageIds: [2] }), 1);
assert.equal(walkHits(mesOld).length, 1);
assert.equal(walkHits(mesNew).length, 0);
clearWiKeyHighlights();

_resetWiKeyHighlightForTests();
assert.equal(highlightMatchedKeysInChat(['командный центр']), 2);
assert.equal(walkHits(mesOld).length, 1);
assert.equal(walkHits(mesNew).length, 1);
const hitNodes = walkHits(chat);
assert.equal(hitNodes[0].scrolled, true);
assert.equal(hitNodes[0].focused, true);
assert.equal(highlightMatchedKeysInChat([]), 0);
clearWiKeyHighlights();
assert.equal(walkHits(chat).length, 0);
_resetWiKeyHighlightForTests();

console.log('wi-key-highlight.test.mjs: all tests passed');
