import {test} from 'node:test';
import assert from 'node:assert/strict';
const nodes=new Map();
function element(id){if(!nodes.has(id))nodes.set(id,{id,hidden:false,value:'',style:{},open:false,disabled:false,textContent:'',classList:{add(){},remove(){}},handlers:{},addEventListener(event,fn){this.handlers[event]=fn;},querySelector(selector){return element(id+selector);},setAttribute(){},append(){},click(){},remove(){},showModal(){this.open=true;},close(){this.open=false;},reportValidity(){return true;}});return nodes.get(id);}
globalThis.document={getElementById:element,querySelectorAll:()=>[],createElement:()=>element('download-link'),body:{append(){}}};
globalThis.window={isSecureContext:true};
const sent=[];
let resolveRead;let queue=[];let closed=false;let cancelled=false;
const snapshot={device:'alice-zigbee-aquarium-thermometer',protocol:1,type:'snapshot',firmware:'0.3',raw_temperature_c:27.25,applied_offset_centi:0,sample_interval_ms:5000,settings:{brightness:25,sample_seconds:5,report_seconds:60,delta_centi:20,offset_centi:0},uptime_ms:5000,reset_reason:1,probe:'ok',temperature_c:27.25,measurement_age_ms:100,probe_errors:0,report_failures:0,zigbee_joined:true,report_age_ms:null,events:[{seq:1,ms:0,message:'Started'}]};
const reader={read(){if(queue.length)return Promise.resolve(queue.shift());return new Promise(r=>resolveRead=r);},cancel(){cancelled=true;if(resolveRead){resolveRead({done:true});resolveRead=null;}return Promise.resolve();},releaseLock(){}};
const port={readable:{getReader:()=>reader},writable:{getWriter:()=>({async write(bytes){const command=new TextDecoder().decode(bytes).trim();
if(command.startsWith('AQ1 SETTINGS ')) {
 const value=JSON.parse(command.slice(13));
 sent.push(value);snapshot.settings=value;
 const ack={value:new TextEncoder().encode('@AQSET {"ok":true}\n'),done:false};
 if(resolveRead){resolveRead(ack);resolveRead=null;}else queue.push(ack);
} else assert.equal(command,'AQ1 SNAPSHOT');
const frame={value:new TextEncoder().encode('ordinary log\n@AQ1 '+JSON.stringify(snapshot)+'\n'),done:false};if(resolveRead){resolveRead(frame);resolveRead=null;}else queue.push(frame);},releaseLock(){},async abort(){}})},async open(options){assert.equal(options.baudRate,115200);},async close(){closed=true;}};
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{serial:{requestPort:async()=>port,addEventListener(){}}}});
// Avoid background render/poll timers in this simulated-browser test.
globalThis.setInterval=()=>1;globalThis.clearInterval=()=>{};
let downloaded;
URL.createObjectURL=blob=>{downloaded=blob;return 'blob:test';};URL.revokeObjectURL=()=>{};
await import('../app.js');

test('settings load before dirty tracking, save on change, and preserve calibration during other edits',async()=>{
 await element('connect').handlers.click();
 assert.equal(element('settings-save').disabled,true);
 assert.equal(element('setting-brightness').value,2);
 assert.equal(element('sample-description').textContent,'5 с');
 element('settings-open').handlers.click();
 assert.equal(element('calibration-reference').textContent,'27,3 °C');
 element('calibration-plus').handlers.click();
 assert.equal(element('calibration-offset').textContent,'+0,1 °C');
 assert.equal(element('settings-save').disabled,false);
 element('calibration-minus').handlers.click();
 assert.equal(element('settings-save').disabled,true);
 // The reference is frozen even if the next measurement changes.
 snapshot.raw_temperature_c=28; snapshot.temperature_c=28;
 element('calibration-plus').handlers.click();
 assert.equal(element('calibration-reference').textContent,'27,4 °C');
 await element('settings-form').handlers.submit({preventDefault(){}});
 assert.equal(sent.at(-1).offset_centi,10);
 assert.equal(element('toast').textContent,'Настройки сохранены');
 assert.equal(element('settings-save').disabled,true);
 // Changing another parameter must not erase the existing correction.
 element('setting-brightness').handlers.input({target:{value:'3'}});
 await element('settings-form').handlers.submit({preventDefault(){}});
 assert.equal(sent.at(-1).brightness,100);
 assert.equal(sent.at(-1).offset_centi,10);
 element('settings-close').handlers.click();
 element('settings-open').handlers.click();
 assert.equal(element('calibration-reference').textContent,'28,1 °C');
 for(let i=0;i<70;i++)element('calibration-plus').handlers.click();
 assert.equal(element('calibration-offset').textContent,'+5,0 °C');
 assert.equal(element('calibration-plus').disabled,true);
 for(let i=0;i<120;i++)element('calibration-minus').handlers.click();
 assert.equal(element('calibration-offset').textContent,'-5,0 °C');
 assert.equal(element('calibration-minus').disabled,true);
 await element('disconnect').handlers.click();
});
