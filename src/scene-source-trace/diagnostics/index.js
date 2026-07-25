import { installConsoleIntercept } from './console-intercept.js';
import {
    parseWiConsoleArgs,
    resetParserContext,
    KNOWN_WI_KINDS,
    PARSER_ID,
} from './parsers/st-1-18.js';

let _uninstall = null;
/** @type {'off'|'active'|'ok'|'disabled_unknown_format'} */
let _status = 'off';
let _onEvent = null;
/** @type {Array<{ raw: string, parsed: object|null }>} */
const _ring = [];

export function getDiagnosticsStatus() {
    return _status;
}

export function getDiagnosticRing() {
    return _ring.slice();
}

export function startDiagnostics({ enabled = false, onEvent = null } = {}) {
    stopDiagnostics();
    if (!enabled) {
        _status = 'off';
        return;
    }
    _onEvent = onEvent;
    _status = 'active';
    _ring.length = 0;
    resetParserContext();

    const handle = (args) => {
        if (_status !== 'active') return;
        const joined = (Array.isArray(args) ? args : [args]).map(String).join(' ');
        if (!joined.includes('[WI]')) return;
        const parsed = parseWiConsoleArgs(args);
        _ring.push({ raw: joined, parsed });
        if (_ring.length > 50) _ring.shift();

        if (!parsed || !KNOWN_WI_KINDS.has(parsed.kind)) {
            return;
        }
        try { _onEvent?.(parsed); } catch { /* ignore */ }
    };

    _uninstall = installConsoleIntercept({ onDebug: handle, onLog: handle });
    return PARSER_ID;
}

/**
 * End capture and classify format from the ring (no mid-scan disable).
 * @returns {'off'|'active'|'ok'|'disabled_unknown_format'}
 */
export function stopDiagnostics() {
    if (_status === 'active') {
        const wiLineCount = _ring.length;
        const knownCount = _ring.filter(item => KNOWN_WI_KINDS.has(item.parsed?.kind)).length;
        if (knownCount > 0) _status = 'ok';
        else if (wiLineCount > 0) _status = 'disabled_unknown_format';
        else _status = 'off';
    }

    if (_uninstall) {
        try { _uninstall(); } catch { /* ignore */ }
        _uninstall = null;
    }
    _onEvent = null;
    resetParserContext();
    return _status;
}
