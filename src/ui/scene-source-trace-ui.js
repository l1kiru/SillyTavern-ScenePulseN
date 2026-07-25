// Scene Source Trace footer chip + drawer.

import { t } from '../i18n.js';
import { esc } from '../utils.js';
import { highlightMatchedKeysInChat } from './wi-key-highlight.js';

function _isRegexKey(key) {
    const s = String(key || '').trim();
    if (!s.startsWith('/')) return false;
    return s.lastIndexOf('/') > 0;
}

function _mode(meta = {}, settings = {}) {
    return meta.injectionMethod || settings.injectionMethod || 'inline';
}

/** @returns {null | string} Lore N / Lore 0 / Lore —, or null when setting off */
export function formatLoreChipLabel({ settings = {}, meta = {}, trace = null } = {}) {
    if (settings.sceneSourceTrace !== true) return null;
    const mode = _mode(meta, settings);
    if (mode !== 'inline') return 'Lore —';
    if (!trace || typeof trace !== 'object') return 'Lore —';
    const entries = Array.isArray(trace.lorebook?.entries) ? trace.lorebook.entries : [];
    const count = Number.isFinite(trace.lorebook?.count) ? trace.lorebook.count : entries.length;
    if (!trace.lorebook) return 'Lore —';
    if (!entries.length && count === 0) return 'Lore 0';
    return `Lore ${count}`;
}

function _displayKeys(entry) {
    if (Array.isArray(entry?.matchedKeys) && entry.matchedKeys.length) {
        return entry.matchedKeys.map(String).filter(Boolean);
    }
    const keys = Array.isArray(entry?.keys) ? entry.keys : [];
    return keys.map(String).filter(k => k && !_isRegexKey(k));
}

/** world — title — match… / constant / — */
export function formatTraceEntryLine(entry) {
    const world = String(entry?.world || '').trim() || '—';
    const title = String(entry?.title || entry?.comment || entry?.uid || '').trim() || '—';
    if (entry?.matchKind === 'constant') {
        return `${world} — ${title} — constant`;
    }
    const keys = _displayKeys(entry);
    if (!keys.length) return `${world} — ${title} — —`;
    return [world, title, ...keys].join(' — ');
}

function _entryMatchedKeys(entry) {
    if (entry?.matchKind === 'constant') return [];
    if (Array.isArray(entry?.matchedKeys)) {
        return entry.matchedKeys.map(k => String(k || '').trim()).filter(Boolean);
    }
    return [];
}

/**
 * @returns {{ chip: string|null, capturedAt: string, emptyKey: string|null, groups: Array<{world:string, items:Array<{line:string, uid:string, matchedKeys:string[], matchKind:string}>}>, omitted: number }}
 */
export function buildTraceDrawerModel({ settings = {}, meta = {}, trace = null } = {}) {
    const chip = formatLoreChipLabel({ settings, meta, trace });
    const capturedAt = trace?.capturedAt || '';
    const omitted = Number(trace?.lorebook?.omitted) || 0;
    if (chip == null) {
        return { chip: null, capturedAt: '', emptyKey: null, groups: [], omitted: 0 };
    }
    const mode = _mode(meta, settings);
    if (mode !== 'inline') {
        return { chip, capturedAt, emptyKey: 'together_only', groups: [], omitted: 0 };
    }
    if (!trace) {
        return { chip, capturedAt: '', emptyKey: 'no_capture', groups: [], omitted: 0 };
    }
    const entries = Array.isArray(trace.lorebook?.entries) ? trace.lorebook.entries : [];
    if (!entries.length) {
        return { chip, capturedAt, emptyKey: 'no_activations', groups: [], omitted };
    }
    const map = new Map();
    for (const entry of entries) {
        const world = String(entry.world || '').trim() || '—';
        if (!map.has(world)) map.set(world, []);
        const matchKind = String(entry.matchKind || (entry.constant ? 'constant' : 'none'));
        map.get(world).push({
            line: formatTraceEntryLine(entry),
            uid: entry.uid != null ? String(entry.uid) : '',
            matchedKeys: _entryMatchedKeys(entry),
            matchKind,
        });
    }
    const groups = [...map.entries()].map(([world, items]) => ({ world, items }));
    return { chip, capturedAt, emptyKey: null, groups, omitted };
}

