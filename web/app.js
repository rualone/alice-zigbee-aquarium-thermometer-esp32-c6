import {createAppearanceUI} from './appearance.js?v=device-theme-08-disconnect-2';
import {supportsDeviceTheme} from './themes.js?v=device-theme-08-disconnect-2';
import {installationState} from './update-result.js?v=ota-07';
import {openDialog,closeDialog} from "./dialogs.js?v=modal-motion-2";
import {parseFrame, duration, report, eventText, zigbeeBadge, showZigbeeBadge} from "./protocol.js?v=device-theme-08";
const $ = id => document.getElementById(id);
let port = null, reader = null, reading = null, poll = null, last = null, received = 0, capturedAt = null;
const appearance=createAppearanceUI(document,{onChange:()=>updateSettingsButton(),onError:message=>toast(message)});
let activeWriter = null;
let latestFirmware=null;
let settingsResetPending=false, resetSnapshotExpected=false;
let settingsPending = null, settingsDirty = false, settingsLoaded = false;
const brightnessLevels=[0,1,25,100,255];
const brightnessNames=['Отключена','Минимальная','Средняя','Высокая','Звездная'];
let brightnessValue=1;
let offsetCenti=0, calibrationRaw=null;
// Native range thumbs are 36px wide; stops follow their centre positions.
function drawSliderTicks(field,count) {
 field.style.backgroundImage=Array.from({length:count},(_,index)=>{
  const fraction=index/(count-1);
  return `radial-gradient(circle at calc(${fraction*100}% + ${18-fraction*36}px) 50%,var(--theme-dots) 2px,transparent 2.5px)`;
 }).join(',');
}
function measurementFresh() {
 return !!last && last.probe==='ok' && Date.now()-received<10000 && last.measurement_age_ms!==null &&
  last.measurement_age_ms+Date.now()-received<Math.max(30000,(last.sample_interval_ms||5000)*2+2000);
}
function showBrightness(value, syncSlider=true) {
 brightnessValue=value;
 const exact=brightnessLevels.indexOf(value);
 const index=exact>=0 ? exact : brightnessLevels.reduce((best,n,i)=>Math.abs(n-value)<Math.abs(brightnessLevels[best]-value)?i:best,0);
 if(syncSlider) $('setting-brightness').value=index;
 drawSliderTicks($('setting-brightness'),brightnessLevels.length);
 const description=exact>=0 ? brightnessNames[index] : `Сохранённая яркость: ${value} из 255`;
 $('brightness-description').textContent=description;
 $('setting-brightness').setAttribute('aria-valuetext',description);
}
const sliderPresets={sample:[2,5,10,30,60],report:[30,60,300,900],delta:[0.1,0.2,0.5,1]};
const sliderValues={sample:5,report:60,delta:0.2};
const sliderOptions={};
function updateStepSlider(key,value,load=false) {
 const field=$('setting-'+key);
 if(!field)return;
 if(load)sliderOptions[key]=[...new Set([...sliderPresets[key],value])].sort((a,b)=>a-b);
 const options=sliderOptions[key] || sliderPresets[key];
 sliderValues[key]=value;
 if(load){field.max=options.length-1;field.value=options.indexOf(value);}
 const label=key==='delta' ? value.toLocaleString('ru-RU')+' °C' : value%60===0 ? value/60+' мин' : value+' с';
 $(key+'-description').textContent=label;
 field.setAttribute('aria-valuetext',label);
 drawSliderTicks(field,options.length);
}
function formSettings() {
 const value={brightness:brightnessValue,sample_seconds:sliderValues.sample,report_seconds:sliderValues.report,delta_centi:Math.round(sliderValues.delta*100)};
 if(last?.settings && Object.hasOwn(last.settings,"offset_centi"))value.offset_centi=offsetCenti;
 if(supportsDeviceTheme(last))value.theme=appearance?.value ?? last.settings.theme;
 return value;
}
function updateSettingsButton() {
 const value=formSettings();
 settingsDirty=settingsLoaded && !!last?.settings && Object.keys(value).some(key=>value[key]!==last.settings[key]);
 if($('settings-reset')){
  $('settings-reset').hidden=last?.settings_reset!==true;
  $('settings-reset').disabled=!!settingsPending || !port || connecting || closing || Date.now()-received>10000;
 }
 $('settings-save').disabled=!!appearance?.loading || !settingsDirty || !!settingsPending || !port || connecting || closing || Date.now()-received>10000;
}
let connecting = false, closing = false, hiddenBefore = -1, toastTimer;
const supported = window.isSecureContext && "serial" in navigator;
function toast(message) {
 const notification=$("toast");
 // A modal dialog lives in the browser top layer. Keep its notifications inside it.
 const modal=[...(document.querySelectorAll?.('dialog[open]')||[])].at(-1);
 (modal || document.body).append(notification);
 notification.textContent=message;
 notification.classList.add("show");
 clearTimeout(toastTimer);
 toastTimer=setTimeout(()=>notification.classList.remove("show"),5000);
}
function notice(text) { if(text) toast(text); }
function button() { $("connect").disabled=connecting || !supported; $("connect").querySelector("span").textContent=connecting ? "Ищем термометр…" : "Подключить термометр"; }
function render() {
 const live = !!port && !!last && !connecting && !closing;
 $("disconnected-view").hidden=live; $("connected-view").hidden=!live;
 $("technical").hidden=!live;
 const stale = live && Date.now()-received>10000;
 const oldMeasure = live && last.measurement_age_ms !== null && last.measurement_age_ms+Date.now()-received>Math.max(30000,(last.sample_interval_ms || 5000)*2+2000);
 const error = live && (last.probe!=="ok" || stale || oldMeasure);
 const badge=zigbeeBadge(last,live&&!stale);
 if($('zigbee-pill')){
  $('zigbee-pill').hidden=!showZigbeeBadge(last,live);
  $('zigbee-pill').className='status-pill zigbee-pill '+badge.tone;
  $('zigbee-pill').title=badge.label;
  $('zigbee-pill').setAttribute('aria-label',badge.label);
 }
 $("status-pill").className="status-pill"+(live ? error ? " error" : " connected" : "");
 $("status-pill").querySelector("span").textContent=connecting ? "Подключение…" : live ? stale ? "Нет ответа" : error ? "Нужна проверка" : "Подключён" : "Не подключён";
 if(live) {
  $("temperature").textContent=error ? "—" : last.temperature_c.toLocaleString("ru-RU",{minimumFractionDigits:1,maximumFractionDigits:1});
  $("reading-caption").textContent=stale ? "Связь с термометром прервана" : last.measurement_age_ms===null ? "Ожидаем первое измерение" : `Измерено ${duration(last.measurement_age_ms+Date.now()-received)} назад`;
  $("health-box").className="health-box"+(error ? " error" : "");
  $("health-title").textContent=stale ? "Термометр не отвечает" : oldMeasure ? "Показание устарело" : last.probe==="waiting" ? "Ждём показания щупа" : error ? "Не удаётся прочитать температуру" : "Щуп работает нормально";
  $("health-text").textContent=stale ? "Переподключите USB-кабель и подключитесь заново." : error ? "Если ошибка сохраняется, отключите питание и проверьте соединение щупа." : "Показания получены по USB. Доставка в Алису проверяется в приложении.";
  $("health-box").querySelector("use").setAttribute("href",error ? "#info" : "#check");
  $("uptime").textContent=duration(last.uptime_ms+(stale ? 0 : Date.now()-received));
  $("firmware").textContent=last.firmware;
  $("error-count").textContent=String(last.probe_errors);
 }
 const panel=$('settings-panel');
 appearance?.sync(last,{connected:live,open:!!panel?.open,force:!settingsLoaded,pending:!!settingsPending||stale});
 const settingsAvailable=live && !!last.settings && /^(?:0\.(?:[3-9]|[1-9]\d)|[1-9]\d*\.)/.test(last.firmware);
 if(panel) {
  $('settings-open').hidden=!settingsAvailable;
  if(!settingsAvailable && panel.open) closeDialog(panel);
  if(settingsAvailable && (!settingsLoaded || (!settingsDirty && !settingsPending && !panel.open))) {
   showBrightness(last.settings.brightness);
   updateStepSlider('sample',last.settings.sample_seconds,true);
   updateStepSlider('report',last.settings.report_seconds,true);
   updateStepSlider('delta',last.settings.delta_centi/100,true);
   offsetCenti=last.settings.offset_centi ?? 0;
   settingsLoaded=true;
  }
  renderCalibration();
  updateSettingsButton();
 }
 renderUpdateEntry();
 button();
}
function logs() {
 const events=last ? last.events.filter(e=>e.seq>hiddenBefore) : [];
 $("log").textContent=events.length ? events.map(e=>`[${duration(e.ms)}] ${eventText(e.message)}`).join("\n") : last ? "Новых событий пока нет." : "Подключите термометр, чтобы увидеть события.";
}
async function send(command="AQ1 SNAPSHOT") {
 if(!port?.writable || closing || activeWriter) return;
 const writer=port.writable.getWriter(); activeWriter=writer;
 try { await writer.write(new TextEncoder().encode(command+"\n")); }
 finally { writer.releaseLock(); activeWriter=null; }
}
async function readLoop(activePort) {
 reader=activePort.readable.getReader();
 const decoder=new TextDecoder(); let buffer="";
 try {
  while(true) {
   const {value,done}=await reader.read(); if(done) break;
   buffer+=decoder.decode(value,{stream:true});
   let index;
   while((index=buffer.indexOf("\n"))>=0) {
    const line=buffer.slice(0,index).trim(); buffer=buffer.slice(index+1);
    if(line.startsWith("@AQSET ") && settingsPending) {
     try { const ack=JSON.parse(line.slice("@AQSET ".length)); if(ack.ok===true && settingsResetPending)resetSnapshotExpected=true; settingsPending(ack.ok===true); } catch {}
     continue;
    }
    const frame=parseFrame(line); if(!frame) continue;
    if(last && frame.uptime_ms<last.uptime_ms) hiddenBefore=-1;
    if(resetSnapshotExpected){settingsLoaded=false;settingsDirty=false;resetSnapshotExpected=false;}
    last=frame; received=Date.now(); capturedAt=new Date(); logs(); render();
   }
   if(buffer.length>65536) buffer="";
  }
 } catch { if(!closing) notice("USB-соединение прервано. Проверьте кабель и подключите термометр заново."); }
 finally { reader.releaseLock(); reader=null; }
}
async function disconnect(message="Термометр отключён.") {
 if(closing) return;
 if(settingsPending) settingsPending(false);
 closing=true; clearInterval(poll); poll=null;
 try { if(activeWriter) await activeWriter.abort(); if(reader) await reader.cancel(); if(reading) await reading; if(port) await port.close(); }
 catch { /* A removed USB device may already be closed. */ }
 finally { port=null; reading=null; connecting=false; closing=false; notice(message); render(); }
}
async function connect(existingPort=null) {
 if(connecting || port) return;
 connecting=true; calibrationRaw=null; settingsDirty=false; settingsLoaded=false; last=null; hiddenBefore=-1; notice(""); render();
 try {
  const selected=existingPort?.open ? existingPort : await navigator.serial.requestPort({filters:[{usbVendorId:0x303a,usbProductId:0x1001}]});
  await selected.open({baudRate:115200}); port=selected;
  reading=readLoop(selected);
  const started=Date.now();
  while(!last && Date.now()-started<10000) {
   await send(); await new Promise(resolve=>setTimeout(resolve,400));
  }
  if(!last) throw new Error("identity");
  connecting=false; notice(""); render();
  void checkFirmwareUpdate();
  poll=setInterval(()=>send().catch(()=>disconnect("Связь потеряна. Переподключите термометр.")),2000);
  reading.then(()=>{ if(port && !closing) disconnect("USB-соединение закрыто. Подключите термометр заново."); });
 } catch(error) {
  const message=error.name==='NotFoundError' ? '' : 'Не удалось подключить термометр. Проверьте USB-кабель, разрешите подключение в браузере и убедитесь, что устройство не используется другой программой.';
  if(port) await disconnect(message); else { connecting=false; notice(message); render(); }
 }
}
$("connect").addEventListener("click",connect);
$("disconnect").addEventListener("click",()=>disconnect());
$("download").addEventListener("click",()=>{
 if(!last || !capturedAt) return;
 const url=URL.createObjectURL(new Blob(["\ufeff",report(last,capturedAt,!!port)],{type:"text/plain;charset=utf-8"}));
 const a=document.createElement("a"); a.href=url; a.download=`aquarium-diagnostics-${capturedAt.toISOString().replace(/[:.]/g,"-")}.txt`; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000); toast("Отчёт сохранён на ваш компьютер");
});
$("clear-log").addEventListener("click",()=>{hiddenBefore=last?.events.at(-1)?.seq ?? -1;logs();toast("Очищен только экран журнала; отчёт сохранит события устройства");});
$("help").addEventListener("click",()=>openDialog($('help-dialog')));
document.querySelectorAll(".dialog-close,.dialog-done").forEach(b=>b.addEventListener("click",()=>closeDialog($('help-dialog'))));
if(supported) navigator.serial.addEventListener("disconnect",event=>{if(event.target===port) disconnect("Кабель отключён. Подключите термометр заново.");});
setInterval(render,1000);
if($('browser-error')) $('browser-error').hidden=supported;
render();

