# Third-party notices

## Espressif examples

`main/temperature_sensor.c`, `main/temperature_sensor.h`, and
`components/example_common/` derive from ESP Zigbee SDK examples.
Copyright 2024–2026 Espressif Systems (Shanghai) CO LTD, as stated per file.
The original files state: "This example code is in the Public Domain
(or CC0 licensed, at your option.)" Original notices are retained.
Source: https://github.com/espressif/esp-zigbee-sdk

## Drivers and Zigbee library

Dependencies are downloaded by ESP-IDF Component Manager, not vendored in Git.
DS18B20 and onewire_bus retain their Apache-2.0 licenses and notices.
The pinned Espressif Zigbee library declares Apache-2.0 and includes binary components;
a copy of its license is in `docs/licenses/Apache-2.0.txt`.
the project's MIT license does not relicense them. Review their bundled
licenses before redistributing firmware binaries.

## Design reference

https://github.com/VlasovLabTech/Zigbee-ESP32-C6-Alice
Copyright (c) 2026 VlasovLabTech, MIT.
Reference for standard endpoints, commissioning, and five-second BOOT reset.
The implementation is an ESP-IDF adaptation, not the original Arduino firmware.
No claim of official Yandex or Espressif endorsement is made.
