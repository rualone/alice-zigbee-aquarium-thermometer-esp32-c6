/*
 * SPDX-FileCopyrightText: 2024-2026 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: LicenseRef-Included
 *
 * Zigbee HA_temperature_sensor Example
 *
 * This example code is in the Public Domain (or CC0 licensed, at your option.)
 *
 * Unless required by applicable law or agreed to in writing, this
 * software is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
 * CONDITIONS OF ANY KIND, either express or implied.
 */

#include "esp_check.h"
#include "esp_err.h"
#include "esp_log.h"
#include "nvs_flash.h"

#include "driver/gpio.h"
#include "ds18b20.h"
#include "onewire_bus.h"
#include <math.h>
#include <stdatomic.h>
#include "alarm_timer.h"

#include "esp_zigbee.h"
#include "ezbee/zha.h"

#include "temperature_sensor.h"

static atomic_bool network_ready = false;
static atomic_bool probe_ok = false;
static const char *TAG = "TEMPERATURE_SENSOR";

#define ESP_TEMP_SENSOR_MIN_VALUE       (-55) /* Sensor min measured value (degree Celsius) */
#define ESP_TEMP_SENSOR_MAX_VALUE       (125)  /* Sensor max measured value (degree Celsius) */
_Static_assert(CONFIG_AQUARIUM_DATA_GPIO != CONFIG_AQUARIUM_BOOT_GPIO, "Probe and button GPIO must differ");
#if CONFIG_AQUARIUM_LED_ENABLED
_Static_assert(CONFIG_AQUARIUM_LED_GPIO != CONFIG_AQUARIUM_DATA_GPIO &&
               CONFIG_AQUARIUM_LED_GPIO != CONFIG_AQUARIUM_BOOT_GPIO, "LED GPIO conflicts");
#endif

static int16_t zb_temperature_to_s16(float temp) { return (int16_t)(temp * 100); }

static void esp_app_temp_sensor_handler(float temperature)
{
    int16_t measured_value = zb_temperature_to_s16(temperature);
    /* Update temperature sensor measured value */
    esp_zigbee_lock_acquire(portMAX_DELAY);
    ezb_zcl_set_attr_value(ESP_ZIGBEE_HA_TEMPERATURE_SENSOR_EP_ID, EZB_ZCL_CLUSTER_ID_TEMPERATURE_MEASUREMENT,
                           EZB_ZCL_CLUSTER_SERVER, EZB_ZCL_ATTR_TEMPERATURE_MEASUREMENT_MEASURED_VALUE_ID,
                           EZB_ZCL_STD_MANUF_CODE, (uint8_t *)&measured_value, false);
    esp_zigbee_lock_release();
}

static bool report_temperature(void)
{


    ezb_err_t ret = EZB_ERR_NONE;
    ezb_zcl_report_attr_cmd_t report_attr_cmd = {
        .cmd_ctrl =
            {
                .fc.direction       = EZB_ZCL_CMD_DIRECTION_TO_CLI,
                .dst_addr.addr_mode = EZB_ADDR_MODE_NONE,
                .src_ep             = ESP_ZIGBEE_HA_TEMPERATURE_SENSOR_EP_ID,
                .cluster_id         = EZB_ZCL_CLUSTER_ID_TEMPERATURE_MEASUREMENT,
            },
        .payload =
            {
                .attr_id = EZB_ZCL_ATTR_TEMPERATURE_MEASUREMENT_MEASURED_VALUE_ID,
            },
    };
    esp_zigbee_lock_acquire(portMAX_DELAY);
    ret = ezb_zcl_report_attr_cmd_req(&report_attr_cmd);
    esp_zigbee_lock_release();
    if (ret == EZB_ERR_NONE) {
        ESP_LOGI(TAG, "Temperature report queued (delivery not confirmed)");
    } else {
        ESP_LOGE(TAG, "Failed to send ZCL Report Attribute request with error(0x%04x)", ret);
    }
    return ret == EZB_ERR_NONE;
}

/* GPIO15 LED, active low, according to supplied board pinout.
 * Separate task keeps BOOT and LED responsive during sensor conversion. */
