import {validateManifest,validateUpdate,writeAndVerify,readFlashBounded} from './installer-core.js?v=071-c6-address-1';
const $=id=>document.getElementById(id);
let busy=false;
const TRACE_KEY='aquarium-installer-trace';
function trace(stage){
 try{
  const clean=String(stage).replace(/(?:[0-9a-f]{2}:){5,7}[0-9a-f]{2}/gi,'[адрес скрыт]').slice(0,3000);
  const log=JSON.parse(localStorage.getItem(TRACE_KEY)||'[]');
  log.push({time:new Date().toISOString(),stage:clean});
  localStorage.setItem(TRACE_KEY,JSON.stringify(log.slice(-600)));
 }catch{}
}
window.addEventListener('error',event=>trace('JS error: '+event.message+' '+(event.error?.stack||'')));
window.addEventListener('unhandledrejection',event=>trace('Unhandled rejection: '+(event.reason?.stack||event.reason)));
document.addEventListener('installer-trace',event=>trace(event.detail));
if('serial' in navigator)for(const name of ['connect','disconnect'])navigator.serial.addEventListener(name,()=>trace('USB event: '+name));
trace('Страница загрузчика открыта');
function updateInstallButton(){
 const supported=window.isSecureContext && ('serial' in navigator);
 const initial=$('install-mode').value==='initial';
 const confirmed=$('install-consent').checked && [...document.querySelectorAll('.assembly-check')].every(input=>input.checked);
 $('install-start').disabled=busy || !supported || (initial && !confirmed);
}

function status(text){trace(text);$('install-status').textContent=text;}
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
 trace('Начало чтения: '+label+'; размер '+size);
 const previous=loader.FLASH_READ_TIMEOUT;
 loader.FLASH_READ_TIMEOUT=8000;
 try{
  const bytes=await readFlashBounded(loader,address,size,(done,total)=>trace('Чтение '+label+': '+done+'/'+total));
  trace('Конец чтения: '+label);
  return bytes;
 }catch(error){
  trace('Ошибка чтения '+label+': '+(error.stack||error));
  throw new Error('Не удалось прочитать '+label+'. Запись прошивки не начиналась. Переподключите USB и повторите попытку.');
 }finally{loader.FLASH_READ_TIMEOUT=previous;}
}
async function install(){
 if(busy)return;
 const initial=$('install-mode').value==='initial';
 if(initial && (!$('install-consent').checked || [...document.querySelectorAll('.assembly-check')].some(c=>!c.checked))){status('Подтвердите первую установку и удаление прежних данных.');return;}
 trace('Начало установки');
 let transport,loader,selectedPort,success=false;
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
  trace('Загрузчик esptool-js 0.7.1; установка и обновление через единый API');
  status('Подключаемся к плате…');
  transport=new Transport(port);
  loader=new ESPLoader({transport,baudrate:115200,romBaudrate:115200,debugLogging:true,terminal:{clean(){},write(text){trace('Loader: '+text);},writeLine(text){trace('Loader: '+text);}}});
  await loader.main();
  if(loader.chip.CHIP_NAME!=='ESP32-C6')throw new Error('Поддерживается только ESP32-C6.');
  if(!initial){
   status('Проверяем совместимость и сохранность настроек…');
   trace('Проверяем контрольную сумму разметки памяти');
   const partitionHash=await loader.flashMd5sum(0x8000,Math.ceil(manifest.partition.size/4)*4);
   if(partitionHash.toLowerCase()!==manifest.partition.md5)throw new Error('Разметка памяти отличается. Обновление остановлено для сохранения данных.');
   const partition=data.get(0x8000);
   const app=await checkedRead(loader,0x20000,256,'описание прошивки');
   trace('Описание приложения (первые 112 байт): '+Array.from(app.slice(0,112),byte=>byte.toString(16).padStart(2,'0')).join(''));
   const headerHash=await loader.flashMd5sum(0x20000,256);
   trace('MD5 первых 256 байт приложения: '+headerHash);
   validateUpdate(partition,data.get(0x8000),app,manifest.version);
  }
  const parts=initial ? manifest.parts : [manifest.app];
  if(initial){status('Очищаем плату для первой установки…');await loader.eraseFlash();}
  status('Записываем прошивку. Не отключайте USB…');
  await writeAndVerify(loader,parts,data,progress,stage=>status(stage==='write'
   ? 'Записываем прошивку. Не отключайте USB…' : 'Проверяем записанные данные…'));
  trace('Запись проверена; запуск после переподключения USB');
  success=true;
  progress(100);
  status('Прошивка '+manifest.version+' записана и проверена. Переподключите USB-кабель для запуска термометра.');
 }catch(error){
  trace('Ошибка установки: '+(error.stack||error));
  status(error.name==='NotFoundError'?'Выбор платы отменён.':error.message?.includes('Failed to open')?'Порт занят. Отключите термометр на странице диагностики и закройте монитор VS Code.':error.message || 'Не удалось прошить плату. Проверьте USB-кабель и попробуйте режим BOOT.');
 }finally{
  if(transport){try{trace('Закрываем USB transport');await transport.disconnect();trace('USB transport закрыт');}catch{trace('Ошибка закрытия USB transport');}}
  busy=false;if($('install-close'))$('install-close').disabled=false;
  if(success){trace('Передаём событие завершения');document.dispatchEvent(new CustomEvent('firmware-installed',{detail:{port:selectedPort}}));trace('Событие завершения обработано');}
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

document.getElementById('installer-trace-download')?.addEventListener('click',()=>{
 trace('Экспорт журнала');
 const content=localStorage.getItem(TRACE_KEY)||'[]';
 const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download='aquarium-installer-trace.json';a.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
});
