import {test} from 'node:test';
import assert from 'node:assert/strict';
const nodes=new Map();
function element(id){if(!nodes.has(id))nodes.set(id,{id,hidden:false,textContent:'',classList:{add(){},remove(){}},handlers:{},addEventListener(event,fn){this.handlers[event]=fn;},querySelector(selector){return element(id+selector);},setAttribute(){},append(){},click(){},remove(){},showModal(){},close(){}});return nodes.get(id);}
globalThis.document={getElementById:element,querySelectorAll:()=>[],createElement:()=>element('download-link'),body:{append(){}}};
globalThis.window={isSecureContext:true};
let resolveRead;let queue=[];let closed=false;let cancelled=false;
const snapshot={device:'alice-zigbee-aquarium-thermometer',protocol:1,type:'snapshot',firmware:'0.2',uptime_ms:5000,reset_reason:1,probe:'ok',temperature_c:27.25,measurement_age_ms:100,probe_errors:0,report_failures:0,zigbee_joined:true,report_age_ms:null,events:[{seq:1,ms:0,message:'Started'}]};
const reader={read(){if(queue.length)return Promise.resolve(queue.shift());return new Promise(r=>resolveRead=r);},cancel(){cancelled=true;if(resolveRead){resolveRead({done:true});resolveRead=null;}return Promise.resolve();},releaseLock(){}};
const port={readable:{getReader:()=>reader},writable:{getWriter:()=>({async write(bytes){assert.equal(new TextDecoder().decode(bytes),'AQ1 SNAPSHOT\n');const frame={value:new TextEncoder().encode('ordinary log\n@AQ1 '+JSON.stringify(snapshot)+'\n'),done:false};if(resolveRead){resolveRead(frame);resolveRead=null;}else queue.push(frame);},releaseLock(){},async abort(){}})},async open(options){assert.equal(options.baudRate,115200);},async close(){closed=true;}};
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{serial:{requestPort:async()=>port,addEventListener(){}}}});
// Avoid background render/poll timers in this simulated-browser test.
globalThis.setInterval=()=>1;globalThis.clearInterval=()=>{};
let downloaded;
URL.createObjectURL=blob=>{downloaded=blob;return 'blob:test';};URL.revokeObjectURL=()=>{};
await import('../app.js');
test('connects only after matching USB response, renders real value, exports report, closes reader and port',async()=>{
 assert.equal(element('connected-view').hidden,true);
 await element('connect').handlers.click();
 assert.equal(element('connected-view').hidden,false);
 assert.equal(element('firmware').textContent,'0.2');
 assert.equal(element('temperature').textContent,'27,3');
 element('download').handlers.click();
 assert.match(await downloaded.text(),/27,3 °C/);
 element('clear-log').handlers.click();
 assert.equal(element('log').textContent,'Новых событий пока нет.');
 await element('disconnect').handlers.click();
 assert.ok(cancelled);assert.ok(closed);
 assert.equal(element('connected-view').hidden,true);
});
