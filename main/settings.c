/* SPDX-License-Identifier: MIT */
#include "settings.h"
#include "sdkconfig.h"
#include "nvs.h"
#include <stdint.h>
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
static SemaphoreHandle_t mutex;
static aquarium_settings_t current;
static bool future_schema;
static bool valid(aquarium_settings_t v) {
    return v.brightness >= 0 && v.brightness <= 255 && v.sample_seconds >= 2 && v.sample_seconds <= 3600 &&
        v.report_seconds >= 5 && v.report_seconds <= 3600 && v.delta_centi >= 1 && v.delta_centi <= 1000 && v.offset_centi >= -500 && v.offset_centi <= 500 && v.offset_centi % 10 == 0;
}
void settings_init(void) {
    mutex = xSemaphoreCreateMutex();
    ESP_ERROR_CHECK(mutex ? ESP_OK : ESP_ERR_NO_MEM);
    current = (aquarium_settings_t){CONFIG_AQUARIUM_RGB_BRIGHTNESS, CONFIG_AQUARIUM_SAMPLE_SECONDS,
        CONFIG_AQUARIUM_REPORT_SECONDS, CONFIG_AQUARIUM_DELTA_CENTI, 0};
    nvs_handle_t h;
    esp_err_t err = nvs_open("aq_settings", NVS_READONLY, &h);
    if (err == ESP_ERR_NVS_NOT_FOUND) return;
    ESP_ERROR_CHECK(err);
    // One versioned record keeps all settings atomic across power loss.
    struct { uint32_t schema; int32_t brightness, sample, report, delta, offset; } record;
    size_t size=sizeof(record);
    err=nvs_get_blob(h,"config",&record,&size);
    if(err==ESP_OK && size>=sizeof(uint32_t)) {
        future_schema=record.schema>2;
        if((record.schema==1 && size==sizeof(record)-sizeof(int32_t)) || (record.schema==2 && size==sizeof(record))) {
            aquarium_settings_t v={record.brightness,record.sample,record.report,record.delta,record.schema==1 ? 0 : record.offset};
            if(valid(v)) current=v;
        }
    } else if(err!=ESP_ERR_NVS_NOT_FOUND) {
        // Unknown record sizes are preserved until a compatible firmware is installed.
        future_schema=true;
    }
    nvs_close(h);
}
aquarium_settings_t settings_get(void) {
    xSemaphoreTake(mutex,portMAX_DELAY); aquarium_settings_t v=current; xSemaphoreGive(mutex); return v;
}
esp_err_t settings_save(aquarium_settings_t v) {
    if (!valid(v)) return ESP_ERR_INVALID_ARG;
    if (future_schema) return ESP_ERR_NOT_SUPPORTED;
    nvs_handle_t h; esp_err_t e=nvs_open("aq_settings",NVS_READWRITE,&h);
    if(e!=ESP_OK) return e;
    const struct { uint32_t schema; int32_t brightness, sample, report, delta, offset; } record={2,v.brightness,v.sample_seconds,v.report_seconds,v.delta_centi,v.offset_centi};
    e=nvs_set_blob(h,"config",&record,sizeof(record));
    if(e==ESP_OK)e=nvs_commit(h);
    nvs_close(h);
    if(e==ESP_OK){xSemaphoreTake(mutex,portMAX_DELAY);current=v;xSemaphoreGive(mutex);}
    return e;
}
