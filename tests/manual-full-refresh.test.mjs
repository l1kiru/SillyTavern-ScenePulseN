import assert from 'node:assert/strict';
import fs from 'node:fs';

console.log('Manual full refresh contract');

const source = fs.readFileSync(new URL('../src/ui/panel.js', import.meta.url), 'utf8');
const handlerStart = source.indexOf("document.getElementById('sp-tb-regen').addEventListener");
const handlerEnd = source.indexOf('document.getElementById(\'sp-tb-panels\')', handlerStart);
const handler = source.slice(handlerStart, handlerEnd > handlerStart ? handlerEnd : undefined);

assert.ok(handlerStart >= 0, 'toolbar regenerate handler exists');
assert.ok(handler.includes('forceFullStateRefresh();'), 'toolbar regenerate arms a full-state refresh');
assert.ok(
    handler.indexOf('forceFullStateRefresh();') < handler.indexOf("runManualSceneBuild(mesIdx,'manual:full')"),
    'force-full is armed before the manual scene build starts',
);

console.log('  PASS toolbar regenerate forces a full-state build');
