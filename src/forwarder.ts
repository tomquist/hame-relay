import * as mqtt from 'mqtt';
import {MqttClient} from 'mqtt';
import {readFileSync} from 'fs';
import {join} from 'path';

const deviceGenerations = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] as const;
type DeviceGen = typeof deviceGenerations[number];
const deviceTypes = ["A", "B", "D", "E", "F", "G", "J", "K"] as const;
type DeviceType = typeof deviceTypes[number];
type DeviceTypeIdentifier = `HM${DeviceType}-${DeviceGen}`;
const knownDeviceTypes: DeviceTypeIdentifier[] = deviceGenerations.flatMap(gen => deviceTypes.map(type => `HM${type}-${gen}` satisfies DeviceTypeIdentifier));

interface Device {
  device_id: string;
  mac: string;
  type: DeviceTypeIdentifier;
  inverse_forwarding?: boolean;
}

interface Config {
  broker_url: string;
  devices: Device[];
  inverse_forwarding?: boolean;
}

function cleanAndValidate(config: Config): void {
  if (config.devices.length === 0) {
    throw new Error('No devices specified in config file');
  }
  for (const device of config.devices) {
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
    if (device.device_id.length < 22 || device.device_id.length > 24) {
      throw new Error('Device ID must be between 22 and 24 characters long');
    }
    if (!/^[0-9A-Fa-f]{12}$/.test(device.mac)) {
      throw new Error('MAC address must be a 12-character hexadecimal string');
    }
    if (device.type && !knownDeviceTypes.includes(device.type)) {
      console.warn(`Unknown device type: ${device.type}. This device will likely not be forwarded.`);
    }
  }
}

class MQTTForwarder {
  private configBroker!: mqtt.MqttClient;
  private hameBroker!: mqtt.MqttClient;
  private readonly RECONNECT_DELAY = 2000;

  constructor(private readonly config: Config) {
    // Initialize brokers
    this.initializeBrokers();
  }

  private loadCertificates(): { ca: Buffer; cert: Buffer; key: Buffer } {
    try {
      return {
        ca: readFileSync(join(process.env.CERT_PATH || './certs', 'ca.crt')),
        cert: readFileSync(join(process.env.CERT_PATH || './certs', 'client.crt')),
        key: readFileSync(join(process.env.CERT_PATH || './certs', 'client.key'))
      };
    } catch (error: unknown) {
      console.error('Failed to load certificates:', error);
      throw error;
    }
  }

  private initializeBrokers(): void {
    const options = {
      keepalive: 30,
      reconnectPeriod: 1000,
      connectTimeout: 30000,
    };
    this.configBroker = mqtt.connect(this.config.broker_url, options);

    // Load certificates and connect to Hame broker
    const certs = this.loadCertificates();
    this.hameBroker = mqtt.connect('mqtt://a40nr6osvmmaw-ats.iot.eu-central-1.amazonaws.com', {
      ...certs,
      protocol: 'mqtts',
      ...options,
    });

    this.setupBrokerEventHandlers();
  }

  private setupBrokerEventHandlers(): void {
    // Config broker event handlers
    this.configBroker.on('connect', () => {
      console.log('Connected to config broker');
      this.setupConfigSubscriptions();
    });

    // Set up error handlers
    this.configBroker.on('error', (error: Error) => {
      console.error('Config broker error:', error);
    });

    this.configBroker.on('disconnect', () => {
      console.warn('Config broker disconnected');
    });

    this.configBroker.on('offline', () => {
      console.warn('Config broker went offline');
      this.handleReconnect('config');
    });

    // Hame broker event handlers
    this.hameBroker.on('connect', () => {
      console.log('Connected to Hame broker');
      this.setupHameSubscriptions();
    });

    this.hameBroker.on('error', (error: Error) => {
      console.error('Hame broker error:', error);
    });

    this.hameBroker.on('disconnect', () => {
      console.warn('Hame broker disconnected');
    });

    this.hameBroker.on('offline', () => {
      console.warn('Hame broker went offline');
      this.handleReconnect('hame');
    });

    // Set up ping monitoring for both brokers
    this.monitorConnections();
  }

