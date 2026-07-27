export function installConsoleIntercept({ onDebug, onLog } = {}) {
    const targets = [
        ['debug', onDebug],
        ['log', onLog],
    ];
    const previous = {};
    const wrappers = {};
    for (const [name, handler] of targets) {
        if (typeof handler !== 'function') continue;
        previous[name] = console[name];
        wrappers[name] = (...args) => {
            try { handler(args); } catch { /* never break host */ }
            return previous[name].apply(console, args);
        };
        console[name] = wrappers[name];
    }
    return () => {
        for (const name of Object.keys(previous)) {
            // Only unwrap if we still own the slot; leave later extension wrappers alone.
            if (console[name] === wrappers[name]) console[name] = previous[name];
        }
    };
}
