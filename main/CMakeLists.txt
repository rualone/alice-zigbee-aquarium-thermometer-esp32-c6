idf_component_register(
    SRCS "temperature_sensor.c"
    PRIV_INCLUDE_DIRS "."
    PRIV_REQUIRES vfs nvs_flash esp_driver_gpio ds18b20 onewire_bus example_common esp-zigbee-lib led_strip
)
