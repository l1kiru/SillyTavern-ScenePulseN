// ScenePulse wrapper around vendored jsonrepair 3.15.0.
// Upstream intentionally rejects a few JavaScript-like number/comma forms
// that models occasionally emit. Retry only those two narrow repairs after
// the upstream parser has already failed.

import { jsonrepair as upstreamJsonrepair, JSONRepairError } from './jsonrepair.bundle.mjs';

export { JSONRepairError };

export function jsonrepair(input) {
    try {
        return upstreamJsonrepair(input);
    } catch (firstError) {
        const normalized = String(input)
            .replace(/,\s*,(?=\s*[}\]])/g, ',')
            .replace(/([:\[,]\s*)\+(?=\d)/g, '$1');
        if (normalized === input) throw firstError;
        return upstreamJsonrepair(normalized);
    }
}
