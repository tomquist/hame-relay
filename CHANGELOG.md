# Changelog

## [1.2.0]
- Support multiple remote brokers via new `brokers.json`
- Added `default_broker_id` config option and per-device broker selection
- Single health server now checks all broker connections
- Home Assistant addon updated for new settings

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
