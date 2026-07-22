let mountedStyle=null;
globalThis.document={
    getElementById:id=>id==='sp-theme-style'?mountedStyle:null,
    createElement:()=>({id:'',textContent:'',remove(){mountedStyle=null}}),
    head:{appendChild:node=>{mountedStyle=node}},
};

const { THEMES, applyTheme }=await import('../src/themes.js');
let pass=0;
function ok(name,value){if(!value)throw new Error(name);pass++;console.log('  OK   '+name)}

ok('SillyTavern preset exists',!!THEMES.sillytavern);
ok('native body color is inherited',THEMES.sillytavern.vars['--sp-text']==='var(--SmartThemeBodyColor)');
ok('native font is inherited',THEMES.sillytavern.vars['--sp-font']==='var(--mainFontFamily)');
ok('ScenePulse accent remains readable',THEMES.sillytavern.vars['--sp-accent']==='#4db8a4');
ok('muted copy derives from readable body text',THEMES.sillytavern.vars['--sp-text-dim'].includes('var(--SmartThemeBodyColor)'));

applyTheme('sillytavern');
ok('theme style is mounted',mountedStyle?.id==='sp-theme-style');
ok('theme reaches all ScenePulse surfaces through body',mountedStyle.textContent.includes('body {'));
ok('theme references live SillyTavern variables',mountedStyle.textContent.includes('var(--SmartThemeBlurTintColor)'));

applyTheme('default');
ok('default theme removes overrides',mountedStyle===null);

console.log(`\nPASS ${pass}/${pass}`);
