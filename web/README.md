# Страница [«Мой аквариум»](https://rualone.github.io/alice-zigbee-aquarium-thermometer-esp32-c6/)

Просмотр состояния термометра, русских событий и скачивание отчёта через Web Serial. Нужны прошивка 0.2 и Chrome или Edge на компьютере.

[Подключение и локальный запуск](../docs/USB_DIAGNOSTICS.md).

Проверки из корня репозитория:

```sh
node --test web/tests/*.test.js
```

Шрифт Inter распространяется по [SIL Open Font License 1.1](assets/fonts/OFL.txt).

## Публикация

В настройках репозитория откройте **Settings → Pages → Source → GitHub Actions**.
После push в main workflow [«Мой аквариум»](https://github.com/rualone/alice-zigbee-aquarium-thermometer-esp32-c6/actions/workflows/pages.yml) проверяет страницу и публикует её.
Его также можно запустить вручную во вкладке Actions.

В публикацию входят HTML, CSS, JavaScript и ресурсы страницы; тесты и документация остаются в репозитории.
