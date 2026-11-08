# Сборка и публикация

## Окружение

Используются ESP-IDF 6.1 и ESP Zigbee SDK 2.0.5. Зависимости загружает менеджер компонентов; при первой сборке нужен интернет. Для работы в VS Code установите расширение Espressif IDF и выберите окружение ESP-IDF.

## Получение и сборка

В терминале ESP-IDF:

```sh
git clone https://github.com/rualone/alice-zigbee-aquarium-thermometer-esp32-c6.git
cd alice-zigbee-aquarium-thermometer-esp32-c6
idf.py set-target esp32c6
idf.py build
```

`set-target` нужен для первоначальной настройки и пересоздаёт конфигурацию. Для последующих сборок достаточно `idf.py build`.

## Настройка платы

Откройте `idf.py menuconfig` → **Alice Zigbee Aquarium Thermometer**. По умолчанию GPIO4 используется для щупа, GPIO15 — для синего индикатора, GPIO8 — для RGB, GPIO9 — для BOOT. Схему GPIO меняйте в соответствии с физическим монтажом.

## Запись по USB

Определите порт в расширении ESP-IDF и подставьте вместо PORT: например, `/dev/cu.usbmodem…` в macOS или `COM…` в Windows. Закройте страницу, подключённую к порту, и убедитесь, что выбрана нужная плата.

```sh
idf.py -p PORT flash monitor
```

Выход из монитора — Ctrl+]. Если загрузка не начинается, удерживайте BOOT, кратко нажмите RESET, отпустите BOOT и повторите запись.

`idf.py flash` записывает стартовый раздел и служебные файлы, обходя безопасное переключение приложений. Для обычного обновления существующего термометра используйте [«Мой аквариум»](https://rualone.github.io/alice-zigbee-aquarium-thermometer-esp32-c6/). Полное стирание памяти не требуется.

## Пакет для браузера

После сборки выполните `python3 scripts/package_web_firmware.py`. Пакет появится в `web/firmware`.

Механизм резервирования и отката описан в [SAFE_UPDATE.md](SAFE_UPDATE.md).

## Страница

Исходники находятся в `web/`, отдельная сборка не нужна. Из корня репозитория:

```sh
python3 -m http.server 8765 --directory web --bind 127.0.0.1
```

Откройте http://127.0.0.1:8765/. На сервере нужен HTTPS.

## Проверки

```sh
node --test web/tests/*.test.js
python3 tests/test_settings.py
python3 tests/test_update_boot.py
python3 tests/test_zigbee_health.py
```

## GitHub Pages

Выберите **Settings → Pages → Source → GitHub Actions**. После push в `main` [workflow](../.github/workflows/pages.yml) собирает прошивку, проверяет страницу и публикует её с ресурсами и пакетом установки. Возможен ручной запуск через Actions. Тесты и документация на сайт не попадают.

Лицензии ресурсов указаны в [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
