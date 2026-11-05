#pragma once
#include <stdbool.h>
#include "esp_err.h"
void diagnostics_start(void);
void diagnostics_measurement(bool valid, float temperature, esp_err_t error);
void diagnostics_network(bool ready);
void diagnostics_report(bool queued);
void diagnostics_event(const char *message);
