import {test} from 'node:test';
import assert from 'node:assert/strict';
const elements=new Map();
function element(id){
 if(!elements.has(id))elements.set(id,{value:'',checked:false,hidden:true,handlers:{},addEventListener(type,fn){this.handlers[type]=fn;}});
 return elements.get(id);
}
const assembly=['board','probe','resistor'].map(element);
const consent=element('install-consent');
element('install-mode').value='initial';
globalThis.document={getElementById:element,querySelectorAll(selector){return selector==='.assembly-check'?assembly:[...assembly,consent];}};
globalThis.window={isSecureContext:true,addEventListener(){}};
Object.defineProperty(globalThis,'navigator',{value:{serial:{}}});
await import('../installer.js');
test('initial install requires assembly and erase consent; update needs no extra checkbox',()=>{
 const start=element('install-start'),mode=element('install-mode');
 assert.equal(start.disabled,true);
 for(const checkbox of assembly){checkbox.checked=true;checkbox.handlers.change();assert.equal(start.disabled,true);}
 consent.checked=true;consent.handlers.change();assert.equal(start.disabled,false);
 assembly[1].checked=false;assembly[1].handlers.change();assert.equal(start.disabled,true);
 mode.value='update';mode.handlers.change();assert.equal(start.disabled,false);

});
