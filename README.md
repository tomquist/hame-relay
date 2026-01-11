# Hame Relay

This project helps you integrate your Marstek storage systems with both the official mobile app and local home automation systems. It supports all Marstek storage systems including the Marstek Saturn (B2500), Marstek Venus, and Marstek Jupiter, solving common integration challenges:

1. Using the official app with a locally configured storage system
2. Using home automation with a storage system configured for the official Hame cloud

**Important Note**: Hame Relay only forwards MQTT messages between the Hame cloud and your local MQTT broker. It does not create Home Assistant device entities or provide device integration. For full Home Assistant integration with automatic device discovery and control entities, use [hm2mqtt](https://github.com/tomquist/hm2mqtt) on top of Hame Relay.

## Quick Start for Home Assistant Users

The easiest way to get started is with the Home Assistant add-on:

### Installation

1. Add this repository to your Home Assistant add-on store:
   ```
   https://github.com/tomquist/hame-relay
   ```

2. Install the "Hame Relay" add-on
3. Enter your Hame account credentials (see configuration below)
4. Start the add-on

### Simple Configuration

Just enter your Hame account credentials. The add-on will automatically discover and configure all your devices:

```yaml
# Required: Your Hame account credentials
username: "your_hame_email@example.com"
password: "your_hame_password"
```

The add-on will:
- Automatically discover all your Marstek devices
- Configure the optimal forwarding direction for each device type
- Handle all the complex technical details behind the scenes

### Optional Settings

If you need to customize the behavior, you can also configure:

```yaml
# Optional: Use different MQTT broker (defaults to Home Assistant's MQTT)
mqtt_uri: "mqtt://username:password@host:1883"

# Optional: Global setting to flip all forwarding directions (do not enable unless you absolutely know what you're doing)
# Bug reports with this setting enabled will be closed immediately.
inverse_forwarding: false

# Optional: For HMA/HMF/HMK/HMJ devices, specify which ones should use inverse forwarding
# Example: "0123456789abcdef01234567,9876543210fedcba76543210"
inverse_forwarding_device_ids: ""
```

The add-on handles everything else automatically.

## How It Works

Marstek storage systems can be configured to use either:
- The official Hame MQTT broker (default) - allows control via the mobile app but not local automation
- A local MQTT broker - allows local automation but breaks mobile app control (**Note: Only available for Marstek Saturn/B2500**)

This tool bridges these two scenarios by forwarding MQTT messages between your local broker and the Hame broker. The add-on automatically determines the best forwarding direction for each device type:

### Automatic Configuration
- **JPLS, HMM, HMN, HME, TPM-CN, HMG and other devices**: Always use inverse forwarding (required for proper operation)
- **HMA, HMF, HMK, HMJ devices**: Use selective forwarding based on your configuration (see `inverse_forwarding_device_ids`)

### Manual Mode Selection (Advanced)
You can also manually control the forwarding direction:

**Mode 1: Storage configured with local broker**
- **Only available for Marstek Saturn/B2500 systems**
- Use this when your Saturn/B2500 is configured to use your local MQTT broker
- The relay forwards necessary messages to the Hame broker
- Allows you to keep using the official mobile app while your storage runs on local MQTT

**Mode 2: Storage configured with Hame broker**
- **Required for Marstek Venus and Jupiter systems** (they cannot be reconfigured to use local MQTT)
- **Optional for Marstek Saturn/B2500** if you prefer to keep using the Hame broker
- Use this when your storage is using the default Hame MQTT broker
- The relay forwards messages from your local broker to Hame
- Allows local home automation control without reconfiguring your storage

## Prerequisites

- Either:
  - Home Assistant OS or a Home Assistant Supervised installation
  - Docker environment (see Advanced Docker Setup below)
- **Legal ownership of a Marstek storage system and associated Hame software**

## Advanced: Configure Storage with Local MQTT Broker

**Note: This section only applies to Marstek Saturn/B2500 systems. Marstek Venus and Jupiter systems cannot be configured with a local MQTT broker and must use inverse forwarding.**

This configuration allows you to use Mode 1, where your Saturn/B2500 connects to your local MQTT broker while maintaining mobile app functionality.

**You have two options to enable and configure MQTT:**

### Option 1: Contact Support (Recommended)
1. **Contact support to enable MQTT**: Use the in-app feedback functionality in the Power Zero/Marstek App to contact support and request MQTT activation for your B2500 device
2. Open the Power Zero/Marstek App and connect to your storage via Bluetooth
3. Under "Settings" you'll see an option "MQTT" now (after support has enabled it)
4. Fill out your MQTT broker settings. Make sure to enable or disable the checkbox "SSL connection enabled", depending on whether your broker supports SSL (disable if unsure)
5. **Important**: Make sure you write down the MAC address displayed in the Marstek app! You will need it later and the WIFI MAC address of the battery is the wrong one.
6. Save

### Option 2: Direct Bluetooth Configuration
1. With an Android smartphone or Bluetooth-enabled PC, use [this tool](https://tomquist.github.io/hame-relay/b2500.html) to configure the MQTT broker directly via Bluetooth
2. **Important**: Make sure you write down the MAC address that is displayed in this tool! You will need it later and the WIFI MAC address of the battery is the wrong one.

**⚠️ Important Warning**: Enabling MQTT on the device will disable the cloud connection. You will not be able to use the PowerZero or Marstek app to monitor or control your device anymore. You can re-enable the cloud connection by using this Hame Relay tool in Mode 1.

Now your storage can be controlled through your own MQTT broker. See [this document](https://eu.hamedata.com/ems/mqtt/index.html?version=2) for more information.

## Advanced: Docker Setup

For advanced users who prefer Docker over the Home Assistant add-on, you can run the relay directly.

### Simple Docker Setup

1. Create a directory for your configuration:
```bash
mkdir hame-relay
cd hame-relay
mkdir config
```

2. Create a minimal config file (`config/config.json`):
```json
{
  "broker_url": "mqtt://username:password@your-broker-url",
  "username": "your_hame_email@example.com",
  "password": "your_hame_password"
}
```

3. Run the container:
```bash
docker run -d \
  --name hame-relay \
  --restart unless-stopped \
  -v "$(pwd)/config:/app/config" \
  -e LOG_LEVEL=info \
  ghcr.io/tomquist/hame-relay:latest
```

### Docker Compose

Create a `docker-compose.yml` file:
```yaml
version: '3.8'

services:
  mqtt-forwarder:
    image: ghcr.io/tomquist/hame-relay:latest
    container_name: hame-relay
    restart: unless-stopped
    volumes:
      - ./config:/app/config
    environment:
      - LOG_LEVEL=info
```

Start the container:
```bash
docker compose up -d
```

### Advanced Docker Configuration

The Docker version supports additional configuration options not available in the Home Assistant add-on.

**Warning**: Do not enable `inverse_forwarding` unless you absolutely know what you're doing. Bug reports with this setting enabled will be closed immediately.

```json
{
  "broker_url": "mqtt://username:password@your-broker-url",
  "username": "your_hame_email@example.com",
  "password": "your_hame_password",
  "inverse_forwarding": false,
  "default_broker_id": "hame-2024",
  "inverse_forwarding_device_ids": "",
  "devices": [
    { 
      "device_id": "24-digit-device-id", 
      "mac": "maccaddresswithoutcolons", 
      "type": "HMA-1", 
      "version": 0,
      "inverse_forwarding": true,
      "broker_id": "hame-2025"
    }
  ]
}
```

## Using the Development Version

The `next` tag provides access to the version currently in development. It's built from the develop branch and contains the latest features and fixes before they're officially released. Use this if you want to test new features early or need a specific fix that hasn't been released yet.

**Warning:** The development version may be unstable and contain bugs. Only use it if you need bleeding-edge features or fixes.

### Docker

Replace `latest` with `next` in your image tag:

```bash
docker run -d \
  --name hame-relay \
  --restart unless-stopped \
  -v "$(pwd)/config:/app/config" \
  -e LOG_LEVEL=info \
  ghcr.io/tomquist/hame-relay:next
```

Or in `docker-compose.yml`:
```yaml
services:
  mqtt-forwarder:
    image: ghcr.io/tomquist/hame-relay:next
```

### Home Assistant

Add the development branch repository to your Home Assistant add-on store:
```text
https://github.com/tomquist/hame-relay#develop
```

Then install the "Hame Relay" add-on from this repository to get the development version.

## Development

For development instructions, see [CONTRIBUTING.md](CONTRIBUTING.md)

## Interoperability Statement

This software is developed for the sole purpose of achieving interoperability between Marstek storage systems and home automation platforms, in accordance with EU Directive 2009/24/EC Article 6. The relay enables legitimate users to maintain functionality of both official mobile applications and local automation systems that would otherwise be mutually exclusive. All reverse engineering activities conducted during development were limited to extracting only the minimum information necessary to establish communication protocols for interoperability purposes.

**Legal Compliance**: This project does not compete with or replace the original Hame software. Users must own legitimate copies of the original software and hardware. Any embedded certificates or authentication data included are used solely for interoperability purposes as permitted under EU Directive 2009/24/EC Article 6.

## License & Legal

This project is provided for interoperability purposes only. Users are responsible for ensuring compliance with applicable laws in their jurisdiction. The project maintainers make no warranties regarding legal compliance beyond the stated interoperability purpose.
