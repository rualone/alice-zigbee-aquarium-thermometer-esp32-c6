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
  return d;
}
export function duration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s >= 3600 ? `${Math.floor(s/3600)} ч ${Math.floor(s%3600/60)} мин` : s >= 60 ? `${Math.floor(s/60)} мин ${s%60} с` : `${s} с`;
}
export function eventText(message) {
 const fixed = {
  "Device started; diagnostics protocol v1": "Термометр включился и готов к работе.",
  "Zigbee local state: joined": "Термометр подключился к хабу.",
  "Zigbee local state: searching/offline": "Термометр ищет хаб.",
  "Temperature report queued; delivery not confirmed": "Отправляем данные о температуре в хаб.",
  "Cannot queue temperature report": "Не удалось отправить данные о температуре.",
  "Pairing reset requested by BOOT": "Запрошен сброс подключения к хабу."
 };
 if (Object.hasOwn(fixed, message)) return fixed[message];
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
 `Возраст измерения при получении: ${d.measurement_age_ms === null ? "нет" : duration(d.measurement_age_ms)}`,
 `Ошибки чтения: ${d.probe_errors}`, `Ошибки постановки отчёта в очередь: ${d.report_failures}`,
 `Локальное состояние Zigbee: ${d.zigbee_joined ? "сеть сохранена/подключена" : "ожидание сети"}`,
 "Статус Zigbee не подтверждает доступность Миди и доставку показаний.",
 `Последний отчёт в очереди: ${typeof d.report_age_ms === "number" ? duration(d.report_age_ms) + " назад" : "ещё не было"}`,
 "Журнал хранится в RAM и очищается при перезапуске; только последние 64 события.", "", "События (время от запуска):",
 ...d.events.map(e => `[${duration(e.ms)}] ${eventText(e.message)}`)].join("\n");
}