async function persistSettings(command,value=null,resetting=false){
 settingsResetPending=resetting;
  clearInterval(poll);poll=null;
  try {
   // Finish any snapshot write before acquiring the serial writer for settings.
   while(activeWriter) await new Promise(resolve=>setTimeout(resolve,20));
   const result=new Promise(resolve=>{
    const timeout=setTimeout(()=>{settingsPending=null;resolve(false);},5000);
    settingsPending=ok=>{clearTimeout(timeout);settingsPending=null;resolve(ok);};
   });
   render();
   await send(command);
   const ok=await result;
   if(ok){if(value){last.settings={...value};settingsLoaded=false;}settingsDirty=false;await send();}
   if(ok && resetting)closeDialog($('settings-reset-dialog'));
   toast(ok ? resetting ? 'Настройки сброшены' : 'Настройки сохранены' : 'Сохранение не подтверждено. Переподключитесь и проверьте значения.');
  } catch {if(settingsPending)settingsPending(false);toast('Не удалось сохранить настройки. Проверьте USB-подключение.');}
  finally {settingsResetPending=false;if(resetting){$('settings-reset-confirm').disabled=false;$('settings-reset-cancel').disabled=false;} if(port && !closing)poll=setInterval(()=>send().catch(()=>disconnect("Связь потеряна. Переподключите термометр.")),2000);render();}
}
if($('settings-form')) {
 $('settings-form').addEventListener('input',updateSettingsButton);
 $('settings-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if(!port || !last?.settings || !settingsDirty || settingsPending || appearance?.loading || !$('settings-form').reportValidity())return;
  const value=formSettings();
  await persistSettings('AQ1 SETTINGS '+JSON.stringify(value),value);
 });
}
$('settings-reset')?.addEventListener('click',()=>{
 if(!port||settingsPending||last?.settings_reset!==true)return;
 if($('reset-description'))$('reset-description').textContent='Яркость, интервалы измерения и отправки, порог изменения и поправка температуры вернутся к значениям прошивки по умолчанию. Несохранённые изменения будут отменены.'+(supportsDeviceTheme(last)?' Оформление вернётся к теме «Травник».':'');
 openDialog($('settings-reset-dialog'));
});
$('settings-reset-cancel')?.addEventListener('click',()=>closeDialog($('settings-reset-dialog')));
$('settings-reset-dialog')?.addEventListener('cancel',event=>{if(settingsPending)event.preventDefault();});
$('settings-reset-confirm')?.addEventListener('click',async()=>{
 if(!port||settingsPending||last?.settings_reset!==true)return;
 $('settings-reset-confirm').disabled=true;$('settings-reset-cancel').disabled=true;
 await persistSettings('AQ1 RESET_SETTINGS',null,true);
});

