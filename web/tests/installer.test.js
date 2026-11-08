import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installerErrorText,PROJECT,appIdentity,validateUpdate,validateManifest,flashFiles,readFlashBounded,writeAndVerify,restartThermometer} from '../installer-core.js';
function app(project=PROJECT.slice(0,31),version='0.3') {
 const bytes=new Uint8Array(256);new DataView(bytes.buffer).setUint32(32,0xabcd5432,true);
 bytes.set(new TextEncoder().encode(version),48);bytes.set(new TextEncoder().encode(project),80);return bytes;
}
test('accepts matching layout and project; blocks foreign firmware, layout changes and downgrade',()=>{
 const partition=new Uint8Array([1,2,3]);
 assert.equal(validateUpdate(partition,partition,app(),'0.4').version,'0.3');
 assert.throws(()=>validateUpdate(partition,new Uint8Array([1,9,3]),app(),'0.4'));
 assert.throws(()=>validateUpdate(partition,partition,app('other'),'0.4'));
 assert.throws(()=>validateUpdate(partition,partition,app(PROJECT.slice(0,31),'0.5'),'0.4'));
 assert.throws(()=>appIdentity(new Uint8Array(256)));
});
test('rejects packages overlapping settings, wrong chips and arbitrary paths',()=>{
 const parts=[{offset:0,size:22000,path:'bootloader.bin'},{offset:0x8000,size:3072,path:'partitions.bin'},{offset:0xf000,size:8192,path:'ota.bin'},{offset:0x20000,size:560000,path:'app.bin'}].map(p=>({...p,sha256:'a'.repeat(64)}));
 const manifest={project:PROJECT,version:'0.4',chip:'ESP32-C6',layout:1,parts,app:parts[3],partition:parts[1]};
 assert.equal(validateManifest(manifest),manifest);
 assert.throws(()=>validateManifest({...manifest,chip:'ESP32'}));
 assert.throws(()=>validateManifest({...manifest,parts:parts.map((p,i)=>i===1?{...p,size:8192}:p)}));
 assert.throws(()=>validateManifest({...manifest,parts:parts.map((p,i)=>i===0?{...p,path:'../app.bin'}:p)}));
});

test('new loader receives independent Uint8Array buffers at exact flash addresses',()=>{
 const bytes=new Uint8Array([0xe9,1,2,3]);
 const files=flashFiles([{offset:0x20000,size:4}],new Map([[0x20000,bytes]]));
 assert.ok(files[0].data instanceof Uint8Array);
 assert.equal(files[0].address,0x20000);
 files[0].data[0]=0;
 assert.equal(bytes[0],0xe9);
 assert.throws(()=>flashFiles([{offset:0x20000,size:4}],new Map([[0x20000,'abcd']])));
});

test('compatibility SPI read uses read-only opcode, 24-bit addresses and little endian words',async()=>{
 const calls=[];
 const loader={chip:{CHIP_NAME:'ESP32-C6'},SPI_ADDR_REG_MSB:true,async runSpiflashCommand(op,data,bits,address,addressBits,dummy){assert.equal(this.SPI_ADDR_REG_MSB,false);calls.push(address);assert.equal(op,3);assert.equal(data.length,0);assert.equal(addressBits,24);assert.equal(dummy,0);return 0x44332211;}};
 assert.deepEqual([...await readFlashBounded(loader,0x20000,6)],[17,34,51,68,17,34]);
 assert.deepEqual(calls,[0x20000,0x20004]);assert.equal(loader.SPI_ADDR_REG_MSB,true);
 await assert.rejects(()=>readFlashBounded(loader,0,256));
 loader.runSpiflashCommand=async()=>{throw new Error('USB lost');};
 await assert.rejects(()=>readFlashBounded(loader,0x20000,256),/USB lost/);assert.equal(loader.SPI_ADDR_REG_MSB,true);
});

test('write failures stop verification; mismatch rejects; success reaches 100 only after verification',async()=>{
 const part={offset:0x20000,size:4,md5:'a'.repeat(32)};
 const data=new Map([[part.offset,new Uint8Array(4)]]),events=[];
 const loader={async writeFlash(options){assert.equal(options.eraseAll,false);options.reportProgress(0,4,4);},async flashMd5sum(){events.push('verified');return part.md5;}};
 await writeAndVerify(loader,[part],data,value=>events.push(value));
 assert.deepEqual(events,[99,'verified',100]);
 loader.flashMd5sum=async()=> 'b'.repeat(32);
 await assert.rejects(()=>writeAndVerify(loader,[part],data));
 loader.writeFlash=async()=>{throw new Error('USB lost');};
 loader.flashMd5sum=async()=>assert.fail('must not verify after write error');
 await assert.rejects(()=>writeAndVerify(loader,[part],data),/USB lost/);
});

test('restart explicitly pulses reset rather than only releasing RTS',async()=>{
 const calls=[];
 await restartThermometer({async after(...args){calls.push(args);}});
 assert.deepEqual(calls,[['custom_reset',false,'D0|R1|W100|R0|W200|D0']]);
 await assert.rejects(()=>restartThermometer({async after(){throw new Error('USB lost');}}),/USB lost/);
});

test('serial noise and disconnected ports have a friendly Russian error',()=>{
 for(const message of ['Invalid head of packet: Possible serial noise or corruption.','The device has been lost.','The port is closed.']){
  assert.match(installerErrorText(new Error(message)),/^Связь с термометром прервалась/);
 }
 assert.equal(installerErrorText(new Error('Разметка памяти отличается.')),'Разметка памяти отличается.');
 assert.equal(installerErrorText({name:'NotFoundError'}),'Выбор платы отменён.');
});
