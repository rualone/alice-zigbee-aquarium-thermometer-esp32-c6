#pragma once
#include "esp_err.h"
typedef struct { int brightness, sample_seconds, report_seconds, delta_centi, offset_centi; } aquarium_settings_t;
void settings_init(void);
aquarium_settings_t settings_get(void);
esp_err_t settings_save(aquarium_settings_t value);
