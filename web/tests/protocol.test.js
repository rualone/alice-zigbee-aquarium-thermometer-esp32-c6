import {test} from "node:test";
import assert from "node:assert/strict";
import {parseFrame,report,DEVICE} from "../protocol.js";
const data={device:DEVICE,protocol:1,type:"snapshot",firmware:"0.2",uptime_ms:10000,reset_reason:1,probe:"ok",temperature_c:28,measurement_age_ms:100,probe_errors:0,report_failures:0,zigbee_joined:true,report_age_ms:200,events:[{seq:1,ms:20,message:"Started"}]};
const frame=d=>"@AQ1 "+JSON.stringify(d);
test("recognizes device snapshot and ignores ordinary console logs",()=>{assert.equal(parseFrame("I (10) temperature 28 C"),null);assert.deepEqual(parseFrame(frame(data)),data);});
test("rejects unrelated devices, unsupported protocol, malformed or oversized events",()=>{for(const d of [{...data,device:"other"},{...data,protocol:2},{...data,temperature_c:999},{...data,events:Array(65).fill(data.events[0])},{...data,events:[{seq:1,ms:0,message:12}]}])assert.equal(parseFrame(frame(d)),null);assert.equal(parseFrame("@AQ1 {bad"),null);});
test("probe failure has no plausible substitute temperature",()=>{assert.ok(parseFrame(frame({...data,probe:"error",temperature_c:null})));assert.equal(parseFrame(frame({...data,temperature_c:null})),null);});
test("download report labels snapshot age, no delivery guarantee, and RAM limits",()=>{const text=report(data,new Date("2026-11-05T12:00:00Z"),false);assert.match(text,/сохранённый снимок/);assert.match(text,/не подтверждает/);assert.match(text,/64 события/);assert.match(text,/Started/);});

import {eventText} from "../protocol.js";
test("translates every current firmware event and retains error codes",()=>{
 const cases=[
 ["Device started; diagnostics protocol v1",/включился и готов к работе/],
 ["Water temperature: 28.00 C",/28,0 °C/],
 ["Probe error: ESP_ERR_NOT_FOUND",/Щуп не найден.*ESP_ERR_NOT_FOUND/],
 ["Probe error: ESP_ERR_TIMEOUT",/Щуп не отвечает.*ESP_ERR_TIMEOUT/],
 ["Probe error: ESP_ERR_INVALID_CRC",/Не удалось проверить данные щупа.*ESP_ERR_INVALID_CRC/],
 ["Probe error: ESP_ERR_INVALID_STATE",/работе со щупом/],
 ["Probe error: ESP_ERR_INVALID_RESPONSE",/некорректные данные/],
 ["Probe error: ESP_ERR_INVALID_ARG",/ошибка при чтении температуры/],
 ["Probe error: ESP_ERR_NO_MEM",/выделить память/],
 ["Probe error: ESP_FAIL",/считать показания/],
 ["Probe error: ESP_OK",/вышли за допустимые пределы/],
 ["Probe error: ESP_ERR_SOMETHING",/Неизвестная ошибка щупа.*ESP_ERR_SOMETHING/],
 ["Zigbee local state: joined",/подключился к хабу/],
 ["Zigbee local state: searching/offline",/ищет хаб/],
 ["Temperature report queued; delivery not confirmed",/Отправляем данные о температуре в хаб/],
 ["Cannot queue temperature report",/Не удалось отправить данные о температуре/],
 ["Pairing reset requested by BOOT",/сброс подключения к хабу/]];
 for(const [source,expected] of cases)assert.match(eventText(source),expected);
 assert.equal(eventText("Future event"),"Future event");
 const text=report({...data,events:[{seq:1,ms:1,message:"Water temperature: 28.00 C"}]},new Date(),true);
 assert.match(text,/Температура воды — 28,0 °C/);assert.doesNotMatch(text,/Water temperature/);
});
