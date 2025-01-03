# Hame Relay

This project helps you integrate your B2500 storage system with both the official mobile app and local home automation systems. It solves two common integration challenges:

1. Using the official app with a locally configured storage system
2. Using home automation with a storage system configured for the official Hame cloud

## How It Works

The B2500 storage system can be configured to use either:
- The official Hame MQTT broker (default) - allows control via the mobile app but not local automation
- A local MQTT broker - allows local automation but breaks mobile app control

This tool bridges these two scenarios by forwarding MQTT messages between your local broker and the Hame broker. It has two modes controlled by the `inverse_forwarding` option:

### Mode 1: Storage configured with local broker (`inverse_forwarding: false`)
- Use this when your storage is configured to use your local MQTT broker
- The relay forwards necessary messages to the Hame broker
- Allows you to keep using the official mobile app while your storage runs on local MQTT

### Mode 2: Storage configured with Hame broker (`inverse_forwarding: true`)
- Use this when your storage is using the default Hame MQTT broker
- The relay forwards messages from your local broker to Hame
- Allows local home automation control without reconfiguring your storage

## Prerequisites

- Either:
  - Docker environment
  - Home Assistant OS or a Home Assistant Supervised installation
- Your storage's Device ID and MAC

You can get your Device ID and MAC address by logging into the [Energy Management System](https://eu.hamedata.com/app/AfterSales/login.html) with your account. The Device ID is the 24-digit value below "Device Configuration". The MAC address is listed below.

## Docker

The relay can be run either directly with Docker or using Docker Compose.

### Option 1: Using Docker

1. Create a directory for your configuration:
```bash
mkdir hame-relay
cd hame-relay
mkdir config
```

2. Create a config file (`config/config.json`):
```json
{
  "broker_url": "mqtt://username:password@your-broker-url",
  "inverse_forwarding": false,
  "devices": [
    { "device_id": "24-digit-device-id", "mac": "maccaddresswithoutcolons" }
  ]
}
```

3. Run the container:
```bash
docker run -d \
  --name hame-relay \
  --restart unless-stopped \
  -v "$(pwd)/config:/app/config" \
  ghcr.io/tomquist/hame-relay:main
```

### Option 2: Using Docker Compose

1. Create a directory for your configuration:
```bash
mkdir hame-relay
cd hame-relay
mkdir config
```

2. Create a config file (`config/config.json`) with the same content as above.

3. Create a `docker-compose.yml` file:
```yaml
version: '3.8'

services:
  mqtt-forwarder:
    image: ghcr.io/tomquist/hame-relay:main
    container_name: hame-relay
    restart: unless-stopped
    volumes:
      - ./config:/app/config
```

4. Start the container:
```bash
docker compose up -d
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

# Choose your operation mode (see "How It Works" section above)
inverse_forwarding: false

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

### Optional Configuration

- `inverse_forwarding`: Choose your operation mode:
  - `false` (default): Storage uses local broker, maintain app functionality
  - `true`: Storage uses Hame broker, enable local control

## Development

For development instructions, see [CONTRIBUTING.md](CONTRIBUTING.md)