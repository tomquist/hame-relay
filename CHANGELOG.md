# Changelog
## [Next]


## [1.3.2] - 2025-11-08
- Fixed Venus 3 devices (VNSE3) working on firmware version 139

## [1.3.1] - 2025-10-26
- Fixed forwarding direction for HMB devices. (#96)
- Added retry logic with exponential backoff for Hame API calls to handle temporary server errors (#97)

## [1.3.0] - 2025-10-03
- **BREAKING**: Username and password are now required for Home Assistant addon
- **BREAKING**: Removed manual device configuration from Home Assistant addon (devices are now automatically discovered via API)
- Added global `inverse_forwarding` flag that flips forwarding direction for all devices when enabled. Usually you want to leave that disabled unless you know what you're doing.
- Added selective inverse forwarding for HMA/HMF/HMK/HMJ devices via `inverse_forwarding_device_ids` configuration. Only use this if you previously used Hame Relay with your B2500 in Mode 2. Don't use it for Mode 1.
- Added automatic inverse forwarding for all other device types (JPLS, HMM, HMN, HME, TPM-CN, HMG)
- Added support for HMG devices with firmware version >= 154.0
- Add support for Venus 3 devices (VNSE3)
- Added Italian and Dutch translations for Home Assistant addon
- Removed `default_broker_id` from Home Assistant addon default configuration

## [1.2.0] - 2025-07-19
- Support multiple remote brokers via new `brokers.json`
- Added broker configuration for the new 2025 Hame cloud
- Added device types `JPLS-8H` and `HMG-25`
- Log level can now be adjusted via the `LOG_LEVEL` environment variable
- Automatically select the appropriate broker based on device firmware

## [1.1.11]
- Add support for HMM-1 (Jupiter)

## [1.1.10]
- Fixed device ID length validation (@seybsen)

## [1.1.9]
- Added support for HMI-1 (800 W Inverter) (@seybsen)

## [1.1.8]
- Fix connection to remove broker by using the correct client ID pattern

## [1.1.7]
- Added health check endpoint for better monitoring and automatic recovery
- Added Docker health check configuration

## [1.1.6]
- Simplify reconnect logic

## [1.1.5]
- Improve message loop prevention

## [1.1.4]
- Added ability to fetch device information from the Hame API using username/password
- Added message loop prevention

## [1.1.3]
- Don't forward messages to Cloud when they've not previously been requested from the Cloud to reduce outbound traffic
- Rate limit outbound requests to Cloud to reduce Cloud broker traffic

## [1.1.2] - 2025-03-10
- Fixed duplicate subscriptions after reconnect

## [1.1.1] - 2025-02-27
- Fixed issue with non-inverse forwarding not working as expected

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
