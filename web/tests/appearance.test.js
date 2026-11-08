import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAppearanceUI} from '../appearance.js';
const ids=['planted','marine','biotope','reef'];
function fixture(){
 const nodes=new Map();
 function element(id){
  if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false,handlers:{},style:{setProperty(k,v){this[k]=v;},getPropertyValue(k){return this[k];}},classList:{toggle(){}},setAttribute(k,v){this[k]=v;},getAttribute(k){return this[k];},addEventListener(k,fn){this.handlers[k]=fn;}});
  return nodes.get(id);
 }
 const buttons=ids.map(id=>{const e=element('button-'+id);e.dataset={themeChoice:id};e.style['--palette']=id;e['aria-label']=id;return e;});
 const images=ids.map(id=>{const e=element('image-'+id);e.dataset={themeImage:id,themeSrc:id+'.png'};e.decode=async()=>{};return e;});
 element('theme-settings').querySelectorAll=()=>buttons;
 const root={dataset:{}},doc={documentElement:root,getElementById:element,querySelectorAll:()=>images};
 const ui=createAppearanceUI(doc);return {ui,element,buttons,root};
}
const snapshot=(theme,firmware='0.8')=>({firmware,theme_settings:true,settings:{theme}});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('appearance previews, cancels on close, follows save/reset snapshots and leaves no controls for 0.7',async()=>{
 const f=fixture();
 f.ui.sync(snapshot(1),{connected:true,force:true});await flush();
 assert.equal(f.root.dataset.theme,'marine');assert.equal(f.element('theme-settings').hidden,false);
 f.buttons[3].handlers.click();assert.equal(f.ui.loading,true);await flush();
 assert.equal(f.ui.value,3);assert.equal(f.root.dataset.theme,'reef');
 f.ui.sync(snapshot(1),{connected:true,open:true});assert.equal(f.ui.value,3);
 f.element('settings-panel').handlers.close();await flush();
 assert.equal(f.ui.value,1);assert.equal(f.root.dataset.theme,'marine');
 f.buttons[2].handlers.click();await flush();
 f.ui.sync(snapshot(2),{connected:true,open:true,force:true});
 f.element('settings-panel').handlers.close();await flush();assert.equal(f.ui.value,2);
 f.ui.sync(null,{connected:false});await flush();assert.equal(f.root.dataset.theme,'planted');assert.equal(f.element('theme-settings').hidden,true);
 f.element('settings-panel').handlers.close();await flush();assert.equal(f.root.dataset.theme,'planted');
 f.ui.sync(snapshot(2),{connected:true});await flush();assert.equal(f.root.dataset.theme,'biotope');
 f.ui.sync(snapshot(0),{connected:true,force:true});await flush();assert.equal(f.root.dataset.theme,'planted');
 f.ui.sync(snapshot(3),{connected:true,force:true});await flush();
 f.ui.sync(snapshot(3,'0.7'),{connected:true});await flush();
 assert.equal(f.element('theme-settings').hidden,true);assert.equal(f.root.dataset.theme,'planted');assert.equal(f.ui.value,0);
 f.buttons[3].handlers.click();await flush();assert.equal(f.ui.value,0);
});
