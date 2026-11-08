/* Сбор событий и снимков USB. Производители данных вызываются из разных задач; реализация защищает общее состояние mutex. Ошибка измерения передаётся отдельно от числа температуры. */
#pragma once
#include <stdbool.h>
#include "esp_err.h"
void diagnostics_start(void);
void diagnostics_measurement(bool valid, float temperature, float raw_temperature, int offset_centi, esp_err_t error);
void diagnostics_report(bool queued);
void diagnostics_event(const char *message);

/* Network membership is distinct from delivery to the coordinator/application. */
void diagnostics_zigbee(const char *state, const char *reason);
