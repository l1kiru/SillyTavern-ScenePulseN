// Runtime API inspection. Version labels never select an implementation path.
import { supportsTrackerFormatter, isTrackerFormatterActive } from './generation/tracker-display.js';
export function inspectStCapabilities(context, versionDisplay = '') {
    const version = [context?.version, versionDisplay]
        .find(value => typeof value === 'string' && value.trim());
    const formatter = context?.messageFormatter;
    const canSubscribe = typeof context?.eventSource?.on === 'function';
    // Match index.js: it subscribes through event_types, not an inferred alias.
    const events = Object.fromEntries([
        'APP_READY', 'CHARACTER_MESSAGE_RENDERED', 'STREAM_TOKEN_RECEIVED',
        'GENERATION_ENDED', 'GENERATION_STOPPED', 'CHAT_CHANGED',
        'MESSAGE_UPDATED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED', 'MESSAGE_SWIPE_DELETED',
        'WORLD_INFO_ACTIVATED', 'WORLDINFO_SCAN_DONE', 'WORLDINFO_ENTRIES_LOADED',
        'WORLDINFO_FORCE_ACTIVATE', 'CHAT_COMPLETION_PROMPT_READY',
        'GENERATE_AFTER_COMBINE_PROMPTS', 'GENERATE_AFTER_DATA', 'CHAT_COMPLETION_SETTINGS_READY',
    ].map(name => [name, canSubscribe && typeof context?.event_types?.[name] === 'string'
        && context.event_types[name].length > 0]));
    return {
        version: version?.trim() || null,
        formatter: {
            available: supportsTrackerFormatter(formatter),
        },
        // Report the installed implementation, even when a newer host offers hooks.
        displayPath: isTrackerFormatterActive(context) ? 'message-formatter' : 'legacy-regex-dom',
        rawGeneration: getRawGenerationStrategy(context),
        connectionProfile: typeof context?.ConnectionManagerRequestService?.sendRequest === 'function',
        events,
    };
}

export function getRawGenerationStrategy(context) {
    if (typeof context?.generateRawData === 'function') return 'raw-data';
    if (typeof context?.generateRaw === 'function') return 'raw';
    if (typeof context?.generateQuietPrompt === 'function') return 'quiet';
    return 'unavailable';
}

// Read fresh on demand; do not cache API availability or serialize the ST context.
export function readStCapabilities() {
    let context = null;
    let versionDisplay = '';
    try { context = globalThis.SillyTavern?.getContext?.(); } catch {}
    try { versionDisplay = globalThis.document?.getElementById('version_display')?.textContent || ''; } catch {}
    return inspectStCapabilities(context, versionDisplay);
}
