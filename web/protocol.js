/*
 * Граница доверия USB-протокола
 * Сырые строки порта могут содержать ESP_LOG, неполный JSON и ответы другого устройства.
 * В интерфейс допускаются только проверенные снимки с правильным идентификатором и типами полей.
 * Необязательные поля сохраняют совместимость с ранними сборками; неизвестные события остаются в отчёте.
 */
export const ZIGBEE_STATES={
 checking:{title:'Проверяем связь с хабом',description:'Сеть сохранена. Ожидаем ответ координатора Zigbee.',tone:'waiting'},
 starting:{title:'Запускаем Zigbee',description:'Подготавливаем подключение к сети.',tone:'waiting'},
 searching:{title:'Ищем сеть',description:'Включите поиск Zigbee-устройств в приложении умного дома.',tone:'waiting'},
 joined:{title:'Хаб отвечает',description:'Получен ответ координатора Zigbee на проверочный запрос. Это не подтверждает получение температуры Алисой.',tone:'ok'},
 trouble:{title:'Хаб не отвечает',description:'Две проверки подряд не получили успешный ответ. Проверьте питание хаба. Повторные проверки продолжаются.',tone:'warning'},
 lost:{title:'Связь с сетью потеряна',description:'Проверьте питание хаба. Этот статус не означает, что привязка удалена.',tone:'warning'},
 unpaired:{title:'Требуется сопряжение',description:'Добавьте термометр в приложении умного дома.',tone:'warning'}
};
export const ZIGBEE_REASONS={
 saved_network:'Восстановлена конфигурация сети; связь ещё не проверена',joined_unverified:'Присоединение завершено; связь ещё не проверена',coordinator_response:'Получен ответ координатора',probe_timeout:'Две проверки без успешного ответа',probe_retry:'Первая проверка не получила успешный ответ; повторяем',
 initialization:'Запуск Zigbee',steering:'Начат поиск сети',join_failed:'Попытка присоединения не удалась',
 joined:'Успешное присоединение',restored:'Восстановлено участие в сохранённой сети',
 parent_lost:'Стек сообщил о потере родительского устройства',coordinator_unavailable:'Координатор недоступен для передачи',
 leave_rejoin:'Выход из сети с разрешением повторного присоединения',leave_reset:'Выход из сети со сбросом привязки',local_reset:'Сброс привязки кнопкой BOOT'
};
export function zigbeeView(d,stale=false){
 if(stale)return {title:'Нет свежих данных Zigbee',description:'Восстановите USB-подключение, чтобы проверить состояние сети.',tone:'waiting',reason:'Сохранённый снимок',age:null};
 if(!d.zigbee)return {title:d.zigbee_joined?'Сеть сохранена / подключена':'Ожидание сети',description:'Подробная диагностика Zigbee доступна с прошивкой 0.5.',tone:'waiting',reason:'Старая версия протокола диагностики',age:null};
 return {...ZIGBEE_STATES[d.zigbee.state],reason:ZIGBEE_REASONS[d.zigbee.reason]||d.zigbee.reason,age:d.zigbee.state_age_ms};
}
export const DEVICE = "alice-zigbee-aquarium-thermometer";
export function parseFrame(line) {
  if (!line.startsWith("@AQ1 ")) return null;
  let d; try { d = JSON.parse(line.slice(5)); } catch { return null; }
  const finite = n => typeof n === "number" && Number.isFinite(n);
  const natural = n => finite(n) && n >= 0;
  if (!d || d.device !== DEVICE || d.protocol !== 1 || d.type !== "snapshot" ||
      typeof d.firmware !== "string" || d.firmware.length > 64 || !natural(d.uptime_ms) ||
      !["ok","error","waiting"].includes(d.probe) ||
      !(d.temperature_c === null || finite(d.temperature_c) && d.temperature_c >= -55 && d.temperature_c <= 125) ||
      !(d.measurement_age_ms === null || natural(d.measurement_age_ms)) ||
      !natural(d.probe_errors) || !natural(d.report_failures) || typeof d.zigbee_joined !== "boolean" ||
      !Array.isArray(d.events) || d.events.length > 64 ||
      !d.events.every(e => e && natural(e.seq) && natural(e.ms) && typeof e.message === "string" && e.message.length <= 112)) return null;
  if (d.probe === "ok" && d.temperature_c === null) return null;
  if(d.zigbee!==undefined && (!d.zigbee || !Object.hasOwn(ZIGBEE_STATES,d.zigbee.state) ||
      typeof d.zigbee.reason!=='string' || d.zigbee.reason.length>40 || !natural(d.zigbee.state_age_ms)))return null;
  if(d.update_pending!==undefined && typeof d.update_pending!=="boolean")return null;
  if(d.theme_settings!==undefined && typeof d.theme_settings!=="boolean")return null;
  if(d.theme_settings===true && (!d.settings || !Number.isInteger(d.settings.theme) || d.settings.theme<0 || d.settings.theme>255))return null;
  return d;
}
export function duration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s >= 3600 ? `${Math.floor(s/3600)} ч ${Math.floor(s%3600/60)} мин` : s >= 60 ? `${Math.floor(s/60)} мин ${s%60} с` : `${s} с`;
}
export function eventText(message) {
 const fixed = {
  "Settings reset": "Настройки возвращены к значениям по умолчанию.",
  "Settings reset failed": "Не удалось сбросить настройки.",
  "Settings saved": "Настройки сохранены.",
  "Settings save failed": "Не удалось сохранить настройки.",
  "Device started; diagnostics protocol v1": "Термометр включился и готов к работе.",
  "Zigbee local state: joined": "Термометр подключился к хабу.",
  "Zigbee local state: searching/offline": "Термометр ищет хаб.",
  "Temperature report queued; delivery not confirmed": "Отправляем данные о температуре в хаб.",
  "Cannot queue temperature report": "Не удалось отправить данные о температуре.",
  "Pairing reset requested by BOOT": "Запрошен сброс подключения к хабу."
 };
 if (Object.hasOwn(fixed, message)) return fixed[message];
 const zigbee=/^Zigbee: ([a-z_]+) \(([a-z_]+)\)$/.exec(message);
 if(zigbee && ZIGBEE_STATES[zigbee[1]]){
  const messages={
   initialization:'Запускаем Zigbee.',saved_network:'Сеть сохранена. Связь с хабом ещё не проверена.',
   joined_unverified:'Термометр присоединился к сети. Проверяем связь с хабом.',
   coordinator_response:'Хаб ответил. Связь работает.',probe_retry:'Хаб пока не ответил. Проверяем ещё раз.',
   probe_timeout:'Хаб не отвечает. Проверьте его питание — мы продолжим проверять связь.',
   steering:'Ищем Zigbee-сеть. Включите поиск устройств в приложении умного дома.',
   join_failed:'Не удалось подключиться к сети. Попробуем ещё раз.',
   local_reset:'Привязка сброшена кнопкой BOOT.',leave_reset:'Термометр удалён из Zigbee-сети. Добавьте его заново.'
  };
  return messages[zigbee[2]]||`${ZIGBEE_STATES[zigbee[1]].title}. ${ZIGBEE_REASONS[zigbee[2]]||zigbee[2]}.`;
 }
 const measurement = /^Water temperature: (-?\d+(?:\.\d+)?) C$/.exec(message);
 if (measurement) return `Температура воды — ${Number(measurement[1]).toLocaleString("ru-RU", {minimumFractionDigits:1, maximumFractionDigits:1})} °C.`;
 const probe = /^Probe error: (.+)$/.exec(message);
 if (probe) {
  const descriptions = {
   ESP_ERR_NOT_FOUND: "Щуп не найден",
   ESP_ERR_TIMEOUT: "Щуп не отвечает",
   ESP_ERR_INVALID_CRC: "Не удалось проверить данные щупа",
   ESP_ERR_INVALID_STATE: "Возникла ошибка при работе со щупом",
   ESP_ERR_INVALID_RESPONSE: "Щуп прислал некорректные данные",
   ESP_ERR_INVALID_ARG: "Возникла ошибка при чтении температуры",
   ESP_ERR_NO_MEM: "Не удалось выделить память для чтения щупа",
   ESP_FAIL: "Не удалось считать показания щупа",
   ESP_OK: "Показания щупа вышли за допустимые пределы"
  };
  return `${descriptions[probe[1]] || "Неизвестная ошибка щупа"} (${probe[1]}).`;
 }
 // Keep unknown future messages rather than silently hiding diagnostic evidence.
 return message;
}
export function report(d, capturedAt, connected) {
 return ["Диагностика аквариумного термометра", `Получено: ${capturedAt.toISOString()}`,
 `Подключение в момент экспорта: ${connected ? "USB подключён" : "отключено; сохранённый снимок"}`,
 `Версия: ${d.firmware}`, `Время работы при получении: ${duration(d.uptime_ms)}`,
 `Причина запуска (код ESP-IDF): ${d.reset_reason}`, `Щуп: ${({ok:"исправен",error:"ошибка чтения",waiting:"ожидание измерения"})[d.probe] || d.probe}`,
 `Температура: ${d.temperature_c === null ? "нет действительного измерения" : d.temperature_c.toLocaleString("ru-RU", {minimumFractionDigits:1, maximumFractionDigits:1}) + " °C"}`,
 ...(typeof d.applied_offset_centi==='number' ? [`Исходная температура: ${d.raw_temperature_c===null ? 'нет' : Number(d.raw_temperature_c).toLocaleString('ru-RU')} °C`, `Применённая поправка: ${(d.applied_offset_centi/100).toLocaleString('ru-RU')} °C`] : []),
 `Возраст измерения при получении: ${d.measurement_age_ms === null ? "нет" : duration(d.measurement_age_ms)}`,
 `Ошибки чтения: ${d.probe_errors}`, `Ошибки постановки отчёта в очередь: ${d.report_failures}`,
 `Локальное состояние Zigbee: ${d.zigbee_joined ? "сеть сохранена/подключена" : "ожидание сети"}`,
 ...(d.zigbee ? [`Состояние Zigbee: ${zigbeeView(d).title}`,`Причина: ${zigbeeView(d).reason}`,`Длительность состояния при получении: ${duration(d.zigbee.state_age_ms)}`] : []),
 "Статус Zigbee не подтверждает доступность Миди и доставку показаний.",
 `Последний отчёт в очереди: ${typeof d.report_age_ms === "number" ? duration(d.report_age_ms) + " назад" : "ещё не было"}`,
 "Журнал хранится в RAM и очищается при перезапуске; только последние 64 события.", "", "События (время от запуска):",
 ...d.events.map(e => `[${duration(e.ms)}] ${eventText(e.message)}`)].join("\n");
}

export function zigbeeBadge(d,live){
 if(!live||!d?.zigbee)return {tone:'neutral',label:'Нет свежих данных о связи Zigbee'};
 const {state,reason}=d.zigbee;
 if(state==='joined'&&reason==='coordinator_response')return {tone:'connected',label:'Zigbee: хаб отвечает'};
 if(state==='trouble'||state==='lost'||reason==='probe_retry')return {tone:'error',label:'Zigbee: есть проблемы со связью'};
 return {tone:'neutral',label:state==='unpaired'||state==='searching'?'Zigbee: нет подключения к сети':'Zigbee: связь с хабом ещё не проверена'};
}

export function showZigbeeBadge(d,live){
 const version=/^(\d+)\.(\d+)(?:\.\d+)?$/.exec(d?.firmware||'');
 return !!live && !!d?.zigbee && !!version && (Number(version[1])>0 || Number(version[2])>=5);
}
