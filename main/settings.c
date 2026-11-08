/*
 * Постоянные настройки
 * Числовые параметры проверяются до обращения к NVS; RAM обновляется только после успешного сохранения.
 * Размеры и номера схем относятся к формату данных, а не к версии продукта. Менять их при переименовании релиза нельзя.
 * Тема хранится отдельно: старый бинарный формат измерений остаётся читаемым при откате.
 * Две записи NVS не являются одной транзакцией: после обрыва питания возможна смесь прежних и новых значений.
 */
/* SPDX-License-Identifier: MIT */
#include "settings.h"
#include "sdkconfig.h"
#include "nvs.h"
#include <stdint.h>
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
enum { SETTINGS_SCHEMA = 2, THEME_COUNT = 4 };
typedef struct {
    uint32_t schema;
    int32_t brightness, sample, report, delta, offset;
} settings_record_t;
_Static_assert(sizeof(settings_record_t) == 24, "NVS schema layout changed");
static SemaphoreHandle_t mutex;
static aquarium_settings_t current;
static bool future_schema;
static bool valid(aquarium_settings_t v) {
    return v.brightness >= 0 && v.brightness <= 255 && v.sample_seconds >= 2 && v.sample_seconds <= 3600 &&
        v.report_seconds >= 5 && v.report_seconds <= 3600 && v.delta_centi >= 1 && v.delta_centi <= 1000 && v.offset_centi >= -500 && v.offset_centi <= 500 && v.offset_centi % 10 == 0 && v.theme >= 0 && v.theme < THEME_COUNT;
}
aquarium_settings_t settings_defaults(void) {
    return (aquarium_settings_t){CONFIG_AQUARIUM_RGB_BRIGHTNESS, CONFIG_AQUARIUM_SAMPLE_SECONDS,
        CONFIG_AQUARIUM_REPORT_SECONDS, CONFIG_AQUARIUM_DELTA_CENTI, 0, 0};
}
/* Загрузка не мигрирует данные записью при старте: откат должен иметь возможность прочитать прежнюю запись. Неизвестные размеры и будущие схемы защищены от последующего сохранения. */
void settings_init(void) {
    mutex = xSemaphoreCreateMutex();
    ESP_ERROR_CHECK(mutex ? ESP_OK : ESP_ERR_NO_MEM);
    current = settings_defaults();
    future_schema = false;
    nvs_handle_t h;
    esp_err_t err = nvs_open("aq_settings", NVS_READONLY, &h);
    if (err == ESP_ERR_NVS_NOT_FOUND) return;
    ESP_ERROR_CHECK(err);
    // One versioned record keeps all settings atomic across power loss.
    settings_record_t record;
    size_t size=sizeof(record);
    err=nvs_get_blob(h,"config",&record,&size);
    if(err==ESP_OK && size>=sizeof(uint32_t)) {
        future_schema=record.schema>SETTINGS_SCHEMA;
        if((record.schema==1 && size==sizeof(record)-sizeof(int32_t)) || (record.schema==SETTINGS_SCHEMA && size==sizeof(record))) {
            aquarium_settings_t v={record.brightness,record.sample,record.report,record.delta,record.schema==1 ? 0 : record.offset,0};
            if(valid(v)) current=v;
        }
    } else if(err!=ESP_ERR_NVS_NOT_FOUND) {
        // Unknown record sizes are preserved until a compatible firmware is installed.
        future_schema=true;
    }
    // Keep schema 2 unchanged so rollback to 0.7 retains measurement settings.
    // Appearance is independent; older firmware/pages simply ignore this key.
    int32_t theme = 0;
    if (nvs_get_i32(h, "theme", &theme) == ESP_OK && theme >= 0 && theme < THEME_COUNT)
        current.theme = theme;
    nvs_close(h);
}
aquarium_settings_t settings_get(void) {
    xSemaphoreTake(mutex,portMAX_DELAY); aquarium_settings_t v=current; xSemaphoreGive(mutex); return v;
}
/* Вызывается последовательно USB-задачей. Mutex защищает копию в RAM от задач измерения и индикации. NVS закрывается на всех путях; ошибка не заменяет действующую RAM-копию. Измерения и тема — отдельные записи, не общая транзакция. */
esp_err_t settings_save(aquarium_settings_t v) {
    if (!valid(v)) return ESP_ERR_INVALID_ARG;
    if (future_schema) return ESP_ERR_NOT_SUPPORTED;
    nvs_handle_t h; esp_err_t e=nvs_open("aq_settings",NVS_READWRITE,&h);
    if(e!=ESP_OK) return e;
    const settings_record_t record={SETTINGS_SCHEMA,v.brightness,v.sample_seconds,v.report_seconds,v.delta_centi,v.offset_centi};
    e=nvs_set_blob(h,"config",&record,sizeof(record));
    if(e==ESP_OK)e=nvs_set_i32(h,"theme",v.theme);
    if(e==ESP_OK)e=nvs_commit(h);
    nvs_close(h);
    if(e==ESP_OK){xSemaphoreTake(mutex,portMAX_DELAY);current=v;xSemaphoreGive(mutex);}
    return e;
}

esp_err_t settings_reset(void) {
    return settings_save(settings_defaults());
}
