// Profile-bound request transport for SillyTavern 1.18.0 Connection Manager.
// This module deliberately does not mutate the globally selected profile/preset
// and never calls the global stopGeneration() path.

function _abortError(signal) {
    if (signal?.reason instanceof Error) return signal.reason;
    return new DOMException(String(signal?.reason || 'Aborted'), 'AbortError');
}

export function getConnectionRequestService(stContext = null) {
    const context = stContext ?? globalThis.SillyTavern?.getContext?.();
    const service = context?.ConnectionManagerRequestService;
    if (!service || typeof service.sendRequest !== 'function') {
        throw new Error('SillyTavern ConnectionManagerRequestService is unavailable');
    }
    return service;
}

export function resolveConnectionProfileId(profileRef, service) {
    const value = String(profileRef || '').trim();
    if (!value) throw new Error('A Connection Manager profile is required');
    if (typeof service?.getSupportedProfiles !== 'function') return value;

    const profiles = service.getSupportedProfiles();
    if (!Array.isArray(profiles) || !profiles.length) {
        throw new Error('Connection Manager has no supported profiles');
    }
    if (profiles.some(profile => profile?.id === value)) return value;

    const normalized = value.toLowerCase();
    const match = profiles.find(profile => String(profile?.name || '').trim().toLowerCase() === normalized);
    if (!match?.id) throw new Error(`Connection Manager profile not found: ${value}`);
    return match.id;
}

/**
 * Send one non-streaming request through an explicit Connection Manager profile.
 * The returned `value` matches requestTracker(): string for ordinary output and
 * an object when SillyTavern parsed native structured output.
 */
export async function requestWithConnectionProfile({
    profileId,
    messages,
    maxTokens,
    jsonSchema = null,
    promptMode = 'json',
    signal = null,
    includePreset = true,
    includeInstruct = true,
    instructSettings = {},
    service = null,
    stContext = null,
} = {}) {
    const requestService = service ?? getConnectionRequestService(stContext);
    const resolvedProfileId = resolveConnectionProfileId(profileId, requestService);
    const requestedBudget = Number(maxTokens);
    if (!Number.isFinite(requestedBudget) || requestedBudget <= 0) {
        throw new Error('maxTokens must be a positive number');
    }
    const budget = Math.max(1, Math.floor(requestedBudget));
    if (!Array.isArray(messages) && typeof messages !== 'string') {
        throw new Error('messages must be a prompt string or an array of chat messages');
    }
    if (signal?.aborted) throw _abortError(signal);

    const overridePayload = promptMode === 'native' && jsonSchema
        ? { json_schema: jsonSchema }
        : {};

    try {
        const response = await requestService.sendRequest(
            resolvedProfileId,
            messages,
            budget,
            {
                stream: false,
                signal,
                extractData: true,
                includePreset,
                includeInstruct,
                instructSettings,
            },
            overridePayload,
        );
        if (signal?.aborted) throw _abortError(signal);
        return {
            value: response?.content ?? response,
            reasoning: response?.reasoning ?? '',
            strategy: 'connection-profile',
            profileId: resolvedProfileId,
        };
    } catch (error) {
        // ST wraps provider aborts in `Error("API request failed", { cause })`.
        // Restore a stable abort identity for lane-local cancellation handling.
        if (signal?.aborted) throw _abortError(signal);
        throw error;
    }
}