function _emptyMessage(emptyKey) {
    if (emptyKey === 'no_capture') return t('No capture for this snapshot');
    if (emptyKey === 'no_activations') return t('No lorebook activations');
    if (emptyKey === 'together_only') return t('Together mode only');
    return emptyKey || '';
}

/** Mount Lore chip on footer + inline drawer under it. Returns null if setting off. */
export function mountSceneSourceTrace(body, { settings, snapshot, footer = null } = {}) {
    if (!body) return null;
    const meta = snapshot?._spMeta || {};
    const trace = meta.sceneSourceTrace || null;
    const model = buildTraceDrawerModel({ settings, meta, trace });
    if (model.chip == null) return null;

    let foot = footer;
    if (!foot) {
        foot = document.createElement('div');
        foot.className = 'sp-gen-footer';
        body.appendChild(foot);
    }

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'sp-gen-lore';
    chip.textContent = model.chip;
    chip.setAttribute('aria-expanded', 'false');
    chip.setAttribute('aria-label', t('Scene source trace'));
    chip.title = t('Scene source trace');

    const drawer = document.createElement('div');
    drawer.className = 'sp-source-trace-drawer';
    drawer.hidden = true;
    drawer.setAttribute('aria-label', t('Scene source trace'));

    let html = '';
    if (model.capturedAt) {
        let when = model.capturedAt;
        try { when = new Date(model.capturedAt).toLocaleString(); } catch { /* keep raw */ }
        html += `<div class="sp-source-trace-drawer-head"><span>${esc(t('Captured'))}</span><strong>${esc(when)}</strong></div>`;
    }
    if (model.emptyKey) {
        html += `<div class="sp-source-trace-empty">${esc(_emptyMessage(model.emptyKey))}</div>`;
    } else {
        html += '<div class="sp-source-trace-lore">';
        for (const group of model.groups) {
            html += `<div class="sp-source-trace-world"><div class="sp-source-trace-world-title">${esc(group.world)} <span>${group.items.length}</span></div>`;
            for (const item of group.items) {
                const keysJson = esc(JSON.stringify(Array.isArray(item.matchedKeys) ? item.matchedKeys : []));
                const kind = esc(item.matchKind || 'none');
                if (item.uid) {
                    html += `<details class="sp-source-trace-entry" data-matched-keys="${keysJson}" data-match-kind="${kind}"><summary><span>${esc(item.line)}</span></summary><div class="sp-source-trace-row"><span>UID</span><strong>${esc(item.uid)}</strong></div></details>`;
                } else {
                    html += `<div class="sp-source-trace-line" data-matched-keys="${keysJson}" data-match-kind="${kind}">${esc(item.line)}</div>`;
                }
            }
            html += '</div>';
        }
        html += '</div>';
    }
    if (model.omitted > 0) {
        html += `<div class="sp-source-trace-omitted">${esc(t('+{count} more omitted', { count: model.omitted }))}</div>`;
    }
    drawer.innerHTML = html;

    const onEntryClick = (e) => {
        const entry = e?.target?.closest?.('.sp-source-trace-entry, .sp-source-trace-line');
        if (!entry || !drawer.contains(entry)) return;
        let keys = [];
        try { keys = JSON.parse(entry.getAttribute('data-matched-keys') || '[]'); } catch { keys = []; }
        if (!Array.isArray(keys) || !keys.length) return;
        try { highlightMatchedKeysInChat(keys); } catch { /* ignore */ }
    };
    if (typeof drawer.addEventListener === 'function') drawer.addEventListener('click', onEntryClick);
    else drawer.onclick = onEntryClick;

    const onChipClick = (e) => {
        try { e?.stopPropagation?.(); e?.preventDefault?.(); } catch { /* ignore */ }
        const open = !!drawer.hidden;
        drawer.hidden = !open;
        chip.setAttribute('aria-expanded', String(open));
        if (open) drawer.classList.add('sp-source-trace-drawer-open');
        else drawer.classList.remove('sp-source-trace-drawer-open');
    };
    if (typeof chip.addEventListener === 'function') chip.addEventListener('click', onChipClick);
    else chip.onclick = onChipClick;

    foot.appendChild(chip);
    if (foot.parentNode === body) body.insertBefore(drawer, foot);
    else body.appendChild(drawer);
    return { chip, drawer, footer: foot, model };
}
