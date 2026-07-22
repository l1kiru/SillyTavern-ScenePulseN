#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceFiles = [];

function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) sourceFiles.push(full);
    }
}
walk(path.join(root, 'src'));
sourceFiles.push(path.join(root, 'index.js'));

const keys = new Set();
const dynamic = [];
const patterns = [
    [/\bt\(\s*'((?:\\.|[^'\\])*)'/g, "'"],
    [/\bt\(\s*"((?:\\.|[^"\\])*)"/g, '"'],
    [/\bt\(\s*`([^`]*)`/g, '`'],
];

for (const file of sourceFiles) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [pattern, quote] of patterns) {
        let match;
        while ((match = pattern.exec(source))) {
            if (quote === '`' && match[1].includes('${')) {
                dynamic.push(`${path.relative(root, file)}: ${match[1]}`);
                continue;
            }
            keys.add(Function(`return ${quote}${match[1]}${quote}`)());
        }
    }
}

if (dynamic.length) {
    console.error('Dynamic translation keys are not supported:');
    for (const item of dynamic) console.error(`- ${item}`);
    process.exit(1);
}

const orderedKeys = [...keys].sort((a, b) => a.localeCompare(b, 'en'));
const sourceCatalog = Object.fromEntries(orderedKeys.map(key => [key, key]));
const localesDir = path.join(root, 'locales');
const manifest = JSON.parse(fs.readFileSync(path.join(localesDir, '_manifest.json'), 'utf8'));
const coverage = {
    sourceKeyCount: orderedKeys.length,
    note: 'A value equal to its English key is an explicit English fallback, not a completed translation.',
    languages: {},
};

fs.writeFileSync(path.join(localesDir, '_source.json'), JSON.stringify(sourceCatalog, null, 2) + '\n');

for (const [language, filename] of Object.entries(manifest)) {
    const localePath = path.join(localesDir, filename);
    const existing = JSON.parse(fs.readFileSync(localePath, 'utf8'));
    const synced = {};
    let translated = 0;
    let fallback = 0;
    for (const key of orderedKeys) {
        const value = typeof existing[key] === 'string' && existing[key].trim() ? existing[key] : key;
        synced[key] = value;
        if (value === key) fallback += 1;
        else translated += 1;
    }
    fs.writeFileSync(localePath, JSON.stringify(synced, null, 2) + '\n');
    coverage.languages[language] = {
        file: filename,
        translated,
        fallback,
        coveragePercent: Number((translated / orderedKeys.length * 100).toFixed(1)),
    };
}

fs.writeFileSync(path.join(localesDir, '_coverage.json'), JSON.stringify(coverage, null, 2) + '\n');
console.log(`Synced ${Object.keys(manifest).length} locales to ${orderedKeys.length} source keys.`);
