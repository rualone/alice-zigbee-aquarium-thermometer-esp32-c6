# Contributing

Откройте issue с моделью платы, версиями ESP-IDF и зависимостей, шагами
воспроизведения и очищенным журналом. Не прикладывайте ключи Zigbee,
дампы NVS, MAC/IEEE-адреса и личные данные.

> Open an issue with the board model, ESP-IDF and dependency versions,
> reproduction steps, and a sanitized log. Do not attach Zigbee keys,
> NVS dumps, MAC/IEEE addresses, or personal data.

Перед PR выполните чистую сборку для esp32c6. Изменения GPIO, сопряжения
и драйвера щупа требуют проверки на оборудовании. Укажите, что проверено,
а что осталось непроверенным. Сохраняйте чередование русского и английского текста.

> Build cleanly for esp32c6 before a PR. Changes to GPIOs, pairing, or the
> probe driver need hardware validation. State what was tested and what
> remains untested. Keep Russian paragraphs followed by English translations.
