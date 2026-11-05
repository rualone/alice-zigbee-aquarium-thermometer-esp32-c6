/* SPDX-License-Identifier: MIT */
#include "diagnostics.h"
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
    float temperature;
    uint32_t errors, report_failures, sequence;
    int64_t measured_ms, reported_ms;
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
void diagnostics_measurement(bool valid, float temperature, esp_err_t error)
{
    if (!mutex) return;
    xSemaphoreTake(mutex, portMAX_DELAY);
    data.measured = true; data.valid = valid; data.temperature = temperature;
    data.measured_ms = uptime_ms(); data.error = error;
    char message[EVENT_LENGTH];
    if (valid) snprintf(message, sizeof(message), "Water temperature: %.2f C", temperature);
    else { data.errors++; snprintf(message, sizeof(message), "Probe error: %s", esp_err_to_name(error)); }
    event_locked(message);
    xSemaphoreGive(mutex);
}
void diagnostics_network(bool ready)
{
    if (!mutex) return;
    xSemaphoreTake(mutex, portMAX_DELAY);
    data.network = ready;
    event_locked(ready ? "Zigbee local state: joined" : "Zigbee local state: searching/offline");
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
    cJSON_AddNumberToObject(root, "sample_interval_ms", CONFIG_AQUARIUM_SAMPLE_SECONDS * 1000);
    xSemaphoreTake(mutex, portMAX_DELAY);
    cJSON_AddStringToObject(root, "probe", !data.measured ? "waiting" : data.valid ? "ok" : "error");
    if (data.measured && data.valid) cJSON_AddNumberToObject(root, "temperature_c", data.temperature);
    else cJSON_AddNullToObject(root, "temperature_c");
    if (data.measured) cJSON_AddNumberToObject(root, "measurement_age_ms", uptime_ms() - data.measured_ms);
    else cJSON_AddNullToObject(root, "measurement_age_ms");
    cJSON_AddNumberToObject(root, "probe_errors", data.errors);
    cJSON_AddNumberToObject(root, "report_failures", data.report_failures);
    cJSON_AddBoolToObject(root, "zigbee_joined", data.network);
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
static void usb_task(void *arg)
{
    char line[64]; unsigned used = 0; bool discard = false;
    for (;;) {
        char ch;
        if (usb_serial_jtag_read_bytes(&ch, 1, pdMS_TO_TICKS(100)) <= 0) continue;
        if (ch == '\n' || ch == '\r') {
            line[used] = 0;
            if (!discard && strcmp(line, "AQ1 SNAPSHOT") == 0) snapshot();
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
    diagnostics_event("Device started; diagnostics protocol v1");
    ESP_ERROR_CHECK(xTaskCreate(usb_task, "usb_diagnostics", 6144, NULL, 2, NULL) == pdPASS ? ESP_OK : ESP_ERR_NO_MEM);
}
