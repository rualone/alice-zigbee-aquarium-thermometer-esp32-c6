# Проверка / Validation

Владелец подтвердил подключение к Станции Миди и работу собранного датчика.
Это пользовательская проверка, не сертификация. После подготовки репозитория
код изменён; новую сборку нужно отдельно проверить на плате.

> The owner confirmed Station Midi pairing and operation of the assembled
> sensor. This is user validation, not certification. Repository preparation
> changed the code; validate the new build separately on hardware.

- [x] Предыдущая версия собиралась и прошивалась / Previous version built and flashed.
- [x] Предыдущая версия сопрягалась с Миди / Previous version paired with Midi.
- [x] Без щупа: повторяемый NOT_FOUND без зависания RMT / No probe: repeated NOT_FOUND without stuck RMT.
- [x] Чистая сборка текущих исходников с ESP-IDF 6.1 / Clean build of current sources with ESP-IDF 6.1.
- [ ] Новая сборка: реальные измерения и прогрев рукой / New build: readings and hand-warming response.
- [ ] Отключение и возврат щупа / Probe disconnect and reconnect.
- [ ] Ошибка щупа в приложении вместо старого показания / Probe error presentation in app.
- [ ] Перезапуск платы с сохранением привязки / Board restart retaining pairing.
- [ ] Перезапуск Миди и восстановление передачи / Midi restart and reporting recovery.
- [ ] Сброс BOOT и повторное сопряжение / BOOT reset and re-pairing.
- [ ] Непрерывная работа 24 часа / Continuous 24-hour operation.

Индикатор показывает локальное состояние прошивки, не подтверждение доставки.
Статус сети после перезапуска не проверяет доступность координатора.

> The LED reflects local firmware state, not delivery confirmation.
> Restored network state after reboot does not verify coordinator reachability.
