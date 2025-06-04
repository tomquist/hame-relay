# Hame Relay

This project helps you integrate your Marstek storage systems with both the official mobile app and local home automation systems. It supports all Marstek storage systems including the Marstek Saturn (B2500), Marstek Venus, and Marstek Jupiter, solving common integration challenges:

1. Using the official app with a locally configured storage system
2. Using home automation with a storage system configured for the official Hame cloud

## How It Works

Marstek storage systems can be configured to use either:
- The official Hame MQTT broker (default) - allows control via the mobile app but not local automation
- A local MQTT broker - allows local automation but breaks mobile app control (**Note: Only available for Marstek Saturn/B2500**)

This tool bridges these two scenarios by forwarding MQTT messages between your local broker and the Hame broker. It has two modes controlled by the `inverse_forwarding` option:

### Mode 1: Storage configured with local broker (`inverse_forwarding: false`)
- **Only available for Marstek Saturn/B2500 systems**
- Use this when your Saturn/B2500 is configured to use your local MQTT broker
- The relay forwards necessary messages to the Hame broker
- Allows you to keep using the official mobile app while your storage runs on local MQTT

### Mode 2: Storage configured with Hame broker (`inverse_forwarding: true`)
- **Required for Marstek Venus and Jupiter systems** (they cannot be reconfigured to use local MQTT)
- **Optional for Marstek Saturn/B2500** if you prefer to keep using the Hame broker
- Use this when your storage is using the default Hame MQTT broker
- The relay forwards messages from your local broker to Hame
- Allows local home automation control without reconfiguring your storage

## Getting Device Information

You need your storage system's Device ID, MAC address, and device type (e.g. HMA-1, HMA-2, HMA-3 etc.) for configuration.

**Recommended approach:**
- Provide your Hame account username and password in the configuration
- The relay will automatically fetch your device information from the Hame API
- Check the application logs to see the retrieved device details
- Update your configuration with the actual values

**Manual approach:**
- If you already know your device details, specify them directly in the configuration

## Prerequisites

- Either:
  - Docker environment
  - Home Assistant OS or a Home Assistant Supervised installation
- **Legal ownership of a Marstek storage system and associated Hame software**

## Configure Storage with Local MQTT Broker

**Note: This section only applies to Marstek Saturn/B2500 systems. Marstek Venus and Jupiter systems cannot be configured with a local MQTT broker and must use Mode 2 (`inverse_forwarding: true`).**

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
  "username": "your_hame_email@example.com",
  "password": "your_hame_password",
  "devices": [
    { "device_id": "24-digit-device-id", "mac": "maccaddresswithoutcolons", "type": "HMA-1" }
  ]
}
```

**Configuration options:**
- `inverse_forwarding`: Choose your operation mode:
  - `false` (default): Storage uses local broker, maintain app functionality (**Only available for Saturn/B2500**)
  - `true`: Storage uses Hame broker, enable local control (**Required for Venus/Jupiter, optional for Saturn/B2500**)
- `username` and `password`: Your Hame account credentials for automatic device information retrieval
- `devices`: Your storage systems' details (can use dummy values initially if using automatic retrieval)

**Getting Device Information:**
- **Recommended**: If you provide `username` and `password`, the relay can fetch your device information automatically from the Hame API. Check the container logs to see the retrieved device details, then update your configuration with the actual values.
- **Manual**: If you know your device details, you can specify them directly in the `devices` array.

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
3. Configure your device details
4. Start the add-on

## Configuration

Example configuration:

```yaml
# Optional: only needed if not using Home Assistant's MQTT service
mqtt_uri: "mqtt://username:password@host:1883"

# Choose your operation mode
inverse_forwarding: false

# Optional: Hame account credentials to automatically fetch device information
username: "your_hame_email@example.com"
password: "your_hame_password"

devices:
  - device_id: "0123456789abcdef01234567"
    mac: "01234567890a"
    type: "HMA-1"
  - device_id: "0123456789abcdef01234567"
    mac: "01234567890a"
    type: "HMA-1"
```

**Getting Device Information:**
- **Automatic retrieval**: If you provide `username` and `password`, the add-on will automatically fetch your device information from the Hame API
- **Important for Home Assistant**: You must include at least one device in the `devices` list (even if using automatic retrieval). You can use dummy values initially, then check the add-on logs to see your actual device details and update the configuration accordingly
- **Manual configuration**: If you already know your device details, specify them directly in the `devices` array

### MQTT Configuration

The add-on will automatically use your Home Assistant MQTT settings if configured. You only need to provide the `mqtt_uri` if you want to use a different MQTT broker.

### Required Configuration

- `devices`: List of your Marstek storage systems with their IDs, MAC addresses and types
  - `device_id`: Your device's 22 to 24-digit ID
  - `mac`: Your device's MAC address without colons
  - `type`: Your device's type (e.g. HMA-1, HMA-2, HMA-3 etc.)
  - `inverse_forwarding`: (optional) Override the global setting for the operation mode of this device

### Optional Configuration

- `inverse_forwarding`: Choose your operation mode:
  - `false` (default): Storage uses local broker, maintain app functionality (**Only available for Saturn/B2500**)
  - `true`: Storage uses Hame broker, enable local control (**Required for Venus/Jupiter, optional for Saturn/B2500**)
- `username`: Your Hame account email address. When provided along with password, 
  the tool will automatically fetch device information from the Hame API and display it in the logs.
- `password`: Your Hame account password. Required when using automatic device information retrieval.

## Development

For development instructions, see [CONTRIBUTING.md](CONTRIBUTING.md)

## Interoperability Statement

This software is developed for the sole purpose of achieving interoperability between Marstek storage systems and home automation platforms, in accordance with EU Directive 2009/24/EC Article 6. The relay enables legitimate users to maintain functionality of both official mobile applications and local automation systems that would otherwise be mutually exclusive. All reverse engineering activities conducted during development were limited to extracting only the minimum information necessary to establish communication protocols for interoperability purposes.

**Legal Compliance**: This project does not compete with or replace the original Hame software. Users must own legitimate copies of the original software and hardware. Any embedded certificates or authentication data included are used solely for interoperability purposes as permitted under EU Directive 2009/24/EC Article 6.

## License & Legal

This project is provided for interoperability purposes only. Users are responsible for ensuring compliance with applicable laws in their jurisdiction. The project maintainers make no warranties regarding legal compliance beyond the stated interoperability purpose.