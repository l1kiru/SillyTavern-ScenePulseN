export function installConsoleIntercept({ onDebug, onLog } = {}) {
    const targets = [
        ['debug', onDebug],
        ['log', onLog],
    ];
    const previous = {};
    for (const [name, handler] of targets) {
        if (typeof handler !== 'function') continue;
        previous[name] = console[name];
        console[name] = (...args) => {
            try { handler(args); } catch { /* never break host */ }
            return previous[name].apply(console, args);
        };
    }
    return () => {
        for (const name of Object.keys(previous)) console[name] = previous[name];
    };
}