$('settings-open')?.addEventListener('click',()=>{
 if(!settingsDirty) {
  const fresh=measurementFresh() && Number.isFinite(last.raw_temperature_c);
  calibrationRaw=fresh ? last.raw_temperature_c : null;
 }
 renderCalibration();
 openDialog($('settings-panel'));
});
$('settings-close')?.addEventListener('click',()=>closeDialog($('settings-panel')));
$('settings-panel')?.addEventListener('click',event=>{if(event.target===$('settings-panel')){const rect=event.target.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeDialog(event.target);}});

function brightnessChanged(event) {
 const value=brightnessLevels[Number(event.target.value)];
 if(value===undefined)return;
 settingsDirty=true;
 showBrightness(value,false);
 updateSettingsButton();
}
$('setting-brightness')?.addEventListener('input',brightnessChanged);
$('setting-brightness')?.addEventListener('change',brightnessChanged);

for(const key of ['sample','report','delta']) {
 const changed=event=>{
  const options=sliderOptions[key] || sliderPresets[key];
  updateStepSlider(key,options[Number(event.target.value)]);
  updateSettingsButton();
 };
 $('setting-'+key)?.addEventListener('input',changed);
 $('setting-'+key)?.addEventListener('change',changed);
}

function renderCalibration() {
 const supported=!!last?.settings && Object.hasOwn(last.settings,'offset_centi');
 $('calibration').hidden=!supported;
 if(!supported)return;
 const available=calibrationRaw!==null;
 $('calibration-unavailable').hidden=available;
 $('calibration-offset').textContent=(offsetCenti>0?'+':'')+(offsetCenti/100).toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1})+' °C';
 $('calibration-reference').textContent=available ? ((Math.round(calibrationRaw*10)*10+offsetCenti)/100).toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1})+' °C' : '—';
 $('calibration-minus').disabled=!available || !!settingsPending || offsetCenti<=-500;
 $('calibration-plus').disabled=!available || !!settingsPending || offsetCenti>=500;
}
for(const [id,step] of [['calibration-minus',-10],['calibration-plus',10]]) {
 $(id)?.addEventListener('click',()=>{
  if(calibrationRaw===null || settingsPending)return;
  offsetCenti=Math.max(-500,Math.min(500,offsetCenti+step));
  renderCalibration();updateSettingsButton();
 });
}

