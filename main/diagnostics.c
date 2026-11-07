/* SPDX-License-Identifier: MIT */
#include "diagnostics.h"
#include "settings.h"
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include "cJSON.h"
#include "esp_app_desc.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "driver/usb_serial_jtag.h"
#include "driver/usb_serial_jtag_vfs.h"
#include "sdkconfig.h"

#define EVENT_COUNT 64
#define EVENT_LENGTH 112
static SemaphoreHandle_t mutex;
static struct {
    bool measured, valid, network;
    float temperature, raw_temperature;
    int offset_centi;
    uint32_t errors, report_failures, sequence;
    int64_t measured_ms, reported_ms;
    char zigbee_state[20], zigbee_reason[40];
    int64_t zigbee_since_ms;
    esp_err_t error;
    unsigned head, count;
    struct { uint32_t seq; int64_t ms; char message[EVENT_LENGTH]; } events[EVENT_COUNT];
} data;
static int64_t uptime_ms(void) { return esp_timer_get_time() / 1000; }

/* Curated event messages only; never capture raw Zigbee logs, keys or addresses. */
static void event_locked(const char *message)
{
    unsigned i = data.head;
    data.events[i].seq = ++data.sequence;
    data.events[i].ms = uptime_ms();
    snprintf(data.events[i].message, EVENT_LENGTH, "%s", message);
    data.head = (i + 1) % EVENT_COUNT;
    if (data.count < EVENT_COUNT) data.count++;
}
void diagnostics_event(const char *message)
{
    if (!mutex) return;
    xSemaphoreTake(mutex, portMAX_DELAY);
    event_locked(message);
    xSemaphoreGive(mutex);
}
void diagnostics_measurement(bool valid, float temperature, float raw_temperature, int offset_centi, esp_err_t error)
{
    if (!mutex) return;
    xSemaphoreTake(mutex, portMAX_DELAY);
    data.measured = true; data.valid = valid; data.temperature = temperature;
    data.raw_temperature = raw_temperature; data.offset_centi = offset_centi;
    data.measured_ms = uptime_ms(); data.error = error;
    char message[EVENT_LENGTH];
    if (valid) snprintf(message, sizeof(message), "Water temperature: %.2f C", temperature);
    else { data.errors++; snprintf(message, sizeof(message), "Probe error: %s", esp_err_to_name(error)); }
    event_locked(message);
    xSemaphoreGive(mutex);
}
void diagnostics_zigbee(const char *state, const char *reason)
{
    if (!mutex) return;
    xSemaphoreTake(mutex, portMAX_DELAY);
    if (strcmp(state, "trouble") == 0 && !data.network) {
        xSemaphoreGive(mutex);
        return;
    }
    if (strcmp(data.zigbee_state, state) != 0 || strcmp(data.zigbee_reason, reason) != 0) {
        snprintf(data.zigbee_state, sizeof(data.zigbee_state), "%s", state);
        snprintf(data.zigbee_reason, sizeof(data.zigbee_reason), "%s", reason);
        data.zigbee_since_ms = uptime_ms();
        data.network = strcmp(state, "joined") == 0 || strcmp(state, "trouble") == 0 || strcmp(state, "checking") == 0;
        char message[EVENT_LENGTH];
        snprintf(message, sizeof(message), "Zigbee: %s (%s)", state, reason);
        event_locked(message);
    }
    xSemaphoreGive(mutex);
}
void diagnostics_report(bool queued)
{
    if (!mutex) return;
    xSemaphoreTake(mutex, portMAX_DELAY);
    if (queued) data.reported_ms = uptime_ms(); else data.report_failures++;
    event_locked(queued ? "Temperature report queued; delivery not confirmed" : "Cannot queue temperature report");
    xSemaphoreGive(mutex);
}
static void snapshot(void)
{
    cJSON *root = cJSON_CreateObject();
    if (!root) return;
    cJSON_AddStringToObject(root, "device", "alice-zigbee-aquarium-thermometer");
    cJSON_AddNumberToObject(root, "protocol", 1);
    cJSON_AddStringToObject(root, "type", "snapshot");
    cJSON_AddStringToObject(root, "firmware", esp_app_get_description()->version);
    cJSON_AddNumberToObject(root, "uptime_ms", uptime_ms());
    cJSON_AddNumberToObject(root, "reset_reason", esp_reset_reason());
    cJSON_AddNumberToObject(root, "sample_interval_ms", settings_get().sample_seconds * 1000);
    aquarium_settings_t cfg = settings_get();
    cJSON *settings = cJSON_AddObjectToObject(root, "settings");
    cJSON_AddNumberToObject(settings,"brightness",cfg.brightness);
    cJSON_AddNumberToObject(settings,"sample_seconds",cfg.sample_seconds);
    cJSON_AddNumberToObject(settings,"report_seconds",cfg.report_seconds);
    cJSON_AddNumberToObject(settings,"delta_centi",cfg.delta_centi);
    cJSON_AddNumberToObject(settings,"offset_centi",cfg.offset_centi);
    xSemaphoreTake(mutex, portMAX_DELAY);
    cJSON_AddStringToObject(root, "probe", !data.measured ? "waiting" : data.valid ? "ok" : "error");
    if (data.measured && data.valid) cJSON_AddNumberToObject(root, "temperature_c", data.temperature);
    else cJSON_AddNullToObject(root, "temperature_c");
    if (data.measured && data.valid) cJSON_AddNumberToObject(root,"raw_temperature_c",data.raw_temperature);
    else cJSON_AddNullToObject(root,"raw_temperature_c");
    cJSON_AddNumberToObject(root,"applied_offset_centi",data.offset_centi);
    if (data.measured) cJSON_AddNumberToObject(root, "measurement_age_ms", uptime_ms() - data.measured_ms);
    else cJSON_AddNullToObject(root, "measurement_age_ms");
    cJSON_AddNumberToObject(root, "probe_errors", data.errors);
    cJSON_AddNumberToObject(root, "report_failures", data.report_failures);
    cJSON_AddBoolToObject(root, "zigbee_joined", data.network);
    cJSON *zigbee = cJSON_AddObjectToObject(root, "zigbee");
    cJSON_AddStringToObject(zigbee, "state", data.zigbee_state);
    cJSON_AddStringToObject(zigbee, "reason", data.zigbee_reason);
    cJSON_AddNumberToObject(zigbee, "state_age_ms", uptime_ms() - data.zigbee_since_ms);
    if (data.reported_ms) cJSON_AddNumberToObject(root, "report_age_ms", uptime_ms() - data.reported_ms);
    else cJSON_AddNullToObject(root, "report_age_ms");
    cJSON *events = cJSON_AddArrayToObject(root, "events");
    for (unsigned j = 0; j < data.count; j++) {
        unsigned i = (data.head + EVENT_COUNT - data.count + j) % EVENT_COUNT;
        cJSON *entry = cJSON_CreateObject();
        if (!entry) continue;
        cJSON_AddNumberToObject(entry, "seq", data.events[i].seq);
        cJSON_AddNumberToObject(entry, "ms", data.events[i].ms);
        cJSON_AddStringToObject(entry, "message", data.events[i].message);
        cJSON_AddItemToArray(events, entry);
    }
    xSemaphoreGive(mutex);
    char *json = cJSON_PrintUnformatted(root);
    if (json) {
        // One stdio operation avoids mixing protocol frames with normal log lines.
        printf("\n@AQ1 %s\n", json);
        fflush(stdout);
        cJSON_free(json);
    }
    cJSON_Delete(root);
}
static void configure(const char *text) {
    cJSON *r=cJSON_Parse(text);
    const char *names[]={"brightness","sample_seconds","report_seconds","delta_centi","offset_centi"};
    int values[5]={0,0,0,0,settings_get().offset_centi}; bool ok=cJSON_IsObject(r) && (cJSON_GetArraySize(r)==4 || cJSON_GetArraySize(r)==5);
    const int mins[]={0,2,5,1,-500}, maxs[]={255,3600,3600,1000,500};
    for(int i=0;i<5;i++) {
        cJSON *v=cJSON_GetObjectItemCaseSensitive(r,names[i]);
        if(i==4 && !v)continue; // Older pages preserve the existing correction.
        if(!cJSON_IsNumber(v) || !isfinite(v->valuedouble) || v->valuedouble<mins[i] ||
            v->valuedouble>maxs[i] || floor(v->valuedouble)!=v->valuedouble) ok=false;
        else values[i]=(int)v->valuedouble;
    }
    esp_err_t err=ok ? settings_save((aquarium_settings_t){values[0],values[1],values[2],values[3],values[4]}) : ESP_ERR_INVALID_ARG;
    cJSON_Delete(r);
    diagnostics_event(err==ESP_OK ? "Settings saved" : "Settings save failed");
    printf("\n@AQSET {\"ok\":%s}\n",err==ESP_OK ? "true" : "false");
    fflush(stdout);
    snapshot();
}
static void usb_task(void *arg)
{
    char line[256]; unsigned used = 0; bool discard = false;
    for (;;) {
        char ch;
        if (usb_serial_jtag_read_bytes(&ch, 1, pdMS_TO_TICKS(100)) <= 0) continue;
        if (ch == '\n' || ch == '\r') {
            line[used] = 0;
            if (!discard && strcmp(line, "AQ1 SNAPSHOT") == 0) snapshot();
            else if (!discard && strncmp(line,"AQ1 SETTINGS ",13)==0) configure(line+13);
            used = 0; discard = false;
        } else if (used < sizeof(line) - 1 && !discard) line[used++] = ch;
        else discard = true;
    }
}
void diagnostics_start(void)
{
    mutex = xSemaphoreCreateMutex();
    ESP_ERROR_CHECK(mutex ? ESP_OK : ESP_ERR_NO_MEM);
    usb_serial_jtag_driver_config_t config = {.tx_buffer_size = 4096, .rx_buffer_size = 256};
    if (!usb_serial_jtag_is_driver_installed()) ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&config));
    usb_serial_jtag_vfs_use_driver();
    diagnostics_zigbee("starting", "initialization");
    diagnostics_event("Device started; diagnostics protocol v1");
    ESP_ERROR_CHECK(xTaskCreate(usb_task, "usb_diagnostics", 6144, NULL, 2, NULL) == pdPASS ? ESP_OK : ESP_ERR_NO_MEM);
}
