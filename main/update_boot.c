/* First-boot validation is local: missing probe/hub is not a firmware fault. */
#include "update_boot.h"
#include "esp_ota_ops.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <stdatomic.h>
#include "diagnostics.h"

static atomic_uint ready;
static atomic_bool pending;
bool update_boot_pending(void) { return pending; }
void update_boot_ready(update_ready_t task) { atomic_fetch_or(&ready, task); }

static void validate_task(void *arg)
{
    const unsigned expected = UPDATE_READY_ZIGBEE | UPDATE_READY_PROBE | UPDATE_READY_INDICATOR;
    for (unsigned elapsed = 0; elapsed < 120; ++elapsed) {
        vTaskDelay(pdMS_TO_TICKS(250));
        if (elapsed >= 11 && (atomic_load(&ready) & expected) == expected) {
            ESP_ERROR_CHECK(esp_ota_mark_app_valid_cancel_rollback());
            pending = false;
            diagnostics_event("Прошивка проверена и готова к работе");
            vTaskDelete(NULL);
        }
    }
    ESP_LOGE("UPDATE", "Startup self-check timed out; rolling back");
    ESP_ERROR_CHECK(esp_ota_mark_app_invalid_rollback_and_reboot());
    vTaskDelete(NULL);
}
void update_boot_start(void)
{
    esp_ota_img_states_t state;
    const esp_partition_t *running = esp_ota_get_running_partition();
    pending = running && esp_ota_get_state_partition(running, &state) == ESP_OK &&
        state == ESP_OTA_IMG_PENDING_VERIFY;
    if (pending) ESP_ERROR_CHECK(xTaskCreate(validate_task, "update_check", 3072, NULL, 2, NULL) == pdPASS ? ESP_OK : ESP_ERR_NO_MEM);
}
