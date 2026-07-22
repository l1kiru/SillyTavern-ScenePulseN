import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const constants = readFileSync(join(root, 'src/constants.js'), 'utf8');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const bindUi = readFileSync(join(root, 'src/settings-ui/bind-ui.js'), 'utf8');

const expected = '7.0.0';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

assert(manifest.version === expected, `manifest version must be ${expected}`);
assert(constants.includes(`export const VERSION = '${expected}';`), 'runtime VERSION must match manifest');
assert(readme.includes(`Latest: v${expected}`), 'README latest version must match manifest');
assert(changelog.includes(`### [${expected}]`), 'CHANGELOG must contain current release');
assert(bindUi.includes('version:VERSION'), 'configuration exports must use runtime VERSION');
assert(!bindUi.includes("version:'6.0.0'"), 'stale configuration export version must be removed');

console.log(`PASS: release version is consistently v${expected}`);
