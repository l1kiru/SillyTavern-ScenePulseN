import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const files = [];
function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) files.push(full);
    }
}
walk(path.join(root, 'src'));
files.push(path.join(root, 'index.js'));

const keys = new Set();
const dynamic = [];
const patterns = [
    [/\bt\(\s*'((?:\\.|[^'\\])*)'/g, "'"],
    [/\bt\(\s*"((?:\\.|[^"\\])*)"/g, '"'],
    [/\bt\(\s*`([^`]*)`/g, '`'],
];
for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [pattern, quote] of patterns) {
        let match;
        while ((match = pattern.exec(source))) {
            if (quote === '`' && match[1].includes('${')) {
                dynamic.push(path.relative(root, file));
                continue;
            }
            keys.add(Function(`return ${quote}${match[1]}${quote}`)());
        }
    }
}

function placeholders(text) {
    return [...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(m => m[1]).sort();
}
function htmlTags(text) {
    return [...text.matchAll(/<\/?[A-Za-z][^>]*>/g)].map(m => m[0]).sort();
}
function sameArray(a, b) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

const expected = [...keys].sort((a, b) => a.localeCompare(b, 'en'));
const sourceCatalog = JSON.parse(fs.readFileSync(path.join(root, 'locales/_source.json'), 'utf8'));
const sourceKeys = Object.keys(sourceCatalog);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'locales/_manifest.json'), 'utf8'));
const coverage = JSON.parse(fs.readFileSync(path.join(root, 'locales/_coverage.json'), 'utf8'));
const failures = [];

if (dynamic.length) failures.push(`dynamic t() keys: ${dynamic.join(', ')}`);
if (!sameArray(sourceKeys, expected)) failures.push('_source.json does not match static t() keys');
if (coverage.sourceKeyCount !== expected.length) failures.push('_coverage.json sourceKeyCount is stale');

for (const [language, filename] of Object.entries(manifest)) {
    const locale = JSON.parse(fs.readFileSync(path.join(root, 'locales', filename), 'utf8'));
    const localeKeys = Object.keys(locale);
    if (!sameArray(localeKeys, expected)) {
        const missing = expected.filter(key => !Object.hasOwn(locale, key));
        const extra = localeKeys.filter(key => !keys.has(key));
        failures.push(`${language}: key mismatch; missing=${missing.length}, extra=${extra.length}`);
        continue;
    }

    let translated = 0;
    let fallback = 0;
    for (const key of expected) {
        const value = locale[key];
        if (typeof value !== 'string' || !value.trim()) failures.push(`${language}: empty/non-string value for ${JSON.stringify(key)}`);
        if (!sameArray(placeholders(key), placeholders(value))) failures.push(`${language}: placeholder mismatch for ${JSON.stringify(key)}`);
        if (!sameArray(htmlTags(key), htmlTags(value))) failures.push(`${language}: HTML tag mismatch for ${JSON.stringify(key)}`);
        if (value === key) fallback += 1;
        else translated += 1;
    }

    const reported = coverage.languages?.[language];
    if (!reported || reported.file !== filename || reported.translated !== translated || reported.fallback !== fallback) {
        failures.push(`${language}: _coverage.json entry is stale`);
    }
}

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}

console.log(`OK ${Object.keys(manifest).length} locales cover ${expected.length} static UI strings; placeholders and HTML tags are preserved`);
