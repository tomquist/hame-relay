import * as mqtt from 'mqtt';
import {MqttClient} from 'mqtt';
import {readFileSync} from 'fs';
import {join} from 'path';
import {createHash} from 'crypto';
import fetch from 'node-fetch';
import {calculateNewVersionTopicId} from './encryption';
import {HealthServer} from './health';

const deviceGenerations = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 50] as const;
type DeviceGen = typeof deviceGenerations[number];
const deviceTypes = ["A", "B", "D", "E", "F", "G", "J", "K", "I", "M", "N"] as const;
type DeviceType = typeof deviceTypes[number];
type DeviceTypeIdentifier = `HM${DeviceType}-${DeviceGen}`;
const knownDeviceTypes: DeviceTypeIdentifier[] = deviceGenerations.flatMap(gen => deviceTypes.map(type => `HM${type}-${gen}` satisfies DeviceTypeIdentifier));

interface Device {
  device_id: string;
  mac: string;
  type: DeviceTypeIdentifier;
  inverse_forwarding?: boolean;
  name?: string;
  broker_id?: string;
  remote_id?: string;
}

interface BrokerDefinition {
  url: string;
  ca: string;
  cert: string;
  key: string;
  topic_prefix?: string;
  topic_encryption_key?: string;
  client_id_prefix?: string;
}

interface ForwarderConfig {
  broker_url: string;
  devices: Device[];
  inverse_forwarding?: boolean;
  username?: string;
  password?: string;
  remote: BrokerDefinition;
}

interface MainConfig {
  broker_url: string;
  devices: Device[];
  inverse_forwarding?: boolean;
  username?: string;
  password?: string;
  default_broker_id?: string;
}

interface HameApiResponse {
  code: string;
  msg: string;
  token?: string;
  data: Array<{
    devid: string;
    name: string;
    sn: string | null;
    mac: string;
    type: string;
    access: string;
    bluetooth_name: string;
  }> | string;
}

/**
 * Fetches device information from the Hame API
 * @param username Email address used for the Hame account
 * @param password Plain text password
 * @returns Promise resolving to device information array
 */
async function fetchDevicesFromApi(username: string, password: string): Promise<Device[]> {
  try {
    // Hash password with MD5
    const hashedPassword = createHash('md5').update(password).digest('hex');
    
    const url = new URL('https://eu.hamedata.com/app/Solar/v2_get_device.php');
    url.searchParams.append('mailbox', username);
    url.searchParams.append('pwd', hashedPassword);
    
    console.log(`Fetching device information for ${username}...`);
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Dart/2.19 (dart:io)',
      }
    });
    const data: HameApiResponse = await response.json();
    
    if (data.code === '2') {
      console.log('Successfully fetched device information from API');
      if (Array.isArray(data.data)) {
        return data.data.map(device => {
          // Map the API response to our Device interface
          // Try to determine the device type based on the API response
          let deviceType = device.type as DeviceTypeIdentifier;
          if (!knownDeviceTypes.includes(deviceType)) {
            console.warn(`Unknown device type from API: ${device.type}. Using as-is.`);
          }
          
          return {
            device_id: device.devid,
            mac: device.mac,
            type: deviceType,
            name: device.name
          };
        });
      } else {
        throw new Error('Unexpected API response format: data is not an array');
      }
    } else if (data.code === '3') {
      throw new Error('Email not registered with Hame');
    } else if (data.code === '4') {
      throw new Error('Incorrect password');
    } else {
      throw new Error(`Unknown API response code: ${data.code} - ${data.msg}`);
    }
  } catch (error) {
    console.error('Error fetching devices from API:', error);
    throw error;
  }
}

function cleanAndValidate(config: {devices: Device[]}): void {
  if (config.devices.length === 0) {
    throw new Error('No devices specified in config file');
  }
  const remainingDevices = [];
  const errors = [];
  for (const device of config.devices) {
    try {
      if (!device.device_id) {
        throw new Error('Device ID is required');
      }
      if (!device.mac) {
        throw new Error('MAC address is required');
      }
      if (!device.type) {
        throw new Error('Device type is required');
      }
      device.device_id = device.device_id.trim();
      // Remove colons from MAC address and convert to lowercase
      device.mac = device.mac.trim().replace(/:/g, '').toLowerCase();
      device.type = device.type.trim().toUpperCase() as DeviceTypeIdentifier;
      if (device.device_id.length !== 12 && (device.device_id.length < 22 || device.device_id.length > 24)) {
        throw new Error('Device ID must be between 22 and 24 or exactly 12 characters long');
      }
      if (!/^[0-9A-Fa-f]{12}$/.test(device.mac)) {
        throw new Error('MAC address must be a 12-character hexadecimal string');
      }
      if (device.type && !knownDeviceTypes.includes(device.type)) {
        console.warn(`Unknown device type: ${device.type}. This device will likely not be forwarded.`);
      }
      remainingDevices.push(device);
    } catch (error) {
      errors.push(`Device ${device.device_id}: ${(error as Error).message}`);
    }
  }
  config.devices = remainingDevices;

  if (errors.length > 0) {
    if (config.devices.length === 0) {
      throw new Error(`All devices failed validation:\n${errors.join('\n')}`);
    } else {
      console.warn(`Some devices failed validation:\n${errors.join('\n')}`);
    }
  }
}