  private handleReconnect(broker: 'config' | 'hame'): void {
    const brokerClient = broker === 'config' ? this.configBroker : this.hameBroker;
    console.log(`Attempting to reconnect ${broker} broker...`);
    
    setTimeout(() => {
      if (!brokerClient.connected) {
        brokerClient.reconnect();
        // Schedule another reconnection attempt if this one fails
        this.handleReconnect(broker);
      }
    }, this.RECONNECT_DELAY);
  }

  private monitorConnections(): void {
    // Periodically check connection status and force reconnect if needed
    setInterval(() => {
      if (!this.configBroker.connected) {
        console.warn('Config broker connection lost, attempting to reconnect...');
        this.handleReconnect('config');
      }
      if (!this.hameBroker.connected) {
        console.warn('Hame broker connection lost, attempting to reconnect...');
        this.handleReconnect('hame');
      }
    }, 30000); // Check every 30 seconds
  }

  private setupConfigSubscriptions(): void {
    this.setupSubscriptions(this.configBroker);
  }

  private setupHameSubscriptions(): void {
    this.setupSubscriptions(this.hameBroker);
  }

  private setupSubscriptions(broker: MqttClient): void {
    const key = broker === this.configBroker ? 'mac' : 'device_id';
    const brokerName = broker === this.configBroker ? 'local' : 'Hame';
    const topics = this.config.devices.map(device => {
      const {[key]: identifier, type: type} = device;
      let inverseForwarding = device.inverse_forwarding ?? this.config.inverse_forwarding;
      if (broker === this.configBroker) {
        inverseForwarding = !inverseForwarding;
      }
      return inverseForwarding ?
          `hame_energy/${type}/device/${identifier}/ctrl` :
          `hame_energy/${type}/App/${identifier}/ctrl`
    });
    console.log(`Subscribing to ${brokerName} broker topics:\n${topics.join("\n")}`);
    broker.subscribe(topics, (err: Error | null) => {
      if (err) {
        console.error(`Error subscribing to ${brokerName} broker for device:`, err);
        return;
      }
      console.log(`Subscribed to ${brokerName} broker topics`);
    });

    broker.on('message', (topic: string, message: Buffer) => {
      this.forwardMessage(topic, message, broker === this.configBroker ? this.hameBroker : this.configBroker);
    });
  }

  private forwardMessage(topic: string, message: Buffer<ArrayBufferLike>, targetClient: MqttClient): void {
    const pattern = /hame_energy\/([^\/]+)\/(device|App)\/(.*)\/ctrl/;

    const matches = topic.match(pattern);
    if (matches) {
      const type = matches[1];
      const isDevice = matches[2] === 'device';
      const identifier = matches[3];
      const sourceKey = targetClient === this.configBroker ? 'device_id' : 'mac';
      const targetKey = targetClient === this.configBroker ? 'mac' : 'device_id';
      const device = this.config.devices.find(device => device[sourceKey] === identifier && device.type === type);
      if (!device) {
        console.warn(`Unknown device received (${type}): ${identifier}`);
        return;
      }
      const inverseForwarding = device.inverse_forwarding ?? this.config.inverse_forwarding;
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
      const newTopic = topic.replace(identifier, device[targetKey]);
      const from = targetClient === this.configBroker ? 'Hame' : 'local';
      const to = targetClient === this.configBroker ? 'local' : 'Hame';
      targetClient.publish(newTopic, message);
      console.log(`Forwarded message from ${from} to ${to}: ${topic} -> ${newTopic}`);
    }
  }

  public close(): void {
    this.configBroker.end();
    this.hameBroker.end();
  }
}

try {
  // Entry point
  const configPath = process.env.CONFIG_PATH || './config/config.json';
  // Load and parse config file
  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  cleanAndValidate(config);

  const forwarder = new MQTTForwarder(config);

  // Handle application shutdown
  process.on('SIGINT', () => {
    console.log('Shutting down...');
    forwarder.close();
    process.exit(0);
  });
} catch (error: unknown) {
  console.error('Failed to start MQTT forwarder:', error);
  process.exit(1);
}