// Keep a visible notification on screen when its dialog closes.
for(const dialog of document.querySelectorAll('dialog')) {
 dialog.addEventListener('close',()=>{
  const notification=$('toast');
  if(notification.parentElement===dialog)document.body.append(notification);
 });
}


function renderUpdateEntry() {
 const button=$('update-open');if(!button)return;
 const version=s=>/^\d+\.\d+(?:\.\d+)?$/.test(s||'')?s.split('.').map(Number):null;
 const current=version(last?.firmware),latest=version(latestFirmware);
 let newer=false;
 if(current&&latest)for(let i=0;i<3;i++){if((latest[i]||0)!==(current[i]||0)){newer=(latest[i]||0)>(current[i]||0);break;}}
 const card=$('update-card');
 if(card)card.hidden=!(port && newer && !connecting);
 button.hidden=false;
 if(newer){
  button.textContent='Обновить';
  button.title='Установить версию '+latestFirmware;
 }
}
async function openInstaller(mode) {
 if(mode==='update')await disconnect('');
 $('install-mode').value=mode;
 $('install-mode').dispatchEvent(new Event('change'));
 $('install-title').textContent=mode==='initial'?'Установка прошивки':'Обновление прошивки';
 $('install-explanation').textContent=(mode==='initial'?'Проверьте сборку при отключённом USB, затем подключите плату. Установим последнюю доступную версию.':'Обновление сохраняет настройки и Zigbee-привязку. Выберите ту же плату в окне браузера.')+'\nНе отключайте питание во время обновления — это может повредить прошивку и потребовать восстановления устройства.';
 openDialog($('install-dialog'));
}
$('install-open')?.addEventListener('click',()=>openInstaller('initial'));
$('update-open')?.addEventListener('click',()=>openInstaller('update'));
$('install-close')?.addEventListener('click',()=>closeDialog($('install-dialog')));
async function finishInstallation(event){
 const installStatus=text=>{ $('install-status').textContent=text; };
 if(!event.detail?.restarted){
  installStatus('Прошивка установлена. Перезапуск не выполнен. Переподключите USB, затем закройте это окно и подключите термометр.');
  return;
 }
 installStatus('Прошивка установлена. Ждём перезапуска термометра…');
 try{
  // The installer dispatches only after releasing its reader and closing the port.
  await new Promise(resolve=>setTimeout(resolve,3000));
  const ports=await navigator.serial.getPorts();
  const candidates=ports.filter(candidate=>{const info=candidate.getInfo();return info.usbVendorId===0x303a&&info.usbProductId===0x1001;});
  const selected=candidates.includes(event.detail.port)?event.detail.port:candidates.length===1?candidates[0]:null;
  if(!selected)throw new Error('Порт не найден однозначно');

  installStatus('Прошивка установлена. Подключаем термометр…');
  await connect(selected);
  if(!port||!last)throw new Error('Нет ответа термометра');

  installStatus('Термометр запустился. Проверяем работу новой прошивки…');
  const deadline=Date.now()+35000;
  while(port && installationState(last,event.detail.version)==='waiting' && Date.now()<deadline){
   await new Promise(resolve=>setTimeout(resolve,250));
  }
  const state=installationState(last,event.detail.version);
  if(state==='rolled_back'){
   installStatus('Новая прошивка не прошла проверку запуска. Термометр вернулся к версии '+last.firmware+'. Настройки сохранены. Можно закрыть окно и повторить обновление.');
   return;
  }
  if(!port || state!=='confirmed'){
   installStatus('Запись завершена, но проверка запуска не подтверждена. Переподключите термометр и проверьте его версию.');
   return;
  }
  installStatus('Прошивка установлена. Термометр подключён.');
  closeDialog($('install-dialog'));
  notice('');
 }catch(error){

  notice('');
  installStatus('Прошивка установлена. Не удалось подключиться автоматически. Переподключите USB, затем закройте это окно и нажмите «Подключить термометр».');
 }
}
document.addEventListener?.('firmware-installed',event=>{event.detail.completion=finishInstallation(event);});