class MQTTForwarder {
  private configBroker!: mqtt.MqttClient;
  private remoteBroker!: mqtt.MqttClient;
  private readonly MESSAGE_HISTORY_TIMEOUT = 1000; // 1 second timeout
  private readonly RATE_LIMIT_INTERVAL = 59900; // Rate limit interval in milliseconds
  private readonly MESSAGE_CACHE_TIMEOUT = 1000; // 1 second timeout for message loop prevention
  private readonly INSTANCE_ID = createHash('md5').update(`${Date.now()}-${Math.random()}`).digest('hex').substring(0, 8); // Unique ID for this instance
  private appMessageHistory: Map<string, number> = new Map(); // Store when App messages were forwarded
  private rateLimitedMessages: Map<string, number> = new Map(); // Store when rate-limited messages were last forwarded
  private processedMessages: Map<string, number> = new Map(); // Store message hashes to prevent loops
  private readonly RATE_LIMITED_CODES = [1, 13, 15, 16, 21, 26, 28, 30]; // Message codes to rate-limit (as numbers)

  constructor(private readonly config: ForwarderConfig) {
    this.initializeBrokers();
  }

  public getRemoteBroker(): MqttClient {
    return this.remoteBroker;
  }

  public getConfigBroker(): MqttClient {
    return this.configBroker;
  }

  /**
   * Checks if a message should be rate-limited based on its content
   * @param message The message buffer to check
   * @param deviceKey The unique device key
   * @returns true if the message should be rate-limited, false otherwise
   */
  private shouldRateLimit(message: Buffer, deviceKey: string): boolean {
    try {
      const messageStr = message.toString();
      
      // Extract the code number from the message
      const codeMatch = messageStr.match(/cd=0*(\d+)/);
      if (!codeMatch) {
        return false;
      }
      
      // Convert the extracted code to a number
      const messageCodeNum = parseInt(codeMatch[1], 10);
      
      // Check if the code is in our rate-limited list
      if (!this.RATE_LIMITED_CODES.includes(messageCodeNum)) {
        return false;
      }
      
      // Create a unique key for this device and message type
      const rateLimitKey = `${deviceKey}:${messageCodeNum}`;
      
      // Check if we've seen this message recently
      const lastSentTime = this.rateLimitedMessages.get(rateLimitKey);
      const currentTime = Date.now();
      
      if (lastSentTime && (currentTime - lastSentTime < this.RATE_LIMIT_INTERVAL)) {
        const remainingTime = this.RATE_LIMIT_INTERVAL - (currentTime - lastSentTime);
        console.log(`Devices configured with inverse_forwarding get rate limited. Rate limiting message with code cd=${messageCodeNum} for device ${deviceKey}. Please wait for ${remainingTime}ms before sending another message. Use inverse_forwarding=false to avoid rate limiting.`);
        return true;
      }
      
      // Update the last sent time for this message type
      this.rateLimitedMessages.set(rateLimitKey, currentTime);
      return false;
    } catch (error) {
      console.error('Error in rate limiting logic:', error);
      return false; // On error, don't rate limit
    }
  }

  private loadCertificates(): { ca: Buffer; cert: Buffer; key: Buffer } {
    try {
      return {
        ca: readFileSync(join(process.env.CERT_PATH || './certs', this.config.remote.ca)),
        cert: readFileSync(join(process.env.CERT_PATH || './certs', this.config.remote.cert)),
        key: readFileSync(join(process.env.CERT_PATH || './certs', this.config.remote.key))
      };
    } catch (error: unknown) {
      console.error('Failed to load certificates:', error);
      throw error;
    }
  }

