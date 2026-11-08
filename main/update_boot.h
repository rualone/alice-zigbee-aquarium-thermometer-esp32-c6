/* Биты готовности относятся к локальным задачам, а не к доступности внешних устройств. Каждый участник устанавливает свой бит после первого рабочего прохода; подтверждение приложения выполняет отдельная задача. */
#pragma once
#include <stdbool.h>
typedef enum { UPDATE_READY_ZIGBEE = 1, UPDATE_READY_PROBE = 2, UPDATE_READY_INDICATOR = 4 } update_ready_t;
void update_boot_start(void);
bool update_boot_pending(void);
void update_boot_ready(update_ready_t task);
