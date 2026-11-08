/* Публичный интерфейс настроек: значения в физических единицах (секунды и сотые °C). Возвращается копия, чтобы вызывающий код не менял общую RAM без проверки и записи. theme — стабильный идентификатор 0..3, не индекс произвольного списка UI. */
#pragma once
#include "esp_err.h"
typedef struct { int brightness, sample_seconds, report_seconds, delta_centi, offset_centi, theme; } aquarium_settings_t;
void settings_init(void);
aquarium_settings_t settings_get(void);
esp_err_t settings_save(aquarium_settings_t value);
aquarium_settings_t settings_defaults(void);
esp_err_t settings_reset(void);