  private initializeBrokers(): void {
    const configOptions = {
      keepalive: 30,
      clientId: this.generateClientId('config_')
    };
    this.configBroker = mqtt.connect(this.config.broker_url, configOptions);

    const certs = this.loadCertificates();
    const remoteOptions = {
      ...certs,
      protocol: 'mqtts' as const,
      keepalive: 30,
      clientId: this.generateClientId(this.config.remote.client_id_prefix || 'hm_')
    };
    this.remoteBroker = mqtt.connect(this.config.remote.url, remoteOptions);

    this.setupBrokerEventHandlers();
  }

  private generateClientId(prefix: string): string {
    let randomClientId = '';
    for (let i = 0; i < 24; i++) {
      randomClientId += Math.floor(Math.random() * 16).toString(16);
    }
    return `${prefix}${randomClientId}`;
  }

  private setupBrokerEventHandlers(): void {
    // Config broker event handlers
    this.configBroker.on('connect', () => {
      console.log('Connected to config broker');
    });
    this.setupConfigSubscriptions();

    // Set up error handlers
    this.configBroker.on('error', (error: Error) => {
      console.error('Config broker error:', error);
    });

    this.configBroker.on('disconnect', () => {
      console.warn('Config broker disconnected');
    });

    this.configBroker.on('offline', () => {
      console.warn('Config broker went offline');
    });

    // Remote broker event handlers
    this.remoteBroker.on('connect', () => {
      console.log('Connected to remote broker');
    });
    this.setupRemoteSubscriptions();

    this.remoteBroker.on('error', (error: Error) => {
      console.error('Remote broker error:', error);
    });

    this.remoteBroker.on('disconnect', () => {
      console.warn('Remote broker disconnected');
    });

    this.remoteBroker.on('offline', () => {
      console.warn('Remote broker went offline');
    });
  }

  private setupConfigSubscriptions(): void {
    this.setupSubscriptions(this.configBroker);
  }

  private setupRemoteSubscriptions(): void {
    this.setupSubscriptions(this.remoteBroker);
  }

  private setupSubscriptions(broker: MqttClient): void {
    const key = broker === this.configBroker ? 'mac' : 'remote_id';
    const brokerName = broker === this.configBroker ? 'local' : 'remote';
    const topics = this.config.devices.map(device => {
      const {[key]: identifier, type: type} = device;
      let inverseForwarding = device.inverse_forwarding ?? this.config.inverse_forwarding;
      if (broker === this.configBroker) {
        inverseForwarding = !inverseForwarding;
      }
      const prefix = this.config.remote.topic_prefix || 'hame_energy/';
      return inverseForwarding ?
          `${prefix}${type}/device/${identifier}/ctrl` :
          `${prefix}${type}/App/${identifier}/ctrl`;
    });
    console.log(`Subscribing to ${brokerName} broker topics:\n${topics.join("\n")}`);
    broker.subscribe(topics, (err: Error | null) => {
      if (err) {
        console.error(`Error subscribing to ${brokerName} broker for device:`, err);
        return;
      }
      console.log(`Subscribed to ${brokerName} broker topics`);
    });

    broker.on('message', (topic: string, message: Buffer, packet: mqtt.IPublishPacket) => {
      this.forwardMessage(topic, message, broker === this.configBroker ? this.remoteBroker : this.configBroker, packet);
    });
  }

  /**
   * Checks if a message has been processed by this or another relay instance
   * @param packet The MQTT packet containing message and properties
   * @returns true if the message has been processed and should be skipped, false otherwise
   */
  private isMessageProcessed(packet: mqtt.IPublishPacket): boolean {
    try {
      // Check if this message has a relay header
      if (packet.properties && packet.properties.userProperties) {
        const userProps = packet.properties.userProperties;
        
        // Check if this message has our relay instance ID or another relay's
        if (typeof userProps.relayInstanceId === "string") {
          // Message has already been processed by a relay
          if (userProps.relayInstanceId === this.INSTANCE_ID) {
            // This is our own message coming back - definitely skip it
            console.log('Skipping message from our own relay instance');
            return true;
          } else {
            // Message from another relay instance - also skip it to prevent loops
            console.log(`Skipping message from relay instance: ${userProps.relayInstanceId.substring(0, 8)}`);
            return true;
          }
        }
      }
      return false;
    } catch (error) {
      console.error('Error checking if message is processed:', error);
      return false; // On error, don't skip the message
    }
  }
  
