import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const constants = readFileSync(join(root, 'src/constants.js'), 'utf8');
const readme = readFileSync(join(root, 'README.md'), 'utf8');

const forkRepo = 'https://github.com/l1kiru/SillyTavern-ScenePulseN';
const upstreamRepo = 'https://github.com/xenofei/SillyTavern-ScenePulse';

assert.equal(manifest.display_name, 'ScenePulseN');
assert.equal(manifest.homePage, forkRepo);
assert.equal(manifest.minimum_client_version, '1.18.0');
assert.match(manifest.author, /xenofei/);
assert.match(manifest.author, /l1kiru/);

assert.equal(pkg.name, 'sillytavern-scenepulsen');
assert.equal(pkg.version, manifest.version);
assert.equal(pkg.homepage, `${forkRepo}#readme`);
assert.equal(pkg.bugs?.url, `${forkRepo}/issues`);

assert.match(constants, /DEFAULT_EXTENSION_NAME='SillyTavern-ScenePulseN'/);
assert.match(constants, /new URL\('\.\.\/'\s*,\s*import\.meta\.url\)/);
assert.doesNotMatch(constants, /EXTENSION_NAME\s*=\s*'SillyTavern-ScenePulse'/);

assert.ok(readme.includes(`   ${forkRepo}\n`), 'installer URL must target the fork');
assert.ok(readme.includes(`git clone ${forkRepo}`), 'clone command must target the fork');
assert.ok(readme.includes(`${forkRepo}/issues`), 'issue links must target the fork');
assert.ok(readme.includes('ScenePulseN fork maintained by'), 'fork maintainer attribution is required');
assert.ok(readme.includes(`[ScenePulse](${upstreamRepo})`), 'upstream attribution is required');

assert.ok(!readme.includes(`   ${upstreamRepo}\n`), 'installer must not target upstream');
assert.ok(!readme.includes(`git clone ${upstreamRepo}`), 'clone command must not target upstream');

console.log('PASS: ScenePulseN fork metadata and update routing are consistent');
