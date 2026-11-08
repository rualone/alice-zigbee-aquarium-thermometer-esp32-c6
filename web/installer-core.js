export const PROJECT='alice_zigbee_aquarium_thermometer';
export function appIdentity(data) {
 const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
 if(data.length<112 || view.getUint32(32,true)!==0xabcd5432)throw new Error('Не удалось распознать описание прошивки. Обновление остановлено без записи. Проверьте, что на плате установлена прошивка этого проекта.');
 const text=(start)=>new TextDecoder().decode(data.slice(start,start+32)).split('\0')[0];
 return {version:text(48),project:text(80)};
}
export function validateUpdate(partition,expected,app,targetVersion) {
 if(partition.length<expected.length || !expected.every((v,i)=>partition[i]===v))throw new Error('Разметка памяти отличается. Автоматическое обновление остановлено для сохранения данных.');
 return validateApp(app,targetVersion);
}
export function validateApp(app,targetVersion) {
 const identity=appIdentity(app);
 if(identity.project!==PROJECT.slice(0,31))throw new Error('На плате установлена другая прошивка. Обновление остановлено.');
 const version=s=>/^\d+\.\d+(?:\.\d+)?$/.test(s) ? s.split('.').map(Number) : null;
 const current=version(identity.version),target=version(targetVersion);
 if(!current || !target)throw new Error('Не удалось проверить совместимость версий.');
 for(let i=0;i<3;i++) {
  if((current[i]||0)>(target[i]||0))throw new Error('На плате более новая версия. Понижение версии остановлено.');
  if((current[i]||0)<(target[i]||0))break;
 }
 return identity;
}
export function validateManifest(m) {
 if(m.chip!=='ESP32-C6'||m.project!==PROJECT||![1,2].includes(m.layout)||!Array.isArray(m.parts)||m.parts.length!==4)throw new Error('Несовместимый пакет прошивки.');
 const allowed=new Map([[0,0x8000],[0x8000,0x9000],[0xf000,0x11000],[0x20000,0x10b000]]);
 const seen=new Set();
 for(const p of m.parts) {
  if(!allowed.has(p.offset)||seen.has(p.offset)||!Number.isInteger(p.size)||p.size<=0||p.offset+Math.ceil(p.size/4096)*4096>allowed.get(p.offset)||!/^[-\w]+\.bin$/.test(p.path)||!/^[a-f0-9]{64}$/.test(p.sha256))throw new Error('Некорректный пакет прошивки.');
  seen.add(p.offset);
 }
 if(m.app?.offset!==0x20000 || m.partition?.offset!==0x8000 || !m.parts.some(p=>JSON.stringify(p)===JSON.stringify(m.app)) || !m.parts.some(p=>JSON.stringify(p)===JSON.stringify(m.partition)))throw new Error('Некорректная разметка пакета.');
 return m;
}

export function flashFiles(parts,data) {
 return parts.map(part=>{
  const bytes=data.get(part.offset);
  if(!(bytes instanceof Uint8Array) || bytes.length!==part.size)throw new Error('Некорректные данные записи.');
  // The loader may pad/update its buffer; keep originals for verification.
  return {data:bytes.slice(),address:part.offset};
 });
}

// Small compatibility reads use standard SPI READ via the public loader API.
// No streaming READ_FLASH command or outstanding digest remains on USB.
export async function readFlashBounded(loader,address,size,onProgress=()=>{}) {
 if(!Number.isInteger(size)||size<=0||size>4096||!Number.isInteger(address)||address<=0||address+size>0x1000000)throw new Error('Недопустимый размер проверочного чтения.');
 const output=new Uint8Array(size);
 // ESP32-C6 SPI_MEM stores the 24-bit address right-aligned (as in esptool).
 if(loader.chip?.CHIP_NAME!=='ESP32-C6')throw new Error('Этот способ чтения поддерживает только ESP32-C6.');
 const previousAddressMode=loader.SPI_ADDR_REG_MSB;
 loader.SPI_ADDR_REG_MSB=false;
 try{
 for(let offset=0;offset<size;offset+=4){
  const count=Math.min(4,size-offset);
  const word=await loader.runSpiflashCommand(0x03,new Uint8Array(0),count*8,address+offset,24,0);
  for(let byte=0;byte<count;byte++)output[offset+byte]=(word>>>(byte*8))&255;
  if((offset+count)%32===0||offset+count===size)onProgress(offset+count,size);
 }
 return output;
 }finally{loader.SPI_ADDR_REG_MSB=previousAddressMode;}
}

export async function writeAndVerify(loader,parts,data,onProgress=()=>{},onStage=()=>{}) {
 const total=parts.reduce((sum,part)=>sum+part.size,0);
 onStage('write');
 await loader.writeFlash({
  fileArray:flashFiles(parts,data),flashSize:'keep',flashMode:'keep',flashFreq:'keep',
  eraseAll:false,compress:true,
  reportProgress(index,written,size){
   const before=parts.slice(0,index).reduce((sum,part)=>sum+part.size,0);
   onProgress(Math.min(99,Math.round((before+parts[index].size*written/size)/total*99)));
  }
 });
 onStage('verify');
 // Await the loader's own timeout. A Promise.race would leave USB work running.
 for(const part of parts){
  if(!/^[a-f0-9]{32}$/.test(part.md5||''))throw new Error('Нет контрольной суммы прошивки.');
  const actual=await loader.flashMd5sum(part.offset,Math.ceil(part.size/4)*4);
  if(actual.toLowerCase()!==part.md5)throw new Error('Проверка записи не пройдена. Повторите обновление без очистки памяти.');
 }
 onProgress(100);
}

export async function restartThermometer(loader) {
 // 0.7.1 HardReset only deasserts RTS; explicitly assert reset first.
 await loader.after('custom_reset',false,'D0|R1|W100|R0|W200|D0');
}

export function installerErrorText(error) {
 if(error?.name==='NotFoundError')return 'Выбор платы отменён.';
 const message=error?.message||'';
 if(/Failed to open/i.test(message))return 'USB-порт занят. Отключите термометр на странице «Мой аквариум» и закройте другие программы, использующие устройство.';
 if(/serial noise|device.*(?:lost|disconnect)|port.*(?:closed|disconnect)|disconnected/i.test(message))return 'Связь с термометром прервалась. Переподключите USB-кабель и повторите обновление.';
 return message||'Не удалось прошить плату. Проверьте USB-кабель и попробуйте режим BOOT.';
}
