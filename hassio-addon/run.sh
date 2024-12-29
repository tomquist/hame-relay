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

jq -n --arg url "$BROKER_URL" --argjson devices "$DEVICES" '{
    broker_url: $url,
    devices: $devices
}' > /app/config/config.json

# Start the application
bashio::log.info "Starting MQTT forwarder..."
cd /app && node dist/forwarder.js
