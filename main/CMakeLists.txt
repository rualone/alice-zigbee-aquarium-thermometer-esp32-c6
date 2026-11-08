idf_component_register(
    SRCS "temperature_sensor.c" "diagnostics.c" "settings.c" "update_boot.c"
    PRIV_INCLUDE_DIRS "."
    PRIV_REQUIRES app_update cjson esp_timer esp_app_format esp_driver_usb_serial_jtag vfs nvs_flash esp_driver_gpio ds18b20 onewire_bus example_common esp-zigbee-lib led_strip
)
