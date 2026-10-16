// Exact allowlist: never sweep a storage prefix or touch chat metadata/library.
export const LOCAL_CACHE_KEYS = Object.freeze([
    'scenepulse_config', 'scenepulse_profiles', 'sp_profiles',
    'sp_openrouter_cache_v1', 'scenepulse_crash_log_v1',
    'sp:preset-dismissed', 'sp:v6.23-config-prompts-migration-shown',
]);

export async function cleanExtensionData({ context, local, session, clearDiagnostics }) {
    // Complete remote diagnostics first; an offline server must not silently
    // restore an old log after the next startup.
    await clearDiagnostics();
    for (const key of LOCAL_CACHE_KEYS) local.removeItem(key);
    session.removeItem('sp:preset-shown');
    delete context.extensionSettings.scenepulse;
    // ST's clean lifecycle hook saves settings and reloads after we return.
}
