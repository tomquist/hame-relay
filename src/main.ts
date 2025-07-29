import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { calculateNewVersionTopicId } from './encryption.js';
import { HealthServer } from './health.js';
import { logger } from './logger.js';
import { HameApi, DeviceInfo } from './hame_api.js';
import { MQTTForwarder } from './mqtt_forwarder.js';
import { Device, BrokerDefinition, ForwarderConfig, MainConfig, DeviceTypeIdentifier, knownDeviceTypes } from './types.js';

function processBrokerProperties(brokers: Record<string, BrokerDefinition>, brokersConfigPath: string): Record<string, BrokerDefinition> {
  const processedBrokers: Record<string, BrokerDefinition> = {};
  const configDir = dirname(brokersConfigPath);
  for (const [brokerId, broker] of Object.entries(brokers)) {
    const processedBroker: BrokerDefinition = { ...broker };
    for (const prop of Object.keys(processedBroker)) {
      const key = prop as keyof BrokerDefinition;
      const value = processedBroker[key];
      if (typeof value === 'string' && value.startsWith('@')) {
        const filePath = value.substring(1);
        try {
          const absolutePath = join(configDir, filePath);
          (processedBroker as any)[key] = readFileSync(absolutePath, 'utf8').trim();
          logger.debug(`Loaded ${prop} from file: ${absolutePath}`);
        } catch (error) {
          logger.error(error, `Failed to load ${prop} from file ${filePath} for broker ${brokerId}`);
          throw error;
        }
      }
    }
    processedBrokers[brokerId] = processedBroker;
  }
  return processedBrokers;
}

function autoDetermineBroker(device: Device, brokers: Record<string, BrokerDefinition>): string | undefined {
  if (device.version == null) {
    return undefined;
  }
  const regex = /(.*)-[\d\w]+/;
  const match = regex.exec(device.type);
  if (!match) {
    return undefined;
  }
  const baseType = match[1];
  let chosen: string | undefined;
  let highest = -Infinity;
  for (const [id, broker] of Object.entries(brokers)) {
    const minVersions = broker.min_versions;
    if (minVersions && Object.prototype.hasOwnProperty.call(minVersions, baseType)) {
      const min = minVersions[baseType];
      if (device.version >= min && min > highest) {
        chosen = id;
        highest = min;
      }
    }
  }
  return chosen;
}

function shouldUseRemoteTopicId(device: Device, broker: BrokerDefinition): boolean {
  if (device.version == null) {
    return false;
  }
  const regex = /(.*)-[\d\w]+/;
  const match = regex.exec(device.type);
  if (!match) {
    return false;
  }
  const baseType = match[1];
  const mapping = broker.use_remote_topic_id_versions;
  if (!mapping || !Object.prototype.hasOwnProperty.call(mapping, baseType)) {
    return false;
  }
  const versions = mapping[baseType];
  return versions.includes(device.version);
}

function cleanAndValidate(config: { devices: Device[] }): void {
  logger.debug(`Validating ${config.devices.length} devices...`);
  logger.debug(`Found ${config.devices.length} devices in config file`);
  if (config.devices.length === 0) {
    throw new Error('No devices specified in config file');
  }
  const remainingDevices: Device[] = [];
  const errors: string[] = [];
  for (const device of config.devices) {
    logger.debug(`Validating device: ${device.device_id}`);
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
      device.mac = device.mac.trim().replace(/:/g, '').toLowerCase();
      device.type = device.type.trim().toUpperCase() as DeviceTypeIdentifier;
      if (device.device_id.length !== 12 && (device.device_id.length < 22 || device.device_id.length > 24)) {
        throw new Error('Device ID must be between 22 and 24 or exactly 12 characters long');
      }
      if (!/^[0-9A-Fa-f]{12}$/.test(device.mac)) {
        throw new Error('MAC address must be a 12-character hexadecimal string');
      }
      if (device.type && !knownDeviceTypes.includes(device.type)) {
        logger.warn(`Unknown device type: ${device.type}. This device will likely not be forwarded.`);
      }
      remainingDevices.push(device);
    } catch (error) {
      errors.push(`Device ${device.device_id}: ${(error as Error).message}`);
    }
  }
  config.devices = remainingDevices;

  if (errors.length > 0) {
    logger.debug(`Found ${errors.length} errors in devices`);
    if (config.devices.length === 0) {
      throw new Error(`All devices failed validation:\n${errors.join('\n')}`);
    } else {
      logger.warn(`Some devices failed validation:\n${errors.join('\n')}`);
    }
  }
}