static void indicator_task(void *arg)
{
    gpio_config_t cfg = {.pin_bit_mask = 1ULL << CONFIG_AQUARIUM_BOOT_GPIO, .mode = GPIO_MODE_INPUT,
                         .pull_up_en = GPIO_PULLUP_ENABLE};
    ESP_ERROR_CHECK(gpio_config(&cfg));
#if CONFIG_AQUARIUM_LED_ENABLED
    ESP_ERROR_CHECK(gpio_set_direction(CONFIG_AQUARIUM_LED_GPIO, GPIO_MODE_OUTPUT));
#endif
    TickType_t pressed = 0;
    for (;;) {
        TickType_t now = xTaskGetTickCount();
        unsigned ms = now * portTICK_PERIOD_MS;
        bool held = pressed && now - pressed >= pdMS_TO_TICKS(5000);
        bool on = held ? (ms % 200 < 100) :
                  !atomic_load(&probe_ok) ? (ms % 2000 < 100 || (ms % 2000 >= 250 && ms % 2000 < 350)) :
                  !atomic_load(&network_ready) ? (ms % 1000 < 500) : (ms % 5000 < 60);
#if CONFIG_AQUARIUM_LED_ENABLED
        #if CONFIG_AQUARIUM_LED_ACTIVE_LOW
        gpio_set_level(CONFIG_AQUARIUM_LED_GPIO, !on);
#else
        gpio_set_level(CONFIG_AQUARIUM_LED_GPIO, on);
#endif
#else
        (void)on;
#endif
        if (!gpio_get_level(CONFIG_AQUARIUM_BOOT_GPIO)) {
            if (!pressed) pressed = now;
        } else if (pressed) {
            pressed = 0;
            if (held) {
                esp_zigbee_lock_acquire(portMAX_DELAY);
                esp_zigbee_factory_reset();
                esp_zigbee_lock_release();
            }
        }
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}

static void aquarium_service_task(void *arg)
{
    onewire_bus_handle_t bus;
    onewire_bus_config_t cfg = {.bus_gpio_num = CONFIG_AQUARIUM_DATA_GPIO, .flags.en_pull_up = true};
    onewire_bus_rmt_config_t rmt = {.max_rx_bytes = 10};
    ESP_ERROR_CHECK(onewire_new_bus_rmt(&cfg, &rmt, &bus));
    ds18b20_device_handle_t probe = NULL;
    ds18b20_config_t sensor_cfg = {};
    TickType_t last_report = 0;
    float sent = NAN;
    bool invalid_reported = false;
    for (;;) {
        esp_err_t err = ESP_OK;
        if (!probe) err = ds18b20_new_device_from_bus(bus, &sensor_cfg, &probe);
        float temperature = NAN;
        if (err == ESP_OK) err = ds18b20_trigger_temperature_conversion(probe);
        if (err == ESP_OK) err = ds18b20_get_temperature(probe, &temperature);
        bool valid = err == ESP_OK && isfinite(temperature) && temperature >= -55 && temperature <= 125;
        atomic_store(&probe_ok, valid);
        if (valid) {
            ESP_LOGI(TAG, "Water temperature %.2f C", temperature);
            esp_app_temp_sensor_handler(temperature);
            TickType_t now = xTaskGetTickCount();
            if (atomic_load(&network_ready) && (invalid_reported || isnan(sent) ||
                now - last_report >= pdMS_TO_TICKS(CONFIG_AQUARIUM_REPORT_SECONDS * 1000) || fabsf(temperature - sent) >= CONFIG_AQUARIUM_DELTA_CENTI / 100.0f)) {
                if (report_temperature()) {
                    last_report = now;
                    sent = temperature;
                    invalid_reported = false;
                }
            }
        } else {
            ESP_LOGW(TAG, "Probe error: %s; no valid water temperature", esp_err_to_name(err));
            // Zigbee invalid-measurement sentinel, never substitute a plausible value.
            esp_app_temp_sensor_handler(-327.68f);
            if (atomic_load(&network_ready) && !invalid_reported) {
                invalid_reported = report_temperature();
            }
            if (probe) { ds18b20_del_device(probe); probe = NULL; }
            // A timed-out RX can remain armed. Recreate the bus before retrying.
            if (err == ESP_ERR_TIMEOUT || err == ESP_ERR_INVALID_STATE) {
                ESP_ERROR_CHECK(onewire_bus_del(bus));
                ESP_ERROR_CHECK(onewire_new_bus_rmt(&cfg, &rmt, &bus));
            }
        }
        vTaskDelay(pdMS_TO_TICKS(CONFIG_AQUARIUM_SAMPLE_SECONDS * 1000));
    }
}

static esp_err_t deferred_driver_init(void)
{
    static bool initialized = false;
    if (!initialized) {
        if (xTaskCreate(aquarium_service_task, "aquarium", 4096, NULL, 4, NULL) != pdPASS)
            return ESP_ERR_NO_MEM;
        ESP_ERROR_CHECK(xTaskCreate(indicator_task, "indicator", 3072, NULL, 3, NULL) == pdPASS ? ESP_OK : ESP_ERR_NO_MEM);
        initialized = true;
    }
    return ESP_OK;
}

static void esp_zigbee_alarm_bdb_commissioning(alarm_timer_arg_t arg)
{
    esp_zigbee_lock_acquire(portMAX_DELAY);
    (void)ezb_bdb_start_top_level_commissioning(arg);
    esp_zigbee_lock_release();
}

static bool esp_zigbee_app_signal_handler(const ezb_app_signal_t *app_signal)
{
    ezb_app_signal_type_t signal_type = ezb_app_signal_get_type(app_signal);

    switch (signal_type) {
    case EZB_ZDO_SIGNAL_SKIP_STARTUP:
        ESP_LOGI(TAG, "Initialize Zigbee stack");
        ezb_bdb_start_top_level_commissioning(EZB_BDB_MODE_INITIALIZATION);
        break;
    case EZB_BDB_SIGNAL_DEVICE_FIRST_START:
    case EZB_BDB_SIGNAL_DEVICE_REBOOT: {
        ezb_bdb_comm_status_t status = *((ezb_bdb_comm_status_t *)ezb_app_signal_get_params(app_signal));
        if (status == EZB_BDB_STATUS_SUCCESS) {
            ESP_LOGI(TAG, "Deferred driver initialization %s", deferred_driver_init() ? "failed" : "successful");
            ESP_LOGI(TAG, "Device started up in%s factory-reset mode", ezb_bdb_is_factory_new() ? "" : " non");
            if (ezb_bdb_is_factory_new()) {
                ezb_bdb_start_top_level_commissioning(EZB_BDB_MODE_NETWORK_STEERING);
            } else {
                atomic_store(&network_ready, true);
                ESP_LOGI(TAG, "Device reboot; saved network restored");
            }
        } else {
            ESP_LOGW(TAG, "%s failed with status(0x%02x), please retry", ezb_app_signal_to_string(signal_type), status);
            alarm_timer_schedule(esp_zigbee_alarm_bdb_commissioning, EZB_BDB_MODE_INITIALIZATION, 1000);
        }
    } break;
    case EZB_BDB_SIGNAL_STEERING: {
        ezb_bdb_comm_status_t status = *((ezb_bdb_comm_status_t *)ezb_app_signal_get_params(app_signal));
        if (status == EZB_BDB_STATUS_SUCCESS) {
            atomic_store(&network_ready, true);
            ESP_LOGI(TAG, "Joined Zigbee network successfully");
        } else {
            atomic_store(&network_ready, false);
            ESP_LOGW(TAG, "Failed to join network with status(0x%02x)", status);
            alarm_timer_schedule(esp_zigbee_alarm_bdb_commissioning, EZB_BDB_MODE_NETWORK_STEERING, 1000);
        }
    } break;
    case EZB_ZDO_SIGNAL_DEVICE_ANNCE: {
        const ezb_zdo_signal_device_annce_params_t *dev_annce_params = ezb_app_signal_get_params(app_signal);
        ESP_LOGI(TAG, "New device commissioned or rejoined (short: 0x%04hx)", dev_annce_params->short_addr);
    } break;
    case EZB_ZDO_SIGNAL_LEAVE: {
        atomic_store(&network_ready, false);
        const ezb_zdo_signal_leave_params_t *leave_params = ezb_app_signal_get_params(app_signal);
        ESP_LOGI(TAG, "Left network successfully with type(0x%02x)", leave_params->leave_type);
    } break;
    case EZB_NWK_SIGNAL_PERMIT_JOIN_STATUS: {
        uint8_t duration = *(uint8_t *)ezb_app_signal_get_params(app_signal);
        if (duration) {
            ESP_LOGI(TAG, "Network(0x%04hx) is open for %d seconds", ezb_nwk_get_panid(), duration);
        } else {
            ESP_LOGW(TAG, "Network(0x%04hx) closed, devices joining not allowed.", ezb_nwk_get_panid());
        }
    } break;
    default:
        ESP_LOGI(TAG, "Zigbee APP Signal: %s(type: 0x%02x)", ezb_app_signal_to_string(signal_type), signal_type);
        break;
    }
    return true;
}

static void esp_zigbee_zcl_core_action_handler(ezb_zcl_core_action_callback_id_t callback_id, void *message)
{
    switch (callback_id) {
    case EZB_ZCL_CORE_DEFAULT_RSP_CB_ID: {
        ezb_zcl_cmd_default_rsp_message_t *default_rsp = (ezb_zcl_cmd_default_rsp_message_t *)message;
        ESP_LOGI(TAG, "Received ZCL Default Response: status(0x%02x)", default_rsp->in.status_code);
    } break;
    default:
        ESP_LOGW(TAG, "ZCL Core Action: ID(0x%04lx)", callback_id);
        break;
    }
}

esp_err_t esp_zigbee_create_zha_temperature_sensor_device(void)
{
    ezb_af_device_desc_t                dev_desc               = ezb_af_create_device_desc();
    ezb_zha_temperature_sensor_config_t temperature_sensor_cfg = EZB_ZHA_TEMPERATURE_SENSOR_CONFIG();
    temperature_sensor_cfg.temp_meas_cfg.measured_value = INT16_MIN;
    temperature_sensor_cfg.temp_meas_cfg.min_measured_value    = zb_temperature_to_s16(ESP_TEMP_SENSOR_MIN_VALUE);
    temperature_sensor_cfg.temp_meas_cfg.max_measured_value    = zb_temperature_to_s16(ESP_TEMP_SENSOR_MAX_VALUE);

    ezb_af_ep_desc_t ep_desc =
        ezb_zha_create_temperature_sensor(ESP_ZIGBEE_HA_TEMPERATURE_SENSOR_EP_ID, &temperature_sensor_cfg);
    ezb_zcl_cluster_desc_t basic_desc = {0};

    basic_desc = ezb_af_endpoint_get_cluster_desc(ep_desc, EZB_ZCL_CLUSTER_ID_BASIC, EZB_ZCL_CLUSTER_SERVER);
    ezb_zcl_basic_cluster_desc_add_attr(basic_desc, EZB_ZCL_ATTR_BASIC_MANUFACTURER_NAME_ID, (void *)ESP_MANUFACTURER_NAME);
    ezb_zcl_basic_cluster_desc_add_attr(basic_desc, EZB_ZCL_ATTR_BASIC_MODEL_IDENTIFIER_ID, (void *)ESP_MODEL_IDENTIFIER);

    ESP_ERROR_CHECK(ezb_af_device_add_endpoint_desc(dev_desc, ep_desc));
    ESP_ERROR_CHECK(ezb_af_device_desc_register(dev_desc));

    ezb_zcl_core_action_handler_register(esp_zigbee_zcl_core_action_handler);

    return ESP_OK;
}

esp_err_t esp_zigbee_setup_commissioning(void)
{
    ezb_aps_secur_enable_distributed_security(false);
    ESP_ERROR_CHECK(ezb_bdb_set_primary_channel_set(ESP_ZIGBEE_PRIMARY_CHANNEL_MASK));
    ESP_ERROR_CHECK(ezb_bdb_set_secondary_channel_set(ESP_ZIGBEE_SECONDARY_CHANNEL_MASK));
    ESP_ERROR_CHECK(ezb_app_signal_add_handler(esp_zigbee_app_signal_handler));

    return ESP_OK;
}

static void esp_zigbee_stack_main_task(void *pvParameters)
{
    esp_zigbee_config_t config = ESP_ZIGBEE_DEFAULT_CONFIG();

    ESP_ERROR_CHECK(esp_zigbee_init(&config));

    ESP_ERROR_CHECK(esp_zigbee_setup_commissioning());

    ESP_ERROR_CHECK(esp_zigbee_create_zha_temperature_sensor_device());

    ESP_ERROR_CHECK(esp_zigbee_start(false));

    esp_zigbee_launch_mainloop();

    esp_zigbee_deinit();

    vTaskDelete(NULL);
}

void app_main(void)
{
    esp_err_t nvs_err = nvs_flash_init();
    if (nvs_err == ESP_ERR_NVS_NO_FREE_PAGES || nvs_err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_LOGW(TAG, "NVS requires recovery; saved pairing will be lost");
        ESP_ERROR_CHECK(nvs_flash_erase());
        nvs_err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(nvs_err);
    ESP_LOGI(TAG, "Alice Zigbee Aquarium Thermometer: starting Zigbee stack");
    ESP_ERROR_CHECK(xTaskCreate(esp_zigbee_stack_main_task, "Zigbee_main", 4096, NULL, 5, NULL) == pdPASS ? ESP_OK : ESP_ERR_NO_MEM);
}
