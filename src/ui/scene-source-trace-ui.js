// Scene Source Trace footer chip + drawer.

import { t } from '../i18n.js';
import { esc } from '../utils.js';
import { highlightMatchedKeysInChat } from './wi-key-highlight.js';
import { migrateTraceToV3View } from '../scene-source-trace/migrate.js';
import { EvidenceLevel, getBestEvidence } from '../scene-source-trace/evidence.js';

export { getBestEvidence };

function _mode(meta = {}, settings = {}) {
    return meta.injectionMethod || settings.injectionMethod || 'inline';
}

function _view(trace) {
    return migrateTraceToV3View(trace) || trace;
}

function _evidenceLabel(best) {
    if (best === EvidenceLevel.INFERRED) return t('Evidence: inferred');
    if (best === EvidenceLevel.DIAGNOSTIC) return t('Evidence: diagnostic');
    if (best === EvidenceLevel.ENGINE) return t('Evidence: engine');
    return t('Evidence: unknown');
}

function _defaultCapabilities(view) {
    return view?.capabilities || {
        scanDone: false,
        engineDecisions: false,
        promptBuildDecisions: false,
    };
}

/** @returns {null | string} Lore N / Lore 0 / Lore —, or null when setting off */
export function formatLoreChipLabel({ settings = {}, meta = {}, trace = null } = {}) {
    if (settings.sceneSourceTrace !== true) return null;
    const mode = _mode(meta, settings);
    if (mode !== 'inline') return 'Lore —';
    if (!trace || typeof trace !== 'object') return 'Lore —';
    const view = _view(trace);
    const entries = Array.isArray(view?.lorebook?.entries) ? view.lorebook.entries : [];
    const count = Number.isFinite(view?.lorebook?.count) ? view.lorebook.count : entries.length;
    if (!view?.lorebook) return 'Lore —';
    if (!entries.length && count === 0) return 'Lore 0';
    return `Lore ${count}`;
}

function _displayKeys(entry) {
    const bestEvidence = getBestEvidence(entry);
    const triggerKeys = (entry?.triggers ?? [])
        .filter(tr =>
            tr?.type === 'primary_key'
            && tr?.matchedText
            && tr?.evidence?.type === bestEvidence,
        )
        .map(tr => String(tr.matchedText));
    if (triggerKeys.length) return [...new Set(triggerKeys)];
    return Array.isArray(entry?.matchedKeys)
        ? [...new Set(entry.matchedKeys.map(String).filter(Boolean))]
        : [];
}

export function formatTraceEntryTitle(entry) {
    return String(entry?.title || entry?.comment || entry?.uid || '').trim() || '—';
}

export function formatTraceEntryKeyLine(entry) {
    if (entry?.matchKind === 'constant') return 'key - { constant }';
    if (entry?.matchKind === 'force') return `${t('External activation')} - { external }`;
    if (entry?.matchKind === 'sticky') return `${t('Sticky activation')} - { sticky }`;
    const keys = _displayKeys(entry);
    if (!keys.length) return 'key - { — }';
    const best = getBestEvidence(entry);
    const label = best === EvidenceLevel.INFERRED ? t('Inferred key') : 'key';
    return `${label} - { ${keys.join(', ')} }`;
}

/** title + key line (no world — world is the group header) */
export function formatTraceEntryLine(entry) {
    return `${formatTraceEntryTitle(entry)}\n${formatTraceEntryKeyLine(entry)}`;
}

function _entryMatchedKeys(entry) {
    if (entry?.matchKind === 'constant' || entry?.matchKind === 'force') return [];
    return _displayKeys(entry);
}

function _attachmentLabel(sources) {
    if (!Array.isArray(sources) || !sources.length) return '';
    const map = {
        character: t('Attachment: Character Lore'),
        global: t('Attachment: Global Lore'),
        chat: t('Attachment: Chat Lore'),
        persona: t('Attachment: Persona Lore'),
    };
    return sources.map(s => map[s] || s).join(', ');
}

function _scanMessageIds(view, trace) {
    const raw = view?.scanContext?.messageIds ?? trace?.scanContext?.messageIds;
    if (!Array.isArray(raw)) return [];
    return raw.map(id => Number(id)).filter(id => Number.isFinite(id));
}