  private forwardMessage(topic: string, message: Buffer, targetClient: MqttClient, packet?: mqtt.IPublishPacket): void {
    const prefix = this.config.remote.topic_prefix || 'hame_energy/';
    const pattern = new RegExp(`^${prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}([^/]+)/(device|App)/(.*)/ctrl`);

    const matches = topic.match(pattern);
    if (matches) {
      // Check if this is a looped message that should be skipped
      if (packet && this.isMessageProcessed(packet)) {
        return;
      }
      
      const type = matches[1];
      const isDevice = matches[2] === 'device';
      const identifier = matches[3]!;
      const sourceKey = targetClient === this.configBroker ? 'remote_id' : 'mac';
      const targetKey = targetClient === this.configBroker ? 'mac' : 'remote_id';
      const device = this.config.devices.find(device => device[sourceKey] === identifier && device.type === type);
      if (!device) {
        console.warn(`Unknown device received (${type}): ${identifier}`);
        return;
      }
      const inverseForwarding = device.inverse_forwarding ?? this.config.inverse_forwarding;
      
      // Create a unique key for this device
      const deviceKey = `${device.type}:${device.device_id}:${device.mac}`;
      
      if (targetClient === this.configBroker) {
        if (isDevice && !inverseForwarding) {
          console.warn(`Ignoring remote device message for device without inverse forwarding: ${topic}`);
          return;
        } else if (!isDevice && inverseForwarding) {
          console.warn(`Ignoring remote App message for device with direct forwarding: ${topic}`);
          return;
        }
      } else {
        if (isDevice && inverseForwarding) {
          console.warn(`Ignoring local device message for device with inverse forwarding: ${topic}`);
          return;
        } else if (!isDevice && !inverseForwarding) {
          console.warn(`Ignoring local App message for device without direct forwarding: ${topic}`);
          return;
        }
      }

      if (isDevice) {
        // Check if we previously forwarded an App message for this device
        const lastAppMessageTime = this.appMessageHistory.get(deviceKey);
        const currentTime = Date.now();

        if (!lastAppMessageTime || (currentTime - lastAppMessageTime > this.MESSAGE_HISTORY_TIMEOUT)) {
          console.warn(`Skipping device message forwarding to remote for ${deviceKey}: no recent App message was forwarded`);
          return;
        }
        this.appMessageHistory.delete(deviceKey);
      } else {
        // This is an App message, record it in history
        this.appMessageHistory.set(deviceKey, Date.now());

        // Apply rate limiting for messages going from local to Hame
        if (targetClient === this.remoteBroker && this.shouldRateLimit(message, deviceKey)) {
          return;
        }
      }
      
      const replacement = (device as any)[targetKey] as string;
      const newTopic = topic.replace(identifier, replacement);
      const from = targetClient === this.configBroker ? 'remote' : 'local';
      const to = targetClient === this.configBroker ? 'local' : 'remote';
      
      // Add relay instance header to the message to prevent loops
      const publishOptions = {
        properties: {
          userProperties: {
            relayInstanceId: this.INSTANCE_ID
          }
        }
      };
      
      targetClient.publish(newTopic, message, publishOptions);
      console.log(`Forwarded message from ${from} to ${to}: ${topic} -> ${newTopic}`);
    }
  }

  public close(): void {
    this.configBroker.end();
    this.remoteBroker.end();
  }
  
  // Clean up old message history entries periodically
  private cleanupMessageHistory(): void {
    const now = Date.now();
    // Clean up app message history
    for (const [key, timestamp] of this.appMessageHistory.entries()) {
      if (now - timestamp > this.MESSAGE_HISTORY_TIMEOUT * 2) {
        this.appMessageHistory.delete(key);
      }
    }
    
    // Clean up rate-limited message history
    for (const [key, timestamp] of this.rateLimitedMessages.entries()) {
      if (now - timestamp > this.RATE_LIMIT_INTERVAL * 2) {
        this.rateLimitedMessages.delete(key);
      }
    }
    
    // Clean up processed messages cache
    for (const [key, timestamp] of this.processedMessages.entries()) {
      if (now - timestamp > this.MESSAGE_CACHE_TIMEOUT * 2) {
        this.processedMessages.delete(key);
      }
    }
  }
}