async function start() {
  try {
    const configPath = process.env.CONFIG_PATH || './config/config.json';
    const brokersPath = process.env.BROKERS_PATH || './brokers.json';
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as MainConfig;
    let brokers: Record<string, BrokerDefinition>;
    try {
      const rawBrokers = JSON.parse(readFileSync(brokersPath, 'utf8')) as Record<string, BrokerDefinition>;
      brokers = processBrokerProperties(rawBrokers, brokersPath);
    } catch (err) {
      logger.error(err, `Failed to load brokers config at ${brokersPath}`);
      throw err;
    }

    if (!config.devices) {
      config.devices = [];
    }

    const userDevicesMap = new Map<string, Device>();
    config.devices.forEach(device => {
      if (device.device_id) {
        userDevicesMap.set(device.device_id, device);
      }
    });

    if (config.username && config.password) {
      try {
        logger.info('Credentials found in config, attempting to fetch devices from API...');
        const api = new HameApi();
        const apiDevicesRaw: DeviceInfo[] = await api.fetchDevices(config.username, config.password);
        const apiDevices: Device[] = apiDevicesRaw.map(device => {
          let deviceType = device.type as DeviceTypeIdentifier;
          if (!knownDeviceTypes.includes(deviceType)) {
            logger.warn(`Unknown device type from API: ${device.type}. Using as-is.`);
          }
          const v = parseInt(device.version, 10);
          return {
            device_id: device.devid,
            mac: device.mac,
            type: deviceType,
            name: device.name,
            version: isNaN(v) ? undefined : v,
          } as Device;
        });

        if (apiDevices.length > 0) {
          logger.info(`Retrieved ${apiDevices.length} devices from API`);
          for (const apiDevice of apiDevices) {
            if (userDevicesMap.has(apiDevice.device_id)) {
              const userDevice = userDevicesMap.get(apiDevice.device_id)!;
              if (!userDevice.type) {
                userDevice.type = apiDevice.type;
              }
              if (!userDevice.name) {
                userDevice.name = apiDevice.name;
              }
              if (!userDevice.mac) {
                userDevice.mac = apiDevice.mac;
              }
              if (userDevice.version == null) {
                userDevice.version = apiDevice.version;
              }
            } else {
              config.devices.push(apiDevice);
              userDevicesMap.set(apiDevice.device_id, apiDevice);
            }
          }
          logger.info(`Config now contains ${config.devices.length} devices (${userDevicesMap.size} unique)`);
        }
      } catch (apiError) {
        logger.error(apiError, 'Failed to fetch devices from API');
        logger.warn('Continuing with devices from config file only');
      }
    }

    for (const device of config.devices) {
      if (!device.broker_id) {
        const auto = autoDetermineBroker(device, brokers);
        if (auto) {
          device.broker_id = auto;
          logger.info(`Auto-selected broker ${auto} for device ${device.device_id}`);
        }
      }
    }

    cleanAndValidate(config);

    const defaultId = config.default_broker_id || 'hame-2024';
    logger.debug(`Using default broker ID: ${defaultId}`);
    const devicesByBroker: Record<string, Device[]> = {};
    for (const device of config.devices) {
      const brokerId = device.broker_id || defaultId;
      logger.debug(`Using broker ID: ${brokerId} for device ${device.device_id}`);
      const broker = brokers[brokerId];
      if (!broker) {
        throw new Error(`Broker '${brokerId}' not defined`);
      }
      device.broker_id = brokerId;
      if (!device.remote_id) {
        if (broker.topic_encryption_key) {
          logger.debug(`Using topic encryption key for device ${device.device_id}`);
          device.remote_id = calculateNewVersionTopicId(Buffer.from(broker.topic_encryption_key, 'hex'), device.mac);
          logger.debug(`Calculated remote ID: ${device.remote_id} for device ${device.device_id}`);
        } else {
          logger.debug(`No topic encryption key found for device ${device.device_id}, using device ID as remote ID`);
          device.remote_id = device.device_id;
        }
      }
      if (device.use_remote_topic_id == null) {
        const autoRemote = shouldUseRemoteTopicId(device, broker);
        if (autoRemote) {
          device.use_remote_topic_id = true;
          logger.debug(`Enabled remote topic ID for device ${device.device_id}`);
        }
      }
      logger.debug(`Adding device ${device.device_id} to broker ${brokerId}`);
      (devicesByBroker[brokerId] ??= []).push(device);
    }

    logger.info(`\nConfigured devices: ${config.devices.length} total`);
    logger.info('------------------');
    config.devices.forEach((device, index) => {
      logger.info(`Device ${index + 1}:`);
      logger.info(`  Name: ${device.name || 'Not specified'}`);
      logger.info(`  Device ID: ${device.device_id}`);
      logger.info(`  Remote ID: ${device.remote_id}`);
      logger.info(`  MAC: ${device.mac}`);
      logger.info(`  Type: ${device.type}`);
      logger.info(`  Version: ${device.version ?? 'Unknown'}`);
      logger.info(`  Broker: ${device.broker_id}`);
      logger.info(`  Inverse Forwarding: ${device.inverse_forwarding ?? config.inverse_forwarding ?? false}`);
      logger.info(`  Use Remote Topic ID: ${device.use_remote_topic_id ?? false}`);
      logger.info('------------------');
    });
    logger.info('');

    const forwarders: MQTTForwarder[] = [];
    const healthServer = new HealthServer();

    for (const [id, devices] of Object.entries(devicesByBroker)) {
      logger.debug(`Setting up forwarder for broker ${id}`);
      const fconfig: ForwarderConfig = {
        broker_url: config.broker_url,
        devices,
        inverse_forwarding: config.inverse_forwarding,
        username: config.username,
        password: config.password,
        remote: brokers[id],
        broker_id: id,
      };
      const fw = new MQTTForwarder(fconfig);
      forwarders.push(fw);
      healthServer.addBroker(id, fw.getRemoteBroker());
    }
    if (forwarders.length > 0) {
      healthServer.addBroker('local', forwarders[0].getConfigBroker());
    }

    process.on('SIGINT', () => {
      logger.info('Shutting down...');
      forwarders.forEach(f => f.close());
      healthServer.close();
      process.exit(0);
    });
  } catch (error: unknown) {
    logger.error(error, 'Failed to start MQTT forwarder');
    process.exit(1);
  }
}

start();
