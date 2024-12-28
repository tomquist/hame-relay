# Hame Relay

This project allows you to connect your B2500 storage system to a local MQTT broker while maintaining the ability to use the official mobile app for remote access.

## Quick Start

1. Pull and run the container:
```bash
docker pull ghcr.io/tomquist/hame-relay:main
```

2. Create a config file (`config.json`):
```json
{
  "broker_url": "mqtt://username:password@your-broker-url",
  "devices": [
    { "device_id": "24-digit-device-id", "mac": "maccaddresswithoutcolons" }
  ]
}
```

3. Run with Docker Compose (recommended):
```yaml
# docker-compose.yml
version: '3.8'

services:
  mqtt-forwarder:
    image: ghcr.io/tomquist/hame-relay:main
    container_name: mqtt-forwarder
    restart: unless-stopped
    volumes:
      - ./config:/app/config
```

```bash
docker-compose up -d
```
# Home Assistant Add-on

## Installation

1. Add this repository to your Home Assistant add-on store:
   ```
   https://github.com/tomquist/hame-relay
   ```

2. Install the "Hame Relay" add-on
3. Configure your device details
4. Start the add-on

## Configuration

Example configuration:

```yaml
# Optional: only needed if not using Home Assistant's MQTT service
mqtt_uri: "mqtt://username:password@host:1883"

devices:
  - device_id: "24-digit-device-id"
    mac: "maccaddresswithoutcolons"
```

### MQTT Configuration

The add-on will automatically use your Home Assistant MQTT settings if configured. You only need to provide the `mqtt_uri` if you want to use a different MQTT broker.

### Required Configuration

- `devices`: List of your B2500 devices with their IDs and MAC addresses

## Development

For development instructions, see [CONTRIBUTING.md](CONTRIBUTING.md)