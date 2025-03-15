#!/usr/bin/with-contenv bashio

# Function to get MQTT URI
get_mqtt_uri() {
    if bashio::config.has_value 'mqtt_uri'; then
        bashio::config 'mqtt_uri'
    elif bashio::services.available "mqtt"; then
        local ssl=$(bashio::services mqtt "ssl")
        local protocol="mqtt"
        if [[ "$ssl" == "true" ]]; then
            protocol="mqtts"
        fi
        local host=$(bashio::services mqtt "host")
        local port=$(bashio::services mqtt "port")
        local username=$(bashio::services mqtt "username")
        local password=$(bashio::services mqtt "password")

        local uri="${protocol}://"
        if [[ -n "$username" && -n "$password" ]]; then
            uri+="${username}:${password}@"
        elif [[ -n "$username" ]]; then
            uri+="${username}@"
        fi
        uri+="${host}:${port}"
        echo "$uri"
    else
        bashio::log.error "No MQTT URI provided in config and MQTT service is not available."
        exit 1
    fi
}

# Create config directory
mkdir -p /app/config

# Get MQTT URI
BROKER_URL=$(get_mqtt_uri)

# Create config.json
bashio::log.info "Generating config file..."
DEVICES=$(bashio::config 'devices' | jq -s '.')
INVERSE_FORWARDING=$(bashio::config 'inverse_forwarding' "false")

# Check for optional username and password
CONFIG="{
    broker_url: \$url,
    devices: \$devices,
    inverse_forwarding: \$inverse
}"

if bashio::config.has_value 'username'; then
    USERNAME=$(bashio::config 'username')
    CONFIG=$(echo "$CONFIG" | jq -c --arg username "$USERNAME" '. + {username: $username}')
    bashio::log.info "Username found in configuration."
fi

if bashio::config.has_value 'password'; then
    PASSWORD=$(bashio::config 'password')
    CONFIG=$(echo "$CONFIG" | jq -c --arg password "$PASSWORD" '. + {password: $password}')
    bashio::log.info "Password found in configuration."
fi

# Create the final config file
jq -n --arg url "$BROKER_URL" --argjson devices "$DEVICES" --argjson inverse "$INVERSE_FORWARDING" "$CONFIG" > /app/config/config.json

# Start the application
bashio::log.info "Starting MQTT forwarder..."
cd /app && node dist/forwarder.js
