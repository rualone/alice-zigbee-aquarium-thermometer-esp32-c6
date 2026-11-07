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

import {zigbeeView,ZIGBEE_STATES} from '../protocol.js';
test('Zigbee states are optional for old firmware and validated for new firmware',()=>{
 assert.ok(parseFrame(frame(data)));
 for(const state of Object.keys(ZIGBEE_STATES)){
  const d={...data,zigbee:{state,reason:'initialization',state_age_ms:1200}};
  assert.ok(parseFrame(frame(d)));assert.equal(zigbeeView(d).title,ZIGBEE_STATES[state].title);
 }
 for(const zigbee of [null,{}, {state:'joined',reason:'joined',state_age_ms:-1},{state:'invented',reason:'joined',state_age_ms:1}])assert.equal(parseFrame(frame({...data,zigbee})),null);
 assert.match(zigbeeView(data).description,/0.5/);
});
test('stale USB never claims a current Zigbee connection and reports preserve state evidence',()=>{
 const d={...data,zigbee:{state:'lost',reason:'parent_lost',state_age_ms:6000}};
 assert.match(zigbeeView(d,true).title,/Нет свежих/);
 assert.equal(zigbeeView(d,true).age,null);
 assert.match(eventText('Zigbee: lost (parent_lost)'),/Связь с сетью потеряна/);
 const text=report(d,new Date(),true);
 assert.match(text,/потере родительского устройства/);assert.match(text,/6 с/);
 assert.match(text,/не подтверждает/);
});
test('saved membership stays unverified; only coordinator response is shown as reachable',()=>{
 const view=(state,reason)=>zigbeeView({...data,zigbee:{state,reason,state_age_ms:1000}});
 assert.equal(view('checking','saved_network').tone,'waiting');
 assert.match(view('checking','saved_network').description,/Ожидаем ответ/);
 assert.match(view('joined','coordinator_response').title,/Хаб отвечает/);
 assert.match(view('trouble','probe_timeout').description,/Две проверки/);
 assert.match(eventText('Zigbee: checking (saved_network)'),/ещё не проверена/);
});

import {zigbeeBadge} from '../protocol.js';
test('Zigbee badge is blue only on verified response; problems red; unpaired and stale gray',()=>{
 const d=(state,reason)=>({...data,zigbee:{state,reason,state_age_ms:1}});
 assert.equal(zigbeeBadge(d('joined','coordinator_response'),true).tone,'connected');
 assert.equal(zigbeeBadge(d('joined','restored'),true).tone,'neutral');
 for(const [state,reason] of [['lost','parent_lost'],['trouble','probe_timeout'],['checking','probe_retry']])assert.equal(zigbeeBadge(d(state,reason),true).tone,'error');
 assert.equal(zigbeeBadge(d('unpaired','local_reset'),true).tone,'neutral');
 assert.equal(zigbeeBadge(d('joined','coordinator_response'),false).tone,'neutral');
 for(const message of ['Zigbee: starting (initialization)','Zigbee: joined (coordinator_response)','Zigbee: checking (probe_retry)'])assert.doesNotMatch(eventText(message),/Zigbee:|coordinator_response|probe_retry/);
});

import {showZigbeeBadge} from '../protocol.js';
test('Zigbee badge requires USB, firmware 0.5+ and actual diagnostic state',()=>{
 const d={...data,firmware:'0.5',zigbee:{state:'joined',reason:'coordinator_response',state_age_ms:1}};
 assert.equal(showZigbeeBadge(d,true),true);
 assert.equal(showZigbeeBadge(d,false),false);
 for(const firmware of ['0.3','0.4','unknown'])assert.equal(showZigbeeBadge({...d,firmware},true),false);
 for(const firmware of ['0.5','0.5.1','0.10','1.0'])assert.equal(showZigbeeBadge({...d,firmware},true),true);
 assert.equal(showZigbeeBadge({...d,zigbee:undefined},true),false);
});