let updateCheckPending=null;
function checkFirmwareUpdate(){
 if(typeof fetch!=='function'||typeof window.location==='undefined')return Promise.resolve();
 if(updateCheckPending)return updateCheckPending;
 updateCheckPending=(async()=>{
  try{
   const url=new URL('./firmware/manifest.json',import.meta.url);
   const response=await fetch(url,{cache:'no-store'});
   if(!response.ok)throw new Error('manifest');
   const manifest=await response.json();
   if(!/^\d+\.\d+(?:\.\d+)?$/.test(manifest?.version||''))throw new Error('version');
   latestFirmware=manifest.version;
   renderUpdateEntry();
  }catch{
   if(port)toast('Не удалось проверить обновления. Обновите страницу и попробуйте снова.');
  }finally{updateCheckPending=null;}
 })();
 return updateCheckPending;
}
void checkFirmwareUpdate();

// Escape follows the same animation; keep operation guards from the forms/installer.
for(const dialog of document.querySelectorAll('dialog')){
 dialog.addEventListener('cancel',event=>{
  if(event.defaultPrevented)return;
  event.preventDefault();
  if(dialog.id==='install-dialog' && $('install-close').disabled)return;
  if(dialog.id==='settings-reset-dialog' && settingsPending)return;
  closeDialog(dialog);
 });
}
