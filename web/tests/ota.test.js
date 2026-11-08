import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SLOTS,OTA_SECTORS,sequenceCRC,otaRecord,readOtaRecord,updatePlan,safeUpdate} from '../ota.js';
import {installationState} from '../update-result.js';
const blank=()=>new Uint8Array(32).fill(255);
test('OTA CRC matches independent zlib vectors with SDK initial UINT32_MAX',()=>{
 for(const [seq,crc] of [[1,0x4743989a],[2,0x55f63774],[3,0xed4a5011],[4,0x709d68a8],[0xfffffffe,0x99f8b879]])assert.equal(sequenceCRC(seq),crc);
 assert.equal(readOtaRecord(otaRecord(2,2)).sequence,2);
});
test('chooses inactive slot and preserves the latest confirmed selection',()=>{
 assert.deepEqual(updatePlan([blank(),blank()]),{active:0,target:1,sector:1,sequence:2,seed:true});
 assert.deepEqual(updatePlan([otaRecord(1,2),otaRecord(2,2)]),{active:1,target:0,sector:0,sequence:3,seed:false});
 assert.equal(updatePlan([otaRecord(3,2),otaRecord(2,2)]).target,1);
 const aborted=otaRecord(4,2);new DataView(aborted.buffer).setUint32(24,4,true);
 assert.equal(updatePlan([otaRecord(3,2),aborted]).active,0);
 const broken=otaRecord(4,2);broken[0]^=1;
 assert.equal(updatePlan([otaRecord(3,2),broken]).active,0);
 assert.throws(()=>updatePlan([broken,blank()]));
 assert.throws(()=>updatePlan([otaRecord(1,2),otaRecord(2,0)]));
 const pending=otaRecord(2,0);new DataView(pending.buffer).setUint32(24,1,true);
 assert.throws(()=>updatePlan([otaRecord(1,2),pending]));
 assert.throws(()=>updatePlan([otaRecord(0xfffffffe,2),blank()]));
});
const app={offset:SLOTS[0],size:32,md5:'a'.repeat(32)};
const manifest={app,parts:[{offset:0,size:32,md5:'b'.repeat(32)},{offset:0x8000,size:32,md5:'c'.repeat(32)},app]};
function device(records,failAt=-1,tear=0){
 const flash=new Uint8Array(2*1024*1024).fill(255),writes=[];
 records.forEach((record,i)=>flash.set(record,OTA_SECTORS[i]));
 flash.fill(0x42,SLOTS[0],SLOTS[0]+4096);
 flash.fill(0x77,0x9000,0xf000);flash.fill(0x55,0x10b000,0x10b400);
 const loader={async writeFlash(options){
  assert.equal(options.eraseAll,false);
  for(const file of options.fileArray){
   const {address,data}=file;writes.push(address);
   flash.fill(255,address,address+4096);
   if(writes.length===failAt){flash.set(data.slice(0,tear),address);throw Error('power lost');}
   flash.set(data,address);
  }
 },async flashMd5sum(address){return manifest.parts.find(part=>part.offset===address)?.md5 || app.md5;}};
 return {flash,writes,loader,read:async(_,address,size)=>flash.slice(address,address+size)};
}
const data=new Map(manifest.parts.map(part=>[part.offset,new Uint8Array(part.size).fill(0x31)]));
test('update writes only inactive image then one OTA sector; repeat alternates slots',async()=>{
 const d=device([otaRecord(1,2),otaRecord(2,2)]),old=d.flash.slice(SLOTS[1],SLOTS[1]+4096);
 await safeUpdate(d.loader,manifest,data,updatePlan([otaRecord(1,2),otaRecord(2,2)]),{read:d.read});
 assert.deepEqual(d.writes,[SLOTS[0],OTA_SECTORS[0]]);
 assert.deepEqual(d.flash.slice(SLOTS[1],SLOTS[1]+4096),old);
 assert.equal(readOtaRecord(d.flash.slice(OTA_SECTORS[0],OTA_SECTORS[0]+32)).state,0);
});
test('interruption at every byte of app/selection keeps confirmed fallback and all settings',async()=>{
 for(const failAt of [1,2])for(let tear=0;tear<=32;tear++){
  const records=[otaRecord(1,2),blank()],d=device(records,failAt,tear);
  const old=d.flash.slice(SLOTS[0],SLOTS[0]+4096);
  await assert.rejects(()=>safeUpdate(d.loader,manifest,data,updatePlan(records),{read:d.read}),/power lost/);
  assert.deepEqual(d.flash.slice(SLOTS[0],SLOTS[0]+4096),old);
  assert.deepEqual(d.flash.slice(0xf000,0xf020),records[0]);
  assert.ok(d.flash.slice(0x9000,0xf000).every(v=>v===0x77));
  assert.ok(d.flash.slice(0x10b000,0x10b400).every(v=>v===0x55));
 }
});
test('a failed digest prevents changing boot selection',async()=>{
 const records=[otaRecord(1,2),blank()],d=device(records);
 d.loader.flashMd5sum=async()=> 'f'.repeat(32);
 await assert.rejects(()=>safeUpdate(d.loader,manifest,data,updatePlan(records),{read:d.read}));
 assert.deepEqual(d.writes,[SLOTS[1]]);
 assert.deepEqual(d.flash.slice(0xf000,0xf020),records[0]);
});
test('migration verifies app first, establishes fallback, updates boot files, commits last',async()=>{
 const records=[blank(),blank()],d=device(records);
 await safeUpdate(d.loader,manifest,data,updatePlan(records),{legacy:true,read:d.read});
 assert.deepEqual(d.writes,[SLOTS[1],OTA_SECTORS[0],0,0x8000,OTA_SECTORS[1]]);
 assert.equal(readOtaRecord(d.flash.slice(0xf000,0xf020)).state,2);
 assert.ok(d.flash.slice(SLOTS[0],SLOTS[0]+4096).every(v=>v===0x42));
 for(let fail=1;fail<=4;fail++){
  const stopped=device(records,fail);
  await assert.rejects(()=>safeUpdate(stopped.loader,manifest,data,updatePlan(records),{legacy:true,read:stopped.read}));
  assert.ok(!stopped.writes.includes(OTA_SECTORS[1]));
 }
});
test('page confirms only expected version after first-boot validation; detects rollback',()=>{
 assert.equal(installationState({firmware:'0.7',update_pending:true},'0.7'),'waiting');
 assert.equal(installationState({firmware:'0.7',update_pending:false},'0.7'),'confirmed');
 assert.equal(installationState({firmware:'0.6'},'0.7'),'rolled_back');
 assert.equal(installationState({firmware:'0.7'},'0.7'),'waiting');
});
