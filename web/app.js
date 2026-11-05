import {parseFrame, duration, report, eventText} from "./protocol.js";
const $ = id => document.getElementById(id);
let port = null, reader = null, reading = null, poll = null, last = null, received = 0, capturedAt = null;
let activeWriter = null;
let connecting = false, closing = false, hiddenBefore = -1, toastTimer;
const supported = window.isSecureContext && "serial" in navigator;
function toast(message) { $("toast").textContent = message; $("toast").classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$("toast").classList.remove("show"),5000); }
function notice(text) { $("connection-notice").textContent=text; $("connection-notice").hidden=!text; }
function button() { $("connect").disabled=connecting || !supported; $("connect").querySelector("span").textContent=connecting ? "Ищем термометр…" : "Подключить термометр"; }
function render() {
 const live = !!port && !!last && !connecting && !closing;
 $("disconnected-view").hidden=live; $("connected-view").hidden=!live;
 const stale = live && Date.now()-received>10000;
 const oldMeasure = live && last.measurement_age_ms !== null && last.measurement_age_ms+Date.now()-received>Math.max(30000,(last.sample_interval_ms || 5000)*2+2000);
 const error = live && (last.probe!=="ok" || stale || oldMeasure);
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
 button();
}
function logs() {
 const events=last ? last.events.filter(e=>e.seq>hiddenBefore) : [];
 $("log").textContent=events.length ? events.map(e=>`[${duration(e.ms)}] ${eventText(e.message)}`).join("\n") : last ? "Новых событий пока нет." : "Подключите термометр, чтобы увидеть события.";
}
async function send() {
 if(!port?.writable || closing || activeWriter) return;
 const writer=port.writable.getWriter(); activeWriter=writer;
 try { await writer.write(new TextEncoder().encode("AQ1 SNAPSHOT\n")); }
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
    const frame=parseFrame(line); if(!frame) continue;
    if(last && frame.uptime_ms<last.uptime_ms) hiddenBefore=-1;
    last=frame; received=Date.now(); capturedAt=new Date(); logs(); render();
   }
   if(buffer.length>65536) buffer="";
  }
 } catch { if(!closing) notice("USB-соединение прервано. Проверьте кабель и подключите термометр заново."); }
 finally { reader.releaseLock(); reader=null; }
}
async function disconnect(message="Термометр отключён.") {
 if(closing) return;
 closing=true; clearInterval(poll); poll=null;
 try { if(activeWriter) await activeWriter.abort(); if(reader) await reader.cancel(); if(reading) await reading; if(port) await port.close(); }
 catch { /* A removed USB device may already be closed. */ }
 finally { port=null; reading=null; connecting=false; closing=false; notice(message); render(); }
}
async function connect() {
 if(connecting || port) return;
 connecting=true; last=null; hiddenBefore=-1; notice(""); render();
 try {
  const selected=await navigator.serial.requestPort({filters:[{usbVendorId:0x303a,usbProductId:0x1001}]});
  await selected.open({baudRate:115200}); port=selected;
  reading=readLoop(selected);
  const started=Date.now();
  while(!last && Date.now()-started<10000) {
   await send(); await new Promise(resolve=>setTimeout(resolve,400));
  }
  if(!last) throw new Error("identity");
  connecting=false; notice(""); render();
  poll=setInterval(()=>send().catch(()=>disconnect("Связь потеряна. Переподключите термометр.")),2000);
  reading.then(()=>{ if(port && !closing) disconnect("USB-соединение закрыто. Подключите термометр заново."); });
 } catch(error) {
  let message=error.name==="NotFoundError" ? "Подключение отменено. Вы можете выбрать термометр ещё раз." :
   error.message==="identity" ? "Устройство не ответило как наш термометр. Проверьте порт и установите прошивку с USB-диагностикой." :
   error.name==="NetworkError" || error.name==="InvalidStateError" ? "Не удалось открыть USB-порт. Закройте монитор VS Code и другие программы, использующие термометр." : "Не удалось подключиться. Проверьте USB-кабель и разрешение браузера.";
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
$("help").addEventListener("click",()=>$("help-dialog").showModal());
document.querySelectorAll(".dialog-close,.dialog-done").forEach(b=>b.addEventListener("click",()=>$("help-dialog").close()));
if(supported) navigator.serial.addEventListener("disconnect",event=>{if(event.target===port) disconnect("Кабель отключён. Подключите термометр заново.");});
setInterval(render,1000);
if(!supported) notice("Этот браузер не поддерживает USB-подключение на этой странице. Откройте её в Chrome на компьютере по HTTPS или через localhost.");
render();
