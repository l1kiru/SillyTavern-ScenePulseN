import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/ui/panel.js', import.meta.url), 'utf8');

assert.doesNotMatch(
    source,
    /const newPanel=\{[^\n]*name:''[^\n]*fields:\[\{key:''/,
    'new custom panels do not start with an impossible empty name/key pair',
);
assert.match(source, /name:draftName/, 'new custom panels receive a unique valid draft name');
assert.match(source, /key:'custom_field_'\+stamp/, 'new custom panels receive a unique valid draft key');

console.log('custom-panel-draft.test.mjs: all tests passed');

assert.match(source, /const previous=captureTrackerStructure\(\);[\s\S]*?_chatPanels\.push\(newPanel\);[\s\S]*?reconcileTrackerStructureChange\(previous\);/, 'adding a panel forces structural reconciliation');
assert.match(source, /r\.className='sp-row sp-cp-display-row'/, 'new panel rows use mobile-safe custom display layout');

const managerSource = fs.readFileSync(new URL('../src/settings-ui/custom-panels.js', import.meta.url), 'utf8');
assert.match(managerSource, /r\.className='sp-row sp-cp-display-row'/, 'live custom-panel refresh keeps mobile-safe row class');


assert.match(managerSource, /delete clone\.sourceLibraryId;[\s\S]*?key:_nextUniqueFieldKey/, 'duplicating a panel detaches library provenance and assigns fresh collision-safe field keys');
assert.match(managerSource, /delBtn\.disabled=libraryPinned/, 'pinned panel delete is disabled instead of silently reverting after sync');
assert.match(managerSource, /rmBtn\.disabled=libraryPinned/, 'pinned panel field removal is disabled');
assert.match(managerSource, /handle\.draggable=!libraryPinned/, 'pinned panel fields cannot be drag-mutated');
assert.match(managerSource, /data-panel-ui-key/, 'panel open state follows stable panel identity');

assert.match(source, /!panel\.sourceLibraryId[\s\S]*?normalizePanelActivationMode\(panel\)==='always'/, 'Characters quick-add avoids pinned and situational Auto panels');
assert.match(source, /replaceBtn\.disabled=entry\.enabled===true/, 'pinned library set cannot be misleadingly applied again as Replace');
assert.match(source, /appendBtn\.disabled=entry\.enabled===true/, 'pinned library set cannot be misleadingly appended as a local duplicate');
assert.match(source, /detachLibraryPanels\(target,entry\.id\)/, 'deleting a library set detaches current-chat copies');
assert.match(source, /validateCustomPanels\(\[panel\]\)[\s\S]*?_commitPanelSet\(validation\.panels,'append'\)/, 'templates use the validated append path');

const customCss = fs.readFileSync(new URL('../css/custom-panels.css', import.meta.url), 'utf8');
assert.doesNotMatch(customCss, /\.sp-cp-disabled \.sp-cp-body \{ display: none !important; \}/, 'disabled panels remain editable while excluded from generation');
assert.match(customCss, /sp-mode-tablet \.sp-section-custom \.sp-cp-display-row/, 'tablet custom rows receive the same stacked label/value layout as phones');
