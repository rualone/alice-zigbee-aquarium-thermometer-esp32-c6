import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createThemeController,supportsDeviceTheme,createThemeDraft,THEMES,createThemeDisclosure} from '../themes.js';
function image(id,decode=async()=>{}){
 const classes=new Set(id==='planted'?['is-active']:[]),attributes={};
 return {dataset:{themeImage:id,themeSrc:`assets/themes/${id}.png`},classes,attributes,
  getAttribute(key){return attributes[key];},setAttribute(key,value){attributes[key]=value;},decode,
  classList:{toggle(key,active){active?classes.add(key):classes.delete(key);}}};
}
function fixture(images){
 const root={dataset:{}},buttons=THEMES.map(theme=>({dataset:{themeChoice:theme.id},setAttribute(k,v){this[k]=v;}}));
 let errors=0;
 const controller=createThemeController({root,images,buttons,onError(){errors++;}});
 return {root,buttons,controller,get errors(){return errors;}};
}
test('theme colours, illustration and pressed state change together only after decoding',async()=>{
 let finish;
 const planted=image('planted'),marine=image('marine',()=>new Promise(resolve=>finish=resolve));
 const f=fixture([planted,marine]);
 const changing=f.controller.select('marine');
 assert.equal(marine.attributes.src,'assets/themes/marine.png');
 assert.equal(f.controller.current,'planted');assert.ok(planted.classes.has('is-active'));
 finish();assert.equal(await changing,true);
 assert.equal(f.root.dataset.theme,'marine');assert.equal(f.controller.current,'marine');
 assert.ok(marine.classes.has('is-active'));assert.ok(!planted.classes.has('is-active'));
 assert.equal(f.buttons[1]['aria-pressed'],'true');assert.equal(f.buttons[0]['aria-pressed'],'false');
});
test('a late image decode cannot overwrite the most recent selection',async()=>{
 let finish;
 const f=fixture([image('planted'),image('marine',()=>new Promise(resolve=>finish=resolve)),image('reef')]);
 const slow=f.controller.select('marine');await f.controller.select('reef');finish();
 assert.equal(await slow,false);assert.equal(f.root.dataset.theme,'reef');
});
test('failed images and unknown themes leave the current theme intact',async()=>{
 const f=fixture([image('planted'),image('marine',async()=>{throw Error('missing');})]);
 assert.equal(await f.controller.select('other'),false);
 assert.equal(await f.controller.select('marine'),false);
 assert.equal(f.controller.current,'planted');assert.equal(f.errors,1);
});
test('device themes require firmware 0.8+ and explicit capability; older versions always use planted',()=>{
 const snapshot={firmware:'0.8',theme_settings:true,settings:{theme:3}};
 assert.equal(supportsDeviceTheme(snapshot),true);
 for(const firmware of ['0.1','0.7','0.7.9','0.8-dev','bad'])assert.equal(supportsDeviceTheme({...snapshot,firmware}),false);
 for(const firmware of ['0.8','0.8.1','0.10','1.0'])assert.equal(supportsDeviceTheme({...snapshot,firmware}),true);
 for(const patch of [{theme_settings:false},{theme_settings:undefined},{settings:{theme:99}},{settings:{theme:'1'}}])assert.equal(supportsDeviceTheme({...snapshot,...patch}),false);
 const draft=createThemeDraft();draft.receive(snapshot,{connected:true});assert.equal(draft.value,3);
 draft.receive({...snapshot,firmware:'0.7'},{connected:true});assert.equal(draft.supported,false);assert.equal(draft.value,0);assert.equal(draft.choose(2),false);
});
test('theme draft previews without saving, cancels, follows confirmed snapshots and resets',()=>{
 const draft=createThemeDraft(),snapshot=theme=>({firmware:'0.8',theme_settings:true,settings:{theme}});
 draft.receive(snapshot(1),{connected:true});assert.equal(draft.value,1);
 draft.choose(3);draft.receive(snapshot(1),{connected:true,open:true});assert.equal(draft.value,3);
 draft.cancel();assert.equal(draft.value,1);
 draft.choose(2);draft.receive(snapshot(2),{connected:true,open:true,force:true});draft.cancel();assert.equal(draft.value,2);
 draft.receive(null,{connected:false});assert.equal(draft.value,0);assert.equal(draft.supported,false);
 draft.cancel();assert.equal(draft.value,0);
 draft.receive(snapshot(2),{connected:true});assert.equal(draft.value,2);
 draft.choose(3);draft.receive(snapshot(0),{connected:true,open:true,force:true});assert.equal(draft.value,0);
});

test('both the page illustration and settings preview switch to the same theme',async()=>{
 const page=image('marine'),settings=image('marine');
 const f=fixture([image('planted'),page,settings]);
 assert.equal(await f.controller.select('marine'),true);
 assert.ok(page.classes.has('is-active'));assert.ok(settings.classes.has('is-active'));
 assert.equal(page.attributes.src,settings.attributes.src);
});

test('appearance starts collapsed, excludes hidden controls from focus and resets on reopening',()=>{
 const classes=new Set(),panel={classList:{toggle(key,value){value?classes.add(key):classes.delete(key);}}};
 const button={setAttribute(key,value){this[key]=value;}},content={};
 const disclosure=createThemeDisclosure({panel,button,content});
 assert.equal(button['aria-expanded'],'false');assert.equal(content.inert,true);
 disclosure.toggle();assert.equal(button['aria-expanded'],'true');assert.equal(content.inert,false);assert.ok(classes.has('is-expanded'));
 disclosure.setExpanded(false);assert.equal(button['aria-expanded'],'false');assert.equal(content.inert,true);assert.ok(!classes.has('is-expanded'));
});
