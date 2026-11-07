/* SPDX-License-Identifier: MIT */
#pragma once
#include <stdbool.h>
#include <stdint.h>

#define ZIGBEE_HEALTH_INTERVAL_MS 10000
#define ZIGBEE_HEALTH_TIMEOUT_MS 20000
#define ZIGBEE_HEALTH_FAILURE_LIMIT 2

typedef struct {
    uint32_t generation;
    bool pending;
    unsigned failures;
    int64_t started_ms, next_ms;
} zigbee_health_t;

static inline void zigbee_health_reset(zigbee_health_t *health)
{
    health->pending = false;
    ++health->generation; /* Invalidate callbacks from a previous network session. */
    health->failures = 0;
    health->next_ms = 0;
}
static inline uint32_t zigbee_health_begin(zigbee_health_t *health, int64_t now)
{
    health->pending = true;
    health->started_ms = now;
    if (++health->generation == 0) ++health->generation;
    return health->generation;
}
static inline bool zigbee_health_finish(zigbee_health_t *health, uint32_t generation, bool success, int64_t now)
{
    if (!health->pending || generation != health->generation) return false;
    health->pending = false;
    health->next_ms = now + ZIGBEE_HEALTH_INTERVAL_MS;
    if (success) health->failures = 0;
    else if (health->failures < ZIGBEE_HEALTH_FAILURE_LIMIT) ++health->failures;
    return true;
}
