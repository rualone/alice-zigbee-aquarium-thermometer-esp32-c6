/*
 * Результат обновления
 * Открытый USB-порт ещё не означает успешный запуск новой версии.
 * Нужно дождаться ожидаемой версии и снятия признака проверки первого запуска.
 * Возврат другой версии показывается как откат, а не как успешное обновление.
 */
// Do not equate a successful serial connection with a successful new boot.
export function installationState(snapshot,expected) {
 if(!snapshot||!expected)return 'waiting';
 if(snapshot.firmware!==expected)return 'rolled_back';
 return snapshot.update_pending===false ? 'confirmed' : 'waiting';
}
