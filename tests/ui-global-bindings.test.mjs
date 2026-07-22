// Source-level regression checks for settings UI global listener lifecycle.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../src/settings-ui/bind-ui.js'), 'utf8');

let pass = 0;
function ok(name, value) {
    if (!value) throw new Error(name);
    pass++;
    console.log('  OK   ' + name);
}

const keydownRegistrations = source.match(/document\.addEventListener\('keydown'/g) || [];
ok('only one keydown registration site remains', keydownRegistrations.length === 1);
ok('keydown registration is guarded', source.includes('if(!_globalDebugShortcutBound)'));
ok('global bindings are refreshed from bindUI', source.includes('_ensureGlobalBindings();'));
ok('crash callback resolves current badge element', source.includes("document.getElementById('sp-crash-log-count')"));
ok('crash callback resolves current inspector button', source.includes("document.getElementById('sp-btn-debug-inspector')"));
ok('crash listener unsubscribe is retained', source.includes('_crashLogUnsubscribe=m.addChangeListener'));
ok('dispose path removes the shortcut', source.includes("document.removeEventListener('keydown',_onGlobalDebugShortcut)"));
ok('language rebuild does not call loadUI twice', !source.includes('createSettings();loadUI();'));

console.log(`\nPASS ${pass}/${pass}`);
