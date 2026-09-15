// Resolve macros once, before the first await. Lane retries and routing must
// not read another chat's persona or mutable ST variables halfway through.
export function freezePromptMacros(context, sources) {
    const values = new Map();
    const pattern = /\{\{[^{}]*\}\}/g;
    for (const source of sources) {
        const text = typeof source === 'string' ? source : JSON.stringify(source ?? '');
        for (const [macro] of text.matchAll(pattern)) {
            if (values.has(macro)) continue;
            const key = macro.slice(2, -2).trim().toLowerCase();
            const fallback = key === 'user' ? context?.name1 : key === 'char' ? context?.name2 : null;
            const value = typeof context?.substituteParams === 'function'
                ? context.substituteParams(macro)
                : typeof context?.substituteParamsExtended === 'function'
                    ? context.substituteParamsExtended(macro)
                    : fallback ?? macro;
            values.set(macro, String(value ?? ''));
        }
    }
    return text => String(text ?? '').replace(pattern, macro => values.get(macro) ?? macro);
}

export function expandSchemaDescriptions(schema, expand) {
    const result = structuredClone(schema);
    function visit(value) {
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
            if (['description', 'title'].includes(key) && typeof child === 'string') value[key] = expand(child);
            else if (child && typeof child === 'object') visit(child);
        }
    }
    visit(result);
    return result;
}