/**
 * @returns {{ chip: string|null, capturedAt: string, emptyKey: string|null, groups: Array, omitted: number, timeline: Array, budgetOverflowed: boolean, scanMessageIds: number[] }}
 */
export function buildTraceDrawerModel({ settings = {}, meta = {}, trace = null, groupBy = 'world' } = {}) {
    const chip = formatLoreChipLabel({ settings, meta, trace });
    const view = trace ? _view(trace) : null;
    const capturedAt = view?.capturedAt || trace?.capturedAt || '';
    const omitted = Number(view?.lorebook?.omitted || trace?.lorebook?.omitted) || 0;
    const timeline = Array.isArray(view?.loops) ? view.loops.map(l => ({
        loopCount: l.loopCount,
        state: l.state,
        newAcceptedEntryKeys: l.newAcceptedEntryKeys || [],
        budgetOverflowed: !!l.budgetOverflowed,
    })) : [];
    const budgetOverflowed = !!view?.summary?.budgetOverflowed;
    const lorebookByName = new Map(
        (Array.isArray(view?.lorebooks) ? view.lorebooks : []).map(b => [b.name || b.id, b]),
    );
    const scanMessageIds = _scanMessageIds(view, trace);

    const capsEmpty = _defaultCapabilities(view);
    if (chip == null) {
        return { chip: null, capturedAt: '', emptyKey: null, groups: [], omitted: 0, timeline: [], budgetOverflowed: false, capabilities: capsEmpty, scanMessageIds: [] };
    }
    const mode = _mode(meta, settings);
    if (mode !== 'inline') {
        return { chip, capturedAt, emptyKey: 'together_only', groups: [], omitted: 0, timeline: [], budgetOverflowed, capabilities: capsEmpty, scanMessageIds };
    }
    if (!trace) {
        return { chip, capturedAt: '', emptyKey: 'no_capture', groups: [], omitted: 0, timeline: [], budgetOverflowed, capabilities: capsEmpty, scanMessageIds: [] };
    }
    const entries = Array.isArray(view?.lorebook?.entries) ? view.lorebook.entries : [];
    if (!entries.length) {
        return { chip, capturedAt, emptyKey: 'no_activations', groups: [], omitted, timeline, budgetOverflowed, capabilities: capsEmpty, scanMessageIds };
    }
    const items = entries.map(entry => {
        const matchKind = String(entry.matchKind || (entry.constant ? 'constant' : 'none'));
        const world = String(entry.world || '').trim() || '—';
        return {
            world,
            title: formatTraceEntryTitle(entry),
            keyLine: formatTraceEntryKeyLine(entry),
            uid: entry.uid != null ? String(entry.uid) : '',
            tokens: Number.isFinite(entry.tokens) ? entry.tokens : null,
            matchedKeys: _entryMatchedKeys(entry),
            matchKind,
            firstSeenLoop: entry.firstSeenLoop,
            timedEffects: entry.timedEffects || {},
            insertion: entry.promptInsertion?.status || entry.stages?.inserted?.value || 'unknown',
            evidenceBest: getBestEvidence(entry),
            evidenceLabel: _evidenceLabel(getBestEvidence(entry)),
        };
    });
    const capabilities = _defaultCapabilities(view);

    const map = new Map();
    for (const item of items) {
        let bucket = item.world;
        if (groupBy === 'loop') bucket = item.firstSeenLoop == null ? 'unknown' : `loop ${item.firstSeenLoop}`;
        else if (groupBy === 'activationType') bucket = item.matchKind || 'unknown';
        else if (groupBy === 'insertion') bucket = String(item.insertion);
        else if (groupBy === 'evidence') bucket = item.evidenceBest;
        if (!map.has(bucket)) map.set(bucket, []);
        map.get(bucket).push(item);
    }
    const groups = [...map.entries()].map(([world, groupItems]) => {
        const book = lorebookByName.get(world);
        return {
            world,
            attachment: book ? _attachmentLabel(book.attachmentSources) : '',
            items: groupItems,
        };
    });
    return {
        chip,
        capturedAt,
        emptyKey: null,
        groups,
        omitted,
        timeline,
        budgetOverflowed,
        groupBy,
        capabilities,
        scanMessageIds,
    };
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
    let title = t('Scene source trace');
    if (model.budgetOverflowed) title += ` — ${t('Budget overflowed')}`;
    chip.title = title;

    const drawer = document.createElement('div');
    drawer.className = 'sp-source-trace-drawer';
    drawer.hidden = true;
    drawer.setAttribute('aria-label', t('Scene source trace'));
    drawer.setAttribute('data-scan-message-ids', JSON.stringify(model.scanMessageIds || []));

    let html = '';
    if (model.capturedAt) {
        let when = model.capturedAt;
        try { when = new Date(model.capturedAt).toLocaleString(); } catch { /* keep raw */ }
        html += `<div class="sp-source-trace-drawer-head"><span>${esc(t('Captured'))}</span><strong>${esc(when)}</strong></div>`;
    }
    if (model.budgetOverflowed) {
        html += `<div class="sp-source-trace-budget">${esc(t('Budget overflowed'))}</div>`;
    }
    if (model.emptyKey) {
        html += `<div class="sp-source-trace-empty">${esc(_emptyMessage(model.emptyKey))}</div>`;
    } else {
        html += '<div class="sp-source-trace-lore">';
        for (const group of model.groups) {
            const attach = group.attachment
                ? `<div class="sp-source-trace-attach">${esc(group.attachment)}</div>`
                : '';
            html += `<div class="sp-source-trace-world"><div class="sp-source-trace-world-title">${esc(group.world)} <span>${group.items.length}</span></div>${attach}`;
            for (const item of group.items) {
                const keysJson = esc(JSON.stringify(Array.isArray(item.matchedKeys) ? item.matchedKeys : []));
                const kind = esc(item.matchKind || 'none');
                const summary = `<span class="sp-source-trace-entry-title">${esc(item.title)}</span><span class="sp-source-trace-entry-key">${esc(item.keyLine)}</span>`;
                const loopLine = item.firstSeenLoop != null
                    ? `<div class="sp-source-trace-meta"><span>${esc(t('Scan loop {{n}} · {{state}}', { n: item.firstSeenLoop, state: '' }).replace(/\s·\s$/, '') || `Loop ${item.firstSeenLoop}`)}</span><strong>${esc(String(item.firstSeenLoop))}</strong></div>`
                    : '';
                if (item.uid) {
                    const tokenLabel = item.tokens == null ? '—' : `~${item.tokens}`;
                    html += `<details class="sp-source-trace-entry" data-matched-keys="${keysJson}" data-match-kind="${kind}"><summary>${summary}</summary><div class="sp-source-trace-row"><div class="sp-source-trace-meta"><span>UID</span><strong>${esc(item.uid)}</strong></div><div class="sp-source-trace-meta"><span>${esc(t('Tokens'))}</span><strong>${esc(tokenLabel)}</strong></div>${loopLine}<div class="sp-source-trace-meta"><span>${esc(item.evidenceLabel || '')}</span></div></div></details>`;
                } else {
                    html += `<div class="sp-source-trace-line" data-matched-keys="${keysJson}" data-match-kind="${kind}">${summary}</div>`;
                }
            }
            html += '</div>';
        }
        html += '</div>';
        if (model.timeline.length) {
            html += '<div class="sp-source-trace-timeline"><div class="sp-source-trace-timeline-title">Timeline</div>';
            for (const loop of model.timeline) {
                html += `<div class="sp-source-trace-timeline-row"><strong>${esc(String(loop.loopCount))}</strong> ${esc(loop.state)} <span>+${(loop.newAcceptedEntryKeys || []).length}</span></div>`;
            }
            html += '</div>';
        }
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
        let messageIds = [];
        try { messageIds = JSON.parse(drawer.getAttribute('data-scan-message-ids') || '[]'); } catch { messageIds = []; }
        try { highlightMatchedKeysInChat(keys, { messageIds }); } catch { /* ignore */ }
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
