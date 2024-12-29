# Hame Relay

This project allows you to connect your B2500 storage system to a local MQTT broker while maintaining the ability to use the official mobile app for remote access.

## Prerequisites

- Either of the following two:
  - Docker environment
  - Home Assistant OS or a Home Assistant Supervised installation
- Your storage's Device ID and MAC
- Your storage needs to be configured to a custom MQTT broker

You can get your Device ID and MAC address by logging into the [Energy Management System](https://eu.hamedata.com/app/AfterSales/login.html) with your account. The Device ID is the 24-digit value below "Device Configuration". The MAC address is listed below.

## Configure Storage with custom MQTT broker

1. If not already done, enable the MQTT option through the [Energy Management System](https://eu.hamedata.com/app/AfterSales/login.html) by toggling "MQTT enabled" on.
2. Open the Power Zero/Marstek App and connect to your storage via Bluetooth
3. Under "Settings" you'll see an option "MQTT" now
4. Fill out your MQTT broker settings. Make sure to enable or disable the checkbox "SSL connection enabled", depending on whether your broker supports SSL (disable if unsure).
4. Safe

Now your storage can be controlled through your own MQTT broker. See [this document](https://eu.hamedata.com/ems/mqtt/index.html?version=2) for more information.

## Docker

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

3. Run with Docker Compose:
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

# Home Assistant

## Installation

1. Add this repository to your Home Assistant add-on store:
   ```
   https://github.com/tomquist/hame-relay
   ```

2. Install the "Hame Relay" add-on
3. Configure your device details (see below)
4. Start the add-on

## Configuration

Example configuration:

```yaml
# Optional: only needed if not using Home Assistant's MQTT service
mqtt_uri: "mqtt://username:password@host:1883"

devices:
  - device_id: "0123456789abcdef01234567"
    mac: "01234567890a"
  - device_id: "0123456789abcdef01234567"
    mac: "01234567890a"
```

### MQTT Configuration

The add-on will automatically use your Home Assistant MQTT settings if configured. You only need to provide the `mqtt_uri` if you want to use a different MQTT broker.

### Required Configuration

- `devices`: List of your B2500 devices with their IDs and MAC addresses

## Development

For development instructions, see [CONTRIBUTING.md](CONTRIBUTING.md)