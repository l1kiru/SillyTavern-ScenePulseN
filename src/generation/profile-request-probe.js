// Manual Phase 1 transport probe. It is intentionally disconnected from normal
// ScenePulse generation and runs only through the explicit slash command.

import { requestWithConnectionProfile } from './profile-request.js';

const PROBE_SCHEMA = Object.freeze({
    name: 'scenepulse_transport_probe',
    description: 'Tiny response used to measure profile-bound request behavior.',
    strict: false,
    returnInvalid: true,
    value: {
        type: 'object',
        properties: {
            probeId: { type: 'string' },
            ok: { type: 'boolean' },
        },
        required: ['probeId', 'ok'],
        additionalProperties: false,
    },
});

function _now() {
    return globalThis.performance?.now?.() ?? Date.now();
}

function _errorInfo(error) {
    const chain = [];
    let item = error;
    for (let depth = 0; item && depth < 4; depth++) {
        chain.push({ name: String(item.name || 'Error'), message: String(item.message || item) });
        item = item.cause;
    }
    return chain;
}

function _probePayload(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    const text = String(value ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function _messages(probeId) {
    return [
        { role: 'system', content: 'Return only the requested tiny JSON object. Do not add prose or markdown.' },
        { role: 'user', content: `Return exactly {"probeId":"${probeId}","ok":true}.` },
    ];
}

async function _measureRequest({
    probeId,
    profileId,
    promptMode,
    maxTokens,
    controller,
    timeoutMs,
    service,
    stContext,
    now,
}) {
    const startedAtMs = now();
    const timeout = setTimeout(() => {
        try { controller.abort(new DOMException('Transport probe timeout', 'TimeoutError')); } catch {}
    }, timeoutMs);
    try {
        const response = await requestWithConnectionProfile({
            profileId,
            messages: _messages(probeId),
            maxTokens,
            jsonSchema: PROBE_SCHEMA,
            promptMode,
            signal: controller.signal,
            service,
            stContext,
        });
        const endedAtMs = now();
        const payload = _probePayload(response.value);
        return {
            probeId,
            status: 'fulfilled',
            startedAtMs,
            endedAtMs,
            durationMs: Math.max(0, endedAtMs - startedAtMs),
            payloadValid: payload?.probeId === probeId && payload?.ok === true,
            payload,
            strategy: response.strategy,
        };
    } catch (error) {
        const endedAtMs = now();
        return {
            probeId,
            status: 'rejected',
            startedAtMs,
            endedAtMs,
            durationMs: Math.max(0, endedAtMs - startedAtMs),
            aborted: controller.signal.aborted,
            error: _errorInfo(error),
        };
    } finally {
        clearTimeout(timeout);
    }
}

function _pairMetrics(requests) {
    const firstStart = Math.min(...requests.map(item => item.startedAtMs));
    const lastEnd = Math.max(...requests.map(item => item.endedAtMs));
    const wallMs = Math.max(0, lastEnd - firstStart);
    const durationSumMs = requests.reduce((sum, item) => sum + item.durationMs, 0);
    const overlapMs = Math.max(0,
        Math.min(...requests.map(item => item.endedAtMs))
        - Math.max(...requests.map(item => item.startedAtMs)),
    );
    const shortestMs = Math.min(...requests.map(item => item.durationMs));
    const allFulfilled = requests.every(item => item.status === 'fulfilled');
    return {
        wallMs,
        durationSumMs,
        overlapMs,
        concurrencyFactor: wallMs > 0 ? durationSumMs / wallMs : 0,
        likelyParallel: allFulfilled
            && shortestMs > 0
            && overlapMs >= shortestMs * 0.5
            && wallMs <= durationSumMs * 0.8,
    };
}

/**
 * Run four cheap live requests in two pairs:
 *  - native-schema A+B for overlap measurement;
 *  - JSON-only A+B with A aborted to prove lane-local abort isolation.
 */
export async function runProfileTransportProbe({
    profileId,
    maxTokens = 96,
    abortAfterMs = 75,
    timeoutMs = 60000,
    service = null,
    stContext = null,
    now = _now,
} = {}) {
    const overlapControllers = [new AbortController(), new AbortController()];
    const overlapRequests = await Promise.all([
        _measureRequest({ probeId: 'overlap-a', profileId, promptMode: 'native', maxTokens, controller: overlapControllers[0], timeoutMs, service, stContext, now }),
        _measureRequest({ probeId: 'overlap-b', profileId, promptMode: 'native', maxTokens, controller: overlapControllers[1], timeoutMs, service, stContext, now }),
    ]);
    const overlap = { requests: overlapRequests, ..._pairMetrics(overlapRequests) };

    const abortControllers = [new AbortController(), new AbortController()];
    const abortRequestsPromise = Promise.all([
        _measureRequest({ probeId: 'abort-a', profileId, promptMode: 'json', maxTokens, controller: abortControllers[0], timeoutMs, service, stContext, now }),
        _measureRequest({ probeId: 'abort-survivor', profileId, promptMode: 'json', maxTokens, controller: abortControllers[1], timeoutMs, service, stContext, now }),
    ]);
    const abortTimer = setTimeout(() => {
        try { abortControllers[0].abort(new DOMException('Intentional probe abort', 'AbortError')); } catch {}
    }, Math.max(0, Number(abortAfterMs) || 0));
    const abortRequests = await abortRequestsPromise;
    clearTimeout(abortTimer);

    const aborted = abortRequests.find(item => item.probeId === 'abort-a');
    const survivor = abortRequests.find(item => item.probeId === 'abort-survivor');
    const abortIsolation = {
        requests: abortRequests,
        requestedAbortAfterMs: abortAfterMs,
        isolated: aborted?.status === 'rejected'
            && aborted?.aborted === true
            && survivor?.status === 'fulfilled'
            && survivor?.payloadValid === true,
    };

    const nativeSchemaWorks = overlapRequests.every(item => item.status === 'fulfilled' && item.payloadValid);
    const jsonModeWorks = survivor?.status === 'fulfilled' && survivor?.payloadValid === true;
    return {
        profileId,
        requestedMaxTokens: maxTokens,
        overlap,
        abortIsolation,
        gate: {
            providerOverlap: overlap.likelyParallel,
            independentAbort: abortIsolation.isolated,
            nativeSchema: nativeSchemaWorks,
            jsonMode: jsonModeWorks,
            go: overlap.likelyParallel && abortIsolation.isolated && nativeSchemaWorks && jsonModeWorks,
        },
    };
}
