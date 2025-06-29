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

# Copy default brokers configuration
cp /app/brokers.json /app/config/brokers.json

# Get MQTT URI
BROKER_URL=$(get_mqtt_uri)

# Create config.json
bashio::log.info "Generating config file..."
DEVICES=$(bashio::config 'devices' | jq -s '.')
INVERSE_FORWARDING=$(bashio::config 'inverse_forwarding' "false")
DEFAULT_BROKER_ID=$(bashio::config 'default_broker_id' "hame-2024")
LOG_LEVEL=$(bashio::config 'log_level' "info")

# Create base configuration
CONFIG='{
  "broker_url": $url,
  "devices": $devices,
  "inverse_forwarding": $inverse
}'

# Check for optional username and password
if bashio::config.has_value 'username'; then
    USERNAME=$(bashio::config 'username')
    bashio::log.info "Username found in configuration."
    
    # Add username to config
    if bashio::config.has_value 'password'; then
        PASSWORD=$(bashio::config 'password')
        bashio::log.info "Password found in configuration."
        
        # Add both username and password to config
        jq -n \
          --arg url "$BROKER_URL" \
          --argjson devices "$DEVICES" \
          --argjson inverse "$INVERSE_FORWARDING" \
          --arg default "$DEFAULT_BROKER_ID" \
          --arg username "$USERNAME" \
          --arg password "$PASSWORD" \
          '{
            broker_url: $url,
            devices: $devices,
            inverse_forwarding: $inverse,
            default_broker_id: $default,
            username: $username,
            password: $password
          }' > /app/config/config.json
    else
        # Add only username to config
        jq -n \
          --arg url "$BROKER_URL" \
          --argjson devices "$DEVICES" \
          --argjson inverse "$INVERSE_FORWARDING" \
          --arg default "$DEFAULT_BROKER_ID" \
          --arg username "$USERNAME" \
          '{
            broker_url: $url,
            devices: $devices,
            inverse_forwarding: $inverse,
            default_broker_id: $default,
            username: $username
          }' > /app/config/config.json
    fi
else
    # Create config file without username/password
    jq -n \
      --arg url "$BROKER_URL" \
      --argjson devices "$DEVICES" \
      --argjson inverse "$INVERSE_FORWARDING" \
      --arg default "$DEFAULT_BROKER_ID" \
      '{
        broker_url: $url,
        devices: $devices,
        inverse_forwarding: $inverse,
        default_broker_id: $default
      }' > /app/config/config.json
fi

# Start the application
export LOG_LEVEL
bashio::log.info "Starting MQTT forwarder..."
cd /app && node dist/forwarder.js
