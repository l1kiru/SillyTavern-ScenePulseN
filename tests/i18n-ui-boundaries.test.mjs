import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const checks = [
    ['src/ui/section.js', "t('Refresh {title}'"],
    ['src/ui/section.js', "t('Refreshing {title}'"],
    ['src/settings-ui/create-settings.js', "title=\"${t('Reset to 1.0x')}\""],
    ['src/ui/update-panel.js', "detailEl.dataset.placeholder=t('Quest details')"],
    ['src/ui/update-panel.js', "ttVal.dataset.placeholder=t('Time Known')"],
    ['src/ui/update-panel.js', "esc(t('Paste to message box (edit before sending)'))"],
    ['src/ui/update-panel.js', "esc(t('Send immediately and generate'))"],
    ['src/ui/update-panel.js', "t('Source: {source}'"],
    ['src/ui/panel.js', "t('DEV: Weather overlays')"],
    ['src/slash-commands.js', "${t('Source')}:"],
];

for (const [file, snippet] of checks) {
    if (!read(file).includes(snippet)) {
        console.error(`${file} is missing localized UI boundary: ${snippet}`);
        process.exit(1);
    }
}

const i18n = read('src/i18n.js');
const style = read('style.css');
const rtl = read('css/rtl.css');
if (!i18n.includes("new Set(['Arabic', 'Hebrew'])") || !i18n.includes("classList.toggle('sp-locale-rtl'")) {
    console.error('RTL language handling is missing from src/i18n.js');
    process.exit(1);
}
if (!style.includes("@import url('./css/rtl.css')") || !rtl.includes('.sp-locale-rtl #sp-panel')) {
    console.error('Scoped RTL stylesheet is not wired');
    process.exit(1);
}

console.log('OK hardcoded UI boundaries use i18n and Arabic/Hebrew have scoped RTL support');