async function start() {
  try {
    const configPath = process.env.CONFIG_PATH || './config/config.json';
    const brokersPath = process.env.BROKERS_PATH || './config/brokers.json';
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as MainConfig;
    let brokers: Record<string, BrokerDefinition> = {
      'hame-2024': {
        url: 'mqtt://a40nr6osvmmaw-ats.iot.eu-central-1.amazonaws.com',
        ca: 'ca.crt',
        cert: 'client.crt',
        key: 'client.key',
        topic_prefix: 'hame_energy/',
        client_id_prefix: 'hm_'
      }
    };
    try {
      brokers = JSON.parse(readFileSync(brokersPath, 'utf8')) as Record<string, BrokerDefinition>;
    } catch (err) {
      console.warn(`Could not load brokers config at ${brokersPath}, using default broker`);
    }

    // Initialize devices array if it doesn't exist
    if (!config.devices) {
      config.devices = [];
    }

    // Create a map of user-configured devices for quick lookup and merging
    const userDevicesMap = new Map<string, Device>();
    config.devices.forEach(device => {
      if (device.device_id) {
        userDevicesMap.set(device.device_id, device);
      }
    });
    
    // If username and password are provided, fetch device information from API
    if (config.username && config.password) {
      try {
        console.log('Credentials found in config, attempting to fetch devices from API...');
        const apiDevices = await fetchDevicesFromApi(config.username, config.password);
        
        if (apiDevices.length > 0) {
          console.log(`Retrieved ${apiDevices.length} devices from API`);
          
          // Process each API device
          for (const apiDevice of apiDevices) {
            if (userDevicesMap.has(apiDevice.device_id)) {
              // Device already exists in user config - merge only missing information
              const userDevice = userDevicesMap.get(apiDevice.device_id)!;
              
              // Only update fields if they're missing in user config
              if (!userDevice.type) {
                userDevice.type = apiDevice.type;
              }
              if (!userDevice.name) {
                userDevice.name = apiDevice.name;
              }
              if (!userDevice.mac) {
                userDevice.mac = apiDevice.mac;
              }
            } else {
              // New device from API - add to config
              config.devices.push(apiDevice);
              userDevicesMap.set(apiDevice.device_id, apiDevice);
            }
          }
          
          console.log(`Config now contains ${config.devices.length} devices (${userDevicesMap.size} unique)`);
        }
      } catch (apiError) {
        console.error('Failed to fetch devices from API:', apiError);
        console.warn('Continuing with devices from config file only');
      }
    }

    cleanAndValidate(config);

    const defaultId = config.default_broker_id || 'hame-2024';
    const devicesByBroker: Record<string, Device[]> = {};
    for (const device of config.devices) {
      const brokerId = device.broker_id || defaultId;
      const broker = brokers[brokerId];
      if (!broker) {
        throw new Error(`Broker '${brokerId}' not defined`);
      }
      device.broker_id = brokerId;
      if (!device.remote_id) {
        if (broker.topic_encryption_key) {
          device.remote_id = calculateNewVersionTopicId(Buffer.from(broker.topic_encryption_key, 'hex'), device.mac);
        } else {
          device.remote_id = device.device_id;
        }
      }
      (devicesByBroker[brokerId] ||= []).push(device);
    }

    console.log(`\nConfigured devices: ${config.devices.length} total`);
    console.log('------------------');
    config.devices.forEach((device, index) => {
      console.log(`Device ${index + 1}:`);
      console.log(`  Name: ${device.name || 'Not specified'}`);
      console.log(`  Device ID: ${device.device_id}`);
      console.log(`  MAC: ${device.mac}`);
      console.log(`  Type: ${device.type}`);
      console.log(`  Broker: ${device.broker_id}`);
      console.log(`  Inverse Forwarding: ${device.inverse_forwarding ?? config.inverse_forwarding ?? false}`);
      console.log('------------------');
    });
    console.log('');

    const forwarders: MQTTForwarder[] = [];
    const healthServer = new HealthServer();

    for (const [id, devices] of Object.entries(devicesByBroker)) {
      const fconfig: ForwarderConfig = {
        broker_url: config.broker_url,
        devices,
        inverse_forwarding: config.inverse_forwarding,
        username: config.username,
        password: config.password,
        remote: brokers[id]
      };
      const fw = new MQTTForwarder(fconfig);
      forwarders.push(fw);
      healthServer.addBroker(id, fw.getRemoteBroker());
    }
    if (forwarders.length > 0) {
      healthServer.addBroker('local', forwarders[0].getConfigBroker());
    }

    process.on('SIGINT', () => {
      console.log('Shutting down...');
      forwarders.forEach(f => f.close());
      healthServer.close();
      process.exit(0);
    });
  } catch (error: unknown) {
    console.error('Failed to start MQTT forwarder:', error);
    process.exit(1);
  }
}

// Start the application
start();
