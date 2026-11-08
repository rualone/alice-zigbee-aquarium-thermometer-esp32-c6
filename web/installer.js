import {SLOTS,OTA_SECTORS,LEGACY_PARTITION_MD5,updatePlan,safeUpdate} from './ota.js?v=ota-07';
import {installerErrorText,validateManifest,validateApp,writeAndVerify,restartThermometer,readFlashBounded} from './installer-core.js?v=ota-07-errors-1';
const $=id=>document.getElementById(id);
let busy=false;
function updateInstallButton(){
 const supported=window.isSecureContext && ('serial' in navigator);
 const initial=$('install-mode').value==='initial';
 const confirmed=$('install-consent').checked && [...document.querySelectorAll('.assembly-check')].every(input=>input.checked);
 $('install-start').disabled=busy || !supported || (initial && !confirmed);
}

function status(text){
 const target=$('install-status');
 const parts=text.split('«Мой аквариум»');
 target.textContent=parts.shift();
 for(const suffix of parts){
  const link=document.createElement('a');
  link.href='https://rualone.github.io/alice-zigbee-aquarium-thermometer-esp32-c6/';
  link.textContent='«Мой аквариум»';
  target.append(link,document.createTextNode(suffix));
 }
}
function progress(value){$('install-progress').value=value;if($('install-percent'))$('install-percent').textContent=value+'%';}
async function download(part){
 const response=await fetch('firmware/'+part.path,{cache:'no-store'});
 if(!response.ok)throw new Error('Не удалось скачать файлы прошивки.');
 const data=new Uint8Array(await response.arrayBuffer());
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),v=>v.toString(16).padStart(2,'0')).join('');
 if(data.length!==part.size || digest!==part.sha256)throw new Error('Файл прошивки повреждён. Попробуйте снова.');
 return data;
}
async function checkedRead(loader,address,size,label){
 const previous=loader.FLASH_READ_TIMEOUT;
 loader.FLASH_READ_TIMEOUT=8000;
 try{
  const bytes=await readFlashBounded(loader,address,size);

  return bytes;
 }catch(error){

  throw new Error('Не удалось прочитать '+label+'. Запись прошивки не начиналась. Переподключите USB и повторите попытку.');
 }finally{loader.FLASH_READ_TIMEOUT=previous;}
}
async function install(){
 if(busy)return;
 const initial=$('install-mode').value==='initial';
 if(initial && (!$('install-consent').checked || [...document.querySelectorAll('.assembly-check')].some(c=>!c.checked))){status('Подтвердите первую установку и удаление прежних данных.');return;}

 let transport,loader,selectedPort,success=false,restarted=false,installedVersion=null;
 busy=true;if($('install-close'))$('install-close').disabled=true;$('install-start').disabled=true;$('install-mode').disabled=true;$('install-consent').disabled=true;progress(0);
 try{
  // Picker must be called directly from the user's click, before asynchronous downloads.
  const port=await navigator.serial.requestPort({filters:[{usbVendorId:0x303a,usbProductId:0x1001}]});
  selectedPort=port;
  status('Скачиваем и проверяем прошивку…');
  const response=await fetch('firmware/manifest.json',{cache:'no-store'});
  if(!response.ok)throw new Error('Пакет прошивки пока недоступен.');
  const manifest=validateManifest(await response.json());
  if(manifest.parts.some(p=>!/^[a-f0-9]{32}$/.test(p.md5||'')))throw new Error('Пакет прошивки устарел. Обновите страницу и попробуйте снова.');
  const data=new Map();for(const part of manifest.parts)data.set(part.offset,await download(part));
  const {ESPLoader,Transport}=await import('https://esm.sh/esptool-js@0.7.1?bundle');
  status('Подключаемся к плате…');
  transport=new Transport(port);
  loader=new ESPLoader({transport,baudrate:115200,romBaudrate:115200,debugLogging:false,terminal:{clean(){},write(){},writeLine(){}}});
  await loader.main();
  if(loader.chip.CHIP_NAME!=='ESP32-C6')throw new Error('Поддерживается только ESP32-C6.');
  const flashSize=await loader.detectFlashSize();
  if(!flashSize || loader.flashSizeBytes(flashSize)<2*1024*1024)throw new Error('Для этой прошивки нужна ESP32-C6 с памятью не менее 2 МБ. Запись не начиналась.');
  if(manifest.layout!==2)throw new Error('Пакет прошивки устарел. Обновите страницу.');
  if(initial){
   status('Очищаем плату для первой установки…');
   await loader.eraseFlash();
   await writeAndVerify(loader,manifest.parts,data,progress,stage=>status(stage==='write'
    ? 'Записываем прошивку. Не отключайте USB…' : 'Проверяем записанные данные…'));
  }else{
   status('Проверяем совместимость и сохранность настроек…');
   const partitionHash=(await loader.flashMd5sum(0x8000,Math.ceil(manifest.partition.size/4)*4)).toLowerCase();
   const legacy=partitionHash===LEGACY_PARTITION_MD5;
   if(!legacy && partitionHash!==manifest.partition.md5)throw new Error('Разметка памяти отличается. Обновление остановлено для сохранения данных.');
   const records=legacy ? [new Uint8Array(32).fill(255),new Uint8Array(32).fill(255)] :
    [await checkedRead(loader,OTA_SECTORS[0],32,'выбор прошивки'),await checkedRead(loader,OTA_SECTORS[1],32,'резервный выбор прошивки')];
   const plan=updatePlan(records);
   const app=await checkedRead(loader,SLOTS[plan.active],256,'описание прошивки');
   validateApp(app,manifest.version);
   await safeUpdate(loader,manifest,data,plan,{legacy,read:readFlashBounded,progress,status});
  }
  success=true;
  installedVersion=manifest.version;
  status('Прошивка установлена и проверена. Перезапускаем термометр…');
  try{

   await restartThermometer(loader);
   restarted=true;

  }catch(error){}
  progress(100);
  status(restarted?'Прошивка '+manifest.version+' установлена. Подключаем термометр…':'Прошивка записана и проверена. Переподключите USB-кабель для запуска термометра.');
 }catch(error){

  status(installerErrorText(error));
 }finally{
  if(transport){try{await transport.disconnect();}catch{}}
  if(success){
   const detail={port:selectedPort,restarted,version:installedVersion};
   try{

    document.dispatchEvent(new CustomEvent('firmware-installed',{detail}));
    await detail.completion;

   }catch(error){status('Прошивка установлена. Переподключите USB и подключите термометр вручную.');}
  }
  busy=false;if($('install-close'))$('install-close').disabled=false;
  $('install-mode').disabled=false;$('install-consent').disabled=false;
  updateInstallButton();
 }
}
$('install-mode').addEventListener('change',()=>{$('install-warning').hidden=$('install-mode').value!=='initial';$('install-consent').checked=false;updateInstallButton();});
$('install-start').addEventListener('click',install);
window.addEventListener('beforeunload',event=>{if(busy){event.preventDefault();event.returnValue='';}});
if(!window.isSecureContext || !('serial' in navigator)){$('install-start').disabled=true;status('Откройте эту страницу в Chrome или Edge на компьютере по HTTPS или localhost.');}

$('install-dialog')?.addEventListener('cancel',event=>{if(busy)event.preventDefault();});

for(const input of document.querySelectorAll('.assembly-check,#install-consent'))input.addEventListener('change',updateInstallButton);
updateInstallButton();
