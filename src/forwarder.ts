import * as mqtt from 'mqtt';
import { readFileSync } from 'fs';
import { join } from 'path';

// Types
interface Device {
  device_id: string;
  mac: string;
}

interface Config {
  broker_url: string;
  devices: Device[];
  inverse_forwarding?: boolean;
}

class MQTTForwarder {
  private configBroker!: mqtt.MqttClient;
  private hameBroker!: mqtt.MqttClient;
  private devices: Map<string, string>; // Maps device_id to mac and vice versa
  private config: Config;
  private readonly RECONNECT_DELAY = 2000;

  constructor(configPath: string) {
    // Load and parse config file
    this.config = JSON.parse(readFileSync(configPath, 'utf8'));
    
    // Initialize device mappings
    this.devices = new Map();
    this.config.devices.forEach(device => {
      this.devices.set(device.device_id, device.mac);
      this.devices.set(device.mac, device.device_id);
    });

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
      console.log('Successfully reconnected to config broker');
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
      console.log('Successfully reconnected to Hame broker');
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
    // Subscribe to topics based on inverse_forwarding setting
    const topicPattern = this.config.inverse_forwarding ? 
      'hame_energy/+/App/+/ctrl' : 
      'hame_energy/+/device/+/ctrl';

    this.configBroker.subscribe(topicPattern, (err: Error | null) => {
      if (err) {
        console.error('Error subscribing to config broker:', err);
        return;
      }
      console.log('Subscribed to config broker topics');
    });

    // Handle messages from config broker
    this.configBroker.on('message', (topic: string, message: Buffer) => {
      const pattern = this.config.inverse_forwarding ? 
        /hame_energy\/.*\/App\/(.*)\/ctrl/ :
        /hame_energy\/.*\/device\/(.*)\/ctrl/;

      const matches = topic.match(pattern);
      if (matches) {
        const identifier = matches[1];
        const mappedId = this.devices.get(identifier);
        
        if (mappedId) {
          const newTopic = topic.replace(identifier, mappedId);
          this.hameBroker.publish(newTopic, message);
          console.log(`Forwarded message from config to Hame: ${topic} -> ${newTopic}`);
        } else {
          console.warn(`Unknown identifier received: ${identifier}`);
        }
      }
    });
  }

  private setupHameSubscriptions(): void {
    // Subscribe to topics based on inverse_forwarding setting
    this.config.devices.forEach(device => {
      const identifier = this.config.inverse_forwarding ? device.mac : device.device_id;
      const topicPattern = this.config.inverse_forwarding ?
        `hame_energy/+/device/${identifier}/ctrl` :
        `hame_energy/+/App/${identifier}/ctrl`;

      this.hameBroker.subscribe(topicPattern, (err: Error | null) => {
        if (err) {
          console.error(`Error subscribing to Hame broker for device ${identifier}:`, err);
          return;
        }
        console.log(`Subscribed to Hame broker topic: ${topicPattern}`);
      });
    });

    // Handle messages from Hame broker
    this.hameBroker.on('message', (topic: string, message: Buffer) => {
      const pattern = this.config.inverse_forwarding ?
        /hame_energy\/.*\/device\/(.*)\/ctrl/ :
        /hame_energy\/.*\/App\/(.*)\/ctrl/;

      const matches = topic.match(pattern);
      if (matches) {
        const identifier = matches[1];
        const mappedId = this.devices.get(identifier);
        
        if (mappedId) {
          const newTopic = topic.replace(identifier, mappedId);
          this.configBroker.publish(newTopic, message);
          console.log(`Forwarded message from Hame to config: ${topic} -> ${newTopic}`);
        } else {
          console.warn(`Unknown identifier received: ${identifier}`);
        }
      }
    });
  }

  public close(): void {
    this.configBroker.end();
    this.hameBroker.end();
  }
}

// Entry point
const configPath = process.env.CONFIG_PATH || './config/config.json';

try {
  const forwarder = new MQTTForwarder(configPath);

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