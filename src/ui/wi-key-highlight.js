// Temporary underline highlight for lorebook matched keys in chat text.

import { resolveScanDepth } from '../scene-source-trace.js';

export const WI_KEY_HIT_CLASS = 'sp-wi-key-hit';
export const WI_KEY_HIGHLIGHT_MS = 7000;

let _clearTimer = null;

/** @returns {{ start: number, end: number }[]} */
export function findCaseInsensitiveRanges(text, key) {
    const t = String(text ?? '');
    const k = String(key ?? '');
    if (!t || !k) return [];
    const lower = t.toLowerCase();
    const needle = k.toLowerCase();
    if (!needle) return [];
    const out = [];
    let idx = 0;
    while (idx <= lower.length - needle.length) {
        const found = lower.indexOf(needle, idx);
        if (found < 0) break;
        out.push({ start: found, end: found + needle.length });
        idx = found + needle.length;
    }
    return out;
}

/** Longest-key-first; drop overlapping ranges. Sorted by start. */
export function collectNonOverlappingRanges(text, keys) {
    const list = (Array.isArray(keys) ? keys : [])
        .map(k => String(k || '').trim())
        .filter(Boolean)
        .sort((a, b) => b.length - a.length || a.localeCompare(b));
    const taken = [];
    for (const key of list) {
        for (const r of findCaseInsensitiveRanges(text, key)) {
            if (taken.some(t => !(r.end <= t.start || r.start >= t.end))) continue;
            taken.push(r);
        }
    }
    taken.sort((a, b) => a.start - b.start || b.end - a.end);
    return taken;
}

function _unwrapHit(el) {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    try { parent.normalize?.(); } catch { /* ignore */ }
}

export function clearWiKeyHighlights() {
    if (_clearTimer != null) {
        try { clearTimeout(_clearTimer); } catch { /* ignore */ }
        _clearTimer = null;
    }
    try {
        document.querySelectorAll(`.${WI_KEY_HIT_CLASS}`).forEach(_unwrapHit);
    } catch { /* ignore */ }
}

function _inHit(node) {
    let n = node;
    while (n) {
        if (n.nodeType === 1 && n.classList?.contains(WI_KEY_HIT_CLASS)) return true;
        n = n.parentNode;
    }
    return false;
}

function _wrapRangesInTextNode(textNode, ranges) {
    if (!textNode?.parentNode || !ranges.length) return;
    // Wrap from end so earlier offsets stay valid on the remaining prefix node.
    const ordered = ranges.slice().sort((a, b) => b.start - a.start);
    let node = textNode;
    for (const { start, end } of ordered) {
        if (!node?.parentNode || _inHit(node)) return;
        const full = node.nodeValue || '';
        if (start < 0 || end > full.length || start >= end) continue;
        node.splitText(end);
        const mid = node.splitText(start);
        const span = document.createElement('span');
        span.classList.add(WI_KEY_HIT_CLASS);
        span.tabIndex = -1;
        mid.parentNode.insertBefore(span, mid);
        span.appendChild(mid);
    }
}

function _scanMesNodes(depth) {
    const n = Math.max(1, Number(depth) || 1);
    try {
        const all = document.querySelectorAll('#chat .mes');
        if (!all.length) return [];
        const start = Math.max(0, all.length - n);
        const out = [];
        for (let i = start; i < all.length; i++) {
            const mesText = all[i].querySelector?.('.mes_text');
            if (mesText) out.push(mesText);
        }
        return out;
    } catch {
        return [];
    }
}

function _scanMesNodesByIds(messageIds) {
    const ids = (Array.isArray(messageIds) ? messageIds : [])
        .map(id => Number(id))
        .filter(id => Number.isFinite(id));
    if (!ids.length) return [];
    const out = [];
    try {
        for (const id of ids) {
            const mes = document.querySelector(`#chat .mes[mesid="${id}"]`);
            const mesText = mes?.querySelector?.('.mes_text');
            if (mesText) out.push(mesText);
        }
    } catch { /* ignore */ }
    return out;
}

function _wrapInRoot(root, keys) {
    if (!root || !keys.length) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node?.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
            if (_inHit(node)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        },
    });
    const nodes = [];
    let cur;
    while ((cur = walker.nextNode())) nodes.push(cur);
    for (const textNode of nodes) {
        const ranges = collectNonOverlappingRanges(textNode.nodeValue || '', keys);
        if (ranges.length) _wrapRangesInTextNode(textNode, ranges);
    }
}

/**
 * Highlight all case-insensitive occurrences of keys in capture-time messageIds
 * when provided; otherwise the last WI scan-depth messages (live tail fallback).
 * Scrolls/focuses the first hit. Clears after WI_KEY_HIGHLIGHT_MS.
 */
export function highlightMatchedKeysInChat(keys, { messageIds } = {}) {
    const list = (Array.isArray(keys) ? keys : [])
        .map(k => String(k || '').trim())
        .filter(Boolean);
    clearWiKeyHighlights();
    if (!list.length) return 0;

    const byId = Array.isArray(messageIds) && messageIds.length
        ? _scanMesNodesByIds(messageIds)
        : [];
    const roots = byId.length ? byId : _scanMesNodes(resolveScanDepth());
    for (const mesText of roots) {
        _wrapInRoot(mesText, list);
    }

    let first = null;
    try {
        first = document.querySelector(`#chat .${WI_KEY_HIT_CLASS}`);
    } catch { /* ignore */ }
    if (first) {
        try { first.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* ignore */ }
        try { first.focus?.({ preventScroll: true }); } catch {
            try { first.focus?.(); } catch { /* ignore */ }
        }
    }

    _clearTimer = setTimeout(() => {
        _clearTimer = null;
        clearWiKeyHighlights();
    }, WI_KEY_HIGHLIGHT_MS);
    try { _clearTimer.unref?.(); } catch { /* ignore */ }

    try {
        return document.querySelectorAll(`#chat .${WI_KEY_HIT_CLASS}`).length;
    } catch {
        return first ? 1 : 0;
    }
}

/** Test hook */
export function _resetWiKeyHighlightForTests() {
    clearWiKeyHighlights();
}
