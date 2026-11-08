// Layout 2. These addresses deliberately preserve layout 1 NVS and zb_fct.
import {writeAndVerify,readFlashBounded,flashFiles} from './installer-core.js?v=ota-07';
export const SLOTS=[0x20000,0x110000];
export const OTA_SECTORS=[0xf000,0x10000];
export const LEGACY_PARTITION_MD5='e3d6b64bafc818ae4aeb0c71d5278327';
const NEW=0, PENDING=1, VALID=2;

// Same CRC convention as esp_rom_crc32_le(UINT32_MAX, &ota_seq, 4).
export function sequenceCRC(sequence) {
 let crc=0;
 for(let byte=0;byte<4;byte++){
  crc^=(sequence>>>(byte*8))&255;
  for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
 }
 return (~crc)>>>0;
}
export function otaRecord(sequence,state) {
 if(!Number.isInteger(sequence)||sequence<1||sequence>=0xffffffff||![NEW,VALID].includes(state))throw new Error('Некорректный выбор прошивки.');
 const bytes=new Uint8Array(32).fill(255),view=new DataView(bytes.buffer);
 view.setUint32(0,sequence,true);view.setUint32(24,state,true);view.setUint32(28,sequenceCRC(sequence),true);
 return bytes;
}
export function readOtaRecord(bytes) {
 if(!(bytes instanceof Uint8Array)||bytes.length!==32)throw new Error('Не удалось прочитать выбор прошивки.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,32);
 const sequence=view.getUint32(0,true),state=view.getUint32(24,true);
 const valid=sequence>0&&sequence!==0xffffffff&&state!==3&&state!==4&&view.getUint32(28,true)===sequenceCRC(sequence);
 return {sequence,state,valid,empty:bytes.every(byte=>byte===255)};
}
export function updatePlan(records) {
 const parsed=records.map(readOtaRecord);
 if(parsed.length!==2)throw new Error('Нужны обе записи выбора прошивки.');
 const valid=parsed.map((entry,index)=>({...entry,index})).filter(entry=>entry.valid);
 // Do not guess which app will run after a pending first boot / damaged metadata.
 if(valid.some(entry=>entry.state!==VALID))throw new Error('Предыдущее обновление ещё не подтверждено. Перезапустите термометр и подключитесь к нему перед повторной попыткой.');
 if(!valid.length){
  if(!parsed.every(entry=>entry.empty))throw new Error('Повреждён выбор прошивки. Запись остановлена для сохранения рабочей версии.');
  return {active:0,target:1,sector:1,sequence:2,seed:true};
 }
 valid.sort((a,b)=>b.sequence-a.sequence||a.index-b.index);
 const current=valid[0];
 if(current.sequence>=0xfffffffe)throw new Error('Достигнут предел обновлений. Запись остановлена.');
 return {active:(current.sequence-1)%2,target:current.sequence%2,sector:1-current.index,sequence:current.sequence+1,seed:false};
}
async function selectImage(loader,sector,sequence,state,read) {
 const bytes=otaRecord(sequence,state),part={offset:OTA_SECTORS[sector],size:32};
 await loader.writeFlash({fileArray:flashFiles([part],new Map([[part.offset,bytes]])),flashSize:'keep',flashMode:'keep',flashFreq:'keep',eraseAll:false,compress:true});
 const actual=await read(loader,part.offset,32);
 if(!bytes.every((byte,index)=>actual[index]===byte))throw new Error('Не удалось подтвердить выбор новой прошивки. Повторите обновление.');
}
export async function safeUpdate(loader,manifest,data,plan,{legacy=false,read=readFlashBounded,progress=()=>{},status=()=>{}}={}) {
 // Validate again at the mutation boundary. Only the inactive slot may be erased.
 if(![0,1].includes(plan.active)||plan.target!==1-plan.active||![0,1].includes(plan.sector)||
    (plan.sequence-1)%2!==plan.target||!Number.isInteger(plan.sequence)||plan.sequence<2||plan.sequence>=0xffffffff||
    (legacy&&(plan.active!==0||!plan.seed)))throw new Error('Небезопасный план обновления.');
 const target={...manifest.app,offset:SLOTS[plan.target]};
 const targetData=new Map([[target.offset,data.get(manifest.app.offset)]]);
 status('Записываем новую версию. Рабочая прошивка остаётся в памяти…');
 await writeAndVerify(loader,[target],targetData,value=>progress(Math.round(value*0.9)),stage=>{
  if(stage==='verify')status('Проверяем новую прошивку…');
 });
 // Establish an explicit confirmed fallback before changing boot selection.
 if(plan.seed)await selectImage(loader,0,1,VALID,read);
 if(legacy){
  status('Обновляем загрузчик и разметку. Не отключайте USB…');
  for(const offset of [0,0x8000]){
   const part=manifest.parts.find(part=>part.offset===offset);
   await writeAndVerify(loader,[part],data,()=>{});
  }
 }
 status('Выбираем проверенную прошивку для следующего запуска…');
 await selectImage(loader,plan.sector,plan.sequence,NEW,read);
 progress(100);
}
