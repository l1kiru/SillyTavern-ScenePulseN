// Lightweight build timing recorder for generation diagnostics.
// Records metadata only: no prompt, response, profile secrets, or chat text.

const MAX_ENTRIES = 20;
const _entries = [];

function _defaultNow() {
    return globalThis.performance?.now?.() ?? Date.now();
}

function _roundMs(value) {
    return Math.max(0, Math.round(Number(value || 0) * 10) / 10);
}

function _copyExtra(extra) {
    const out = {};
    for (const [key, value] of Object.entries(extra || {})) {
        if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) out[key] = value;
        else if (Array.isArray(value)) out[key] = value.slice(0, 20);
    }
    return out;
}

export function createBuildTiming(metadata = {}, { now = _defaultNow, timestamp = () => new Date().toISOString() } = {}) {
    const origin = now();
    const timing = {
        version: 1,
        generationId: String(metadata.generationId || ''),
        chatKey: String(metadata.chatKey || ''),
        messageId: Number(metadata.messageId),
        swipeId: Math.max(0, Number(metadata.swipeId) || 0),
        mode: String(metadata.mode || 'unknown'),
        partKey: metadata.partKey == null ? null : String(metadata.partKey),
        source: String(metadata.source || 'unknown'),
        transport: String(metadata.transport || 'legacy-global-profile'),
        concurrency: 1,
        startedAt: timestamp(),
        status: 'running',
        wallMs: 0,
        stages: {},
        attempts: [],
    };
    let finished = false;

    function startStage(name) {
        return { name: String(name), startedAtMs: now(), done: false };
    }

    function finishStage(handle, status = 'ok', extra = {}) {
        if (!handle || handle.done) return timing.stages[handle?.name] || null;
        handle.done = true;
        const row = {
            status: String(status || 'ok'),
            durationMs: _roundMs(now() - handle.startedAtMs),
            ..._copyExtra(extra),
        };
        timing.stages[handle.name] = row;
        return row;
    }

    function startAttempt(meta = {}) {
        const startedAtMs = now();
        const row = {
            ..._copyExtra(meta),
            attempt: Math.max(1, Number(meta.attempt) || timing.attempts.length + 1),
            promptMode: String(meta.promptMode || 'json'),
            responseBudget: Math.max(0, Number(meta.responseBudget) || 0),
            inputTokensEstimate: Math.max(0, Number(meta.inputTokensEstimate) || 0),
            startedOffsetMs: _roundMs(startedAtMs - origin),
            requestMs: 0,
            durationMs: 0,
            status: 'running',
        };
        timing.attempts.push(row);
        return { row, startedAtMs, responseAtMs: null, done: false };
    }

    function markAttemptResponse(handle, extra = {}) {
        if (!handle) return 0;
        if (handle.responseAtMs == null) handle.responseAtMs = now();
        handle.row.requestMs = _roundMs(handle.responseAtMs - handle.startedAtMs);
        Object.assign(handle.row, _copyExtra(extra));
        return handle.row.requestMs;
    }

    function finishAttempt(handle, status, extra = {}) {
        if (!handle || handle.done) return handle?.row || null;
        if (handle.responseAtMs == null) markAttemptResponse(handle);
        handle.done = true;
        handle.row.durationMs = _roundMs(now() - handle.startedAtMs);
        handle.row.status = String(status || 'unknown');
        Object.assign(handle.row, _copyExtra(extra));
        return handle.row;
    }

    function finish(status, extra = {}) {
        if (finished) return timing;
        finished = true;
        timing.status = String(status || 'unknown');
        timing.wallMs = _roundMs(now() - origin);
        Object.assign(timing, _copyExtra(extra));
        _entries.push(timing);
        if (_entries.length > MAX_ENTRIES) _entries.splice(0, _entries.length - MAX_ENTRIES);
        return timing;
    }

    return { timing, startStage, finishStage, startAttempt, markAttemptResponse, finishAttempt, finish };
}

export function getBuildTimings() {
    return _entries.slice();
}

export function clearBuildTimings() {
    _entries.length = 0;
}

export function _resetBuildTimingsForTests() {
    _entries.length = 0;
}
