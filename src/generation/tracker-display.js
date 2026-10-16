import { TRACKER_MARKER_PAIRS } from './tracker-markers.js';

const registeredFormatters = new WeakSet();
const LEGACY_NAME = 'ScenePulse Tracker Hider';

// Synchronous display-only transform: never consult or modify chat/swipe state.
// Deliberately do not infer trackers from arbitrary JSON or code fences.
export function hideTrackerForDisplay(text, context = {}) {
    if (context.isUser || context.isSystem || context.isReasoning) return text;
    let remaining = text;
    let visible = '';
    while (remaining) {
        let first = -1;
        let pair = null;
        for (const markers of TRACKER_MARKER_PAIRS) {
            const index = remaining.indexOf(markers[0]);
            if (index >= 0 && (first < 0 || index < first)) { first = index; pair = markers; }
        }
        const header = remaining.indexOf('[SCENE TRACKER');
        if (header >= 0 && (first < 0 || header < first)) return visible + remaining.slice(0, header);
        if (first < 0) break;
        visible += remaining.slice(0, first);
        const end = remaining.indexOf(pair[1], first + pair[0].length);
        if (end < 0) return visible;
        remaining = remaining.slice(end + pair[1].length);
    }
    // Buffer only distinctive unfinished markers. A lone brace, Markdown link,
    // emphasis delimiter or ordinary HTML comment is not a tracker.
    for (const [start] of TRACKER_MARKER_PAIRS) {
        const minimum = start.indexOf('SP_') + 3;
        for (let size = start.length - 1; size >= minimum; size--) {
            if (remaining.endsWith(start.slice(0, size))) return visible + remaining.slice(0, -size);
        }
    }
    return visible + remaining;
}

export function supportsTrackerFormatter(formatter) {
    return typeof formatter?.addHook === 'function' && formatter?.stage?.BEFORE_REGEX === 'beforeRegex';
}

export function isTrackerFormatterActive(context = globalThis.SillyTavern?.getContext?.()) {
    return !!context?.messageFormatter && registeredFormatters.has(context.messageFormatter);
}

/** Install once per host formatter. ST 1.19 addHook returns void (no disposer). */
export function initializeTrackerDisplay(context) {
    const formatter = context?.messageFormatter;
    let error = null;
    if (supportsTrackerFormatter(formatter) && !registeredFormatters.has(formatter)) {
        try {
            formatter.addHook(hideTrackerForDisplay, { stage: formatter.stage.BEFORE_REGEX, order: 0 });
            registeredFormatters.add(formatter);
        } catch (cause) { error = cause; }
    }
    const active = isTrackerFormatterActive(context);
    const settings = context?.extensionSettings;
    if (settings) {
        if (!Array.isArray(settings.regex)) settings.regex = [];
        // Remove every copy of our legacy script, preserving unrelated rules.
        for (let i = settings.regex.length - 1; i >= 0; i--) {
            if (settings.regex[i]?.scriptName === LEGACY_NAME) settings.regex.splice(i, 1);
        }
        if (!active) settings.regex.push({
            scriptName: LEGACY_NAME,
            findRegex: '<!--SP_TRACKER_START-->[\\s\\S]*?(<!--SP_TRACKER_END-->|$)|\\{\\{//SP_TRACKER_START\\}\\}[\\s\\S]*?(\\{\\{//SP_TRACKER_END\\}\\}|$)|\\[SCENE TRACKER[^\\]]*\\][\\s\\S]*$|\\{\\s*"time"\\s*:\\s*"\\d{1,2}:\\d{2}[\\s\\S]*$',
            replaceString: '', trimStrings: [], placement: [2], disabled: false,
            markdownOnly: true, promptOnly: false, runOnEdit: true, substituteRegex: 0,
        });
    }
    return { path: active ? 'message-formatter' : 'legacy-regex-dom', error };
}
