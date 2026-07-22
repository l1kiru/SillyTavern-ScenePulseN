import { readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(root);
const files = [];
const syntaxFiles = [join(projectRoot, 'index.js')];

function collect(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) collect(path);
        else if (entry.name.endsWith('.test.mjs')) files.push(path);
    }
}

collect(root);
files.sort();

function collectSyntax(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) collectSyntax(path);
        else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) syntaxFiles.push(path);
    }
}

collectSyntax(join(projectRoot, 'src'));
syntaxFiles.sort();

for (const file of syntaxFiles) {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.status !== 0) {
        console.error(`SYNTAX FAILED: ${relative(projectRoot, file)}`);
        process.exit(result.status || 1);
    }
}

console.log(`PASS: ${syntaxFiles.length}/${syntaxFiles.length} source files passed node --check`);

for (const file of files) {
    const result = spawnSync(process.execPath, [file], { stdio: 'inherit' });
    if (result.status !== 0) {
        console.error(`FAILED: ${relative(root, file)}`);
        process.exit(result.status || 1);
    }
}

console.log(`PASS: ${files.length}/${files.length} test files`);
