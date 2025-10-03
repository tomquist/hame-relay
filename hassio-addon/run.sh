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

# Create config directory and ensure bundled broker config is available
mkdir -p /app/config

# Get MQTT URI
BROKER_URL=$(get_mqtt_uri)

# Create config.json
bashio::log.info "Generating config file..."

# Get required configuration values
if ! bashio::config.has_value 'username'; then
    bashio::log.error "Username is required but not provided in configuration."
    exit 1
fi

if ! bashio::config.has_value 'password'; then
    bashio::log.error "Password is required but not provided in configuration."
    exit 1
fi

USERNAME=$(bashio::config 'username')
PASSWORD=$(bashio::config 'password')
INVERSE_FORWARDING=$(bashio::config 'inverse_forwarding' "false")
DEFAULT_BROKER_ID=$(bashio::config 'default_broker_id' "hame-2024")
LOG_LEVEL=$(bashio::config 'log_level' "info")

bashio::log.info "Username and password found in configuration."

# Build the config JSON with required fields
CONFIG_JSON='{
  "broker_url": $url,
  "inverse_forwarding": $inverse,
  "default_broker_id": $default,
  "username": $username,
  "password": $password
}'

# Check for optional selective forwarding configuration
if bashio::config.has_value 'inverse_forwarding_device_ids'; then
    INVERSE_FORWARDING_DEVICE_IDS=$(bashio::config 'inverse_forwarding_device_ids')
    bashio::log.info "Selective inverse forwarding device IDs found: $INVERSE_FORWARDING_DEVICE_IDS"
    
    # Create config with selective forwarding
    jq -n \
      --arg url "$BROKER_URL" \
      --argjson inverse "$INVERSE_FORWARDING" \
      --arg default "$DEFAULT_BROKER_ID" \
      --arg username "$USERNAME" \
      --arg password "$PASSWORD" \
      --arg device_ids "$INVERSE_FORWARDING_DEVICE_IDS" \
      '{
        broker_url: $url,
        inverse_forwarding: $inverse,
        default_broker_id: $default,
        username: $username,
        password: $password,
        inverse_forwarding_device_ids: $device_ids
      }' > /app/config/config.json
else
    # Create config without selective forwarding
    jq -n \
      --arg url "$BROKER_URL" \
      --argjson inverse "$INVERSE_FORWARDING" \
      --arg default "$DEFAULT_BROKER_ID" \
      --arg username "$USERNAME" \
      --arg password "$PASSWORD" \
      '{
        broker_url: $url,
        inverse_forwarding: $inverse,
        default_broker_id: $default,
        username: $username,
        password: $password
      }' > /app/config/config.json
fi

bashio::log.info "Configuration file generated successfully."

# Start the application
export LOG_LEVEL
bashio::log.info "Starting MQTT forwarder..."
cd /app && node dist/main.js
