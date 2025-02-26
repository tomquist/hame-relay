# Changelog

## [1.1.0] - 2025-02-26
- Introduce device type configuration after Hame blocked subscription to wildcard topics. Make sure to update your configuration file with the new `device_type` field on each device.
- Allow overriding forwarding direction per device through the `inverse_forwarding` field in the device configuration

## [1.0.4] - 2025-02-24
- Fixed inverse forwarding in HomeAssistant Addon

## [1.0.3] - 2025-02-20
- Fixed issue with inverse forwarding not working as expected

## [1.0.2] - 2025-01-03
- Allow inverse forwarding direction from Hame to MQTT

## [1.0.1] - 2024-12-30
- Fixed connection stability issues - forwarder now maintains connection indefinitely
- Added detailed connection status logging for better troubleshooting

## [1.0.0]
- Initial release
