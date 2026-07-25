/** Map ST world_info_* fields → v3 settings. Tests inject plain objects. */
export function snapshotWorldInfoSettings(raw = {}) {
    const n = (value, fallback = null) => {
        if (value == null || value === '') return fallback;
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    };
    return {
        scanDepth: n(raw.world_info_depth ?? raw.scanDepth),
        minActivations: n(raw.world_info_min_activations ?? raw.minActivations),
        recursive: !!(raw.world_info_recursive ?? raw.recursive),
        recursionLimit: n(raw.world_info_max_recursion_steps ?? raw.recursionLimit),
        includeNames: !!(raw.world_info_include_names ?? raw.includeNames),
        matchWholeWords: !!(raw.world_info_match_whole_words ?? raw.matchWholeWords),
        caseSensitive: !!(raw.world_info_case_sensitive ?? raw.caseSensitive),
        budget: n(raw.world_info_budget ?? raw.budget),
        budgetCap: n(raw.world_info_budget_cap ?? raw.budgetCap),
        characterStrategy: n(raw.world_info_character_strategy ?? raw.characterStrategy),
    };
}

/** Browser: read ST DOM inputs. Returns {} when document/inputs unavailable. */
export function readWiSettingsFromDom(doc = globalThis.document) {
    if (!doc?.querySelector) return {};
    const val = (sel) => {
        const el = doc.querySelector(sel);
        if (!el) return undefined;
        if (el.type === 'checkbox') return !!el.checked;
        return el.value;
    };
    return {
        world_info_depth: val('#world_info_depth'),
        world_info_min_activations: val('#world_info_min_activations'),
        world_info_budget: val('#world_info_budget'),
        world_info_include_names: val('#world_info_include_names'),
        world_info_recursive: val('#world_info_recursive'),
        world_info_case_sensitive: val('#world_info_case_sensitive'),
        world_info_match_whole_words: val('#world_info_match_whole_words'),
        world_info_budget_cap: val('#world_info_budget_cap'),
        world_info_character_strategy: val('#world_info_character_strategy'),
        world_info_max_recursion_steps: val('#world_info_max_recursion_steps'),
    };
}
