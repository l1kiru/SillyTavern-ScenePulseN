import { installConsoleIntercept } from './console-intercept.js';
import { parseWiConsoleArgs, probeWiLogFormat, PARSER_ID } from './parsers/st-1-18.js';

let _uninstall = null;
let _status = 'off';
let _unknownStreak = 0;
let _onEvent = null;
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
    _unknownStreak = 0;
    _status = 'active';
    _ring.length = 0;

    const handle = (args) => {
        if (_status !== 'active') return;
        const joined = (Array.isArray(args) ? args : [args]).map(String).join(' ');
        if (!joined.includes('[WI]')) return;
        const parsed = parseWiConsoleArgs(args);
        if (!parsed || parsed.kind === 'other') {
            _unknownStreak++;
            if (_unknownStreak >= 3) {
                const probe = probeWiLogFormat([joined, joined, joined]);
                if (!probe.ok) {
                    _status = 'disabled_unknown_format';
                    stopDiagnostics(false);
                }
            }
            return;
        }
        _unknownStreak = 0;
        _ring.push(parsed);
        if (_ring.length > 50) _ring.shift();
        try { _onEvent?.(parsed); } catch { /* ignore */ }
    };

    _uninstall = installConsoleIntercept({ onDebug: handle, onLog: handle });
    return PARSER_ID;
}

export function stopDiagnostics(resetStatus = true) {
    if (_uninstall) {
        try { _uninstall(); } catch { /* ignore */ }
        _uninstall = null;
    }
    if (resetStatus && _status === 'active') _status = 'off';
}
