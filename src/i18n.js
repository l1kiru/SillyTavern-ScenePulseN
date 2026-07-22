// ScenePulse — Internationalization Module
// Provides t(key) function for UI string translations.
//
// Translation dictionaries live in locales/*.json. The active English
// source catalog is generated from static t() calls by tools/sync-locales.mjs.
// Every locale must contain that exact key set; untranslated values remain
// explicit English fallbacks and are reported in locales/_coverage.json.
//
// Adding a new language: create locales/<language-name>.json, add the
// language name → filename mapping to locales/_manifest.json, translate the
// desired values, then run `npm run sync-locales` and `npm test`.

import { getLanguage } from './settings.js';

// Manifest mapping language display names to JSON filenames
let _manifest = null;
// Cached translation table for the current language
let _cache = null;
const RTL_LANGUAGES = new Set(['Arabic', 'Hebrew']);
let _cachedLang = '';

/**
 * Load the locale manifest (language name → filename mapping).
 * Cached after first call.
 */
async function _loadManifest() {
    if (_manifest) return _manifest;
    try {
        // Resolve the locales/ path relative to the extension root.
        // In SillyTavern, extensions load from /scripts/extensions/third-party/<name>/
        // or /data/default-user/extensions/<name>/. The import.meta.url
        // gives us the current module's URL, from which we can derive
        // the extension root.
        const base = new URL('..', import.meta.url).href;
        const resp = await fetch(base + 'locales/_manifest.json');
        if (resp.ok) _manifest = await resp.json();
        else _manifest = {};
    } catch {
        _manifest = {};
    }
    return _manifest;
}

/**
 * Load a specific language's translation table from its JSON file.
 * Returns the parsed object or an empty object on failure.
 */
async function _loadLocale(langName) {
    const manifest = await _loadManifest();
    const filename = manifest[langName];
    if (!filename) return {};
    try {
        const base = new URL('..', import.meta.url).href;
        const resp = await fetch(base + 'locales/' + filename);
        if (resp.ok) return await resp.json();
    } catch { /* network or parse failure — fall back to English */ }
    return {};
}


/** Return whether a configured ScenePulse language uses right-to-left text. */
export function isRtlLanguage(langName = getLanguage()) {
    return RTL_LANGUAGES.has(langName);
}

/**
 * Scope text direction to ScenePulse surfaces without changing SillyTavern itself.
 * A body class covers UI elements created after initialization as well.
 */
function _applyDirection(langName) {
    if (typeof document === 'undefined') return;
    const rtl = isRtlLanguage(langName);
    document.body?.classList.toggle('sp-locale-rtl', rtl);
    for (const el of document.querySelectorAll('#sp-panel, #scenepulse-settings, #sp-thought-panel, .sp-dialog-overlay, .sp-overlay')) {
        el.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    }
}

/**
 * Translate a UI string. Returns translation if available, otherwise
 * the English key as fallback. Synchronous — uses a pre-loaded cache.
 * Call initI18n() at startup to warm the cache before first render.
 * @param {string} key - English string to translate
 * @returns {string} Translated string or English fallback
 */
export function t(key, values) {
    let text = (!_cache || !_cachedLang) ? key : (_cache[key] || key);
    if (values && typeof values === 'object') {
        text = text.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) =>
            Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match);
    }
    return text;
}

/**
 * Initialize the translation cache for the current language setting.
 * Should be called once at extension startup, before the first render.
 * Safe to call multiple times (re-fetches if language changed).
 */
export async function initI18n() {
    const lang = getLanguage();
    if (!lang) { _cache = null; _cachedLang = ''; _applyDirection(''); return; }
    if (lang === _cachedLang && _cache) return; // already loaded
    _cache = await _loadLocale(lang);
    _cachedLang = lang;
    _applyDirection(lang);
}

/** Reset cached language (call when language setting changes). */
export function resetI18nCache() {
    _cachedLang = '';
    _cache = null;
    _applyDirection('');
}
