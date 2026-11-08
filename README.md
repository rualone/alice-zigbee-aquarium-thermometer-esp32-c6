# Аквариумный термометр с Алисой

[![Сборка ESP-IDF](https://github.com/rualone/alice-zigbee-aquarium-thermometer-esp32-c6/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/rualone/alice-zigbee-aquarium-thermometer-esp32-c6/actions/workflows/build.yml)
[![Последний релиз](https://img.shields.io/github/v/release/rualone/alice-zigbee-aquarium-thermometer-esp32-c6?label=релиз)](https://github.com/rualone/alice-zigbee-aquarium-thermometer-esp32-c6/releases/latest)
[![Алиса · напрямую по Zigbee](https://img.shields.io/badge/Алиса-напрямую_по_Zigbee-7B3FE4)](#подключение-к-алисе)
[![Прошивка через браузер](https://img.shields.io/badge/прошивка-через_браузер-315E46)](https://rualone.github.io/alice-zigbee-aquarium-thermometer-esp32-c6/)
[![Лицензия MIT](https://img.shields.io/badge/лицензия-MIT-blue)](LICENSE)

Термометр на ESP32-C6 SuperMini и DS18B20 передаёт температуру воды в «Дом с Алисой» напрямую по Zigbee. Wi-Fi, MQTT и отдельный сервер не нужны. После настройки работает без компьютера.

[Компоненты и схема](#компоненты-и-схема) · [Прошивка](#прошивка) · [Подключение к Алисе](#подключение-к-алисе) · [Индикация](#индикация) · [Мой аквариум](#мой-аквариум) · [Документация](#документация) · [Основа проекта](#основа-проекта)

## Компоненты и схема

- ESP32-C6 SuperMini и трёхпроводный герметичный DS18B20.
- Резистор 4,7 кОм.
- USB-кабель с передачей данных и источник питания USB.
- Zigbee-хаб Яндекса. Проект проверен со Станцией Миди.

Собирайте при отключённом питании. Плата и соединения должны оставаться вне воды. На GPIO подаётся только 3,3 В.

![Подключение ESP32-C6 SuperMini и DS18B20](web/assets/wiring-install.webp)

[Подробности сборки и подключения щупа](docs/ASSEMBLY.md).

## Прошивка

Установка и обновление доступны в [«Мой аквариум»](https://rualone.github.io/alice-zigbee-aquarium-thermometer-esp32-c6/) через Chrome на компьютере. Первая установка очищает память; обычное обновление сохраняет настройки и Zigbee-привязку. Не отключайте питание до завершения.

[Инструкция по прошивке](docs/BROWSER_FLASH.md) · [Для разработчиков: сборка из исходников](docs/BUILD.md).

## Подключение к Алисе

В «Доме с Алисой» запустите поиск Zigbee-устройств через хаб. Термометр автоматически присоединится к сети. Для повторного сопряжения удерживайте BOOT пять секунд после запуска и отпустите.

Назовите датчик «Аквариум» и спросите: **«Алиса, какая температура в аквариуме?»** Для голосовых функций нужен интернет.

## Индикация

| Состояние | Синий индикатор | RGB-индикатор |
| --- | --- | --- |
| Поиск сети | Быстро мигает | Жёлтый |
| Ошибка щупа после подключения | Выключен | Красный |
| Штатная работа | Выключен | Зелёный |
| Готовность сбросить привязку | Выключен | Синий |

## Мой аквариум

[«Мой аквариум»](https://rualone.github.io/alice-zigbee-aquarium-thermometer-esp32-c6/) — страница для просмотра температуры, настройки датчика и оформления, обновления прошивки и скачивания отчёта. Подключение — по USB. Настройки хранятся в термометре и сохраняются после отключения питания.

[Руководство пользователя](docs/MANUAL.md).

## Документация

- [Сборка устройства](docs/ASSEMBLY.md) и [сборка прошивки](docs/BUILD.md).
- [Проверка связи Zigbee](docs/MANUAL.md#связь-с-хабом) и [безопасное обновление](docs/SAFE_UPDATE.md).
- [Архитектура исходников](docs/ARCHITECTURE.md) и [результаты проверок](docs/VALIDATION.md).
- [Участие в проекте](CONTRIBUTING.md), [сообщения об ошибках](https://github.com/rualone/alice-zigbee-aquarium-thermometer-esp32-c6/issues), [релизы](https://github.com/rualone/alice-zigbee-aquarium-thermometer-esp32-c6/releases) и [история изменений](CHANGELOG.md).

## Основа проекта

Референс — [VlasovLabTech/Zigbee-ESP32-C6-Alice](https://github.com/VlasovLabTech/Zigbee-ESP32-C6-Alice).   
Основа Zigbee API — [Espressif ESP Zigbee SDK](https://github.com/espressif/esp-zigbee-sdk).   
Проект распространяется по [MIT](LICENSE).  
Авторство и лицензии сторонних компонентов сохранены в [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).  
