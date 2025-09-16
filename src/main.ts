import { readFileSync } from "fs";
import { join, dirname } from "path";
import { calculateNewVersionTopicId } from "./encryption.js";
import { HealthServer } from "./health.js";
import { logger } from "./logger.js";
import { HameApi, DeviceInfo } from "./hame_api.js";
import { MQTTForwarder } from "./mqtt_forwarder.js";
import { CommonHelper } from "./topic.js";
import {
  Device,
  BrokerDefinition,
  ForwarderConfig,
  MainConfig,
  DeviceTypeIdentifier,
  knownDeviceTypes,
} from "./types.js";

function processBrokerProperties(
  brokers: Record<string, BrokerDefinition>,
  brokersConfigPath: string,
): Record<string, BrokerDefinition> {
  const processedBrokers: Record<string, BrokerDefinition> = {};
  const configDir = dirname(brokersConfigPath);
  for (const [brokerId, broker] of Object.entries(brokers)) {
    const processedBroker: BrokerDefinition = { ...broker };
    for (const prop of Object.keys(processedBroker)) {
      const key = prop as keyof BrokerDefinition;
      const value = processedBroker[key];
      if (typeof value === "string" && value.startsWith("@")) {
        const filePath = value.substring(1);
        try {
          const absolutePath = join(configDir, filePath);
          (processedBroker as any)[key] = readFileSync(
            absolutePath,
            "utf8",
          ).trim();
          logger.debug(`Loaded ${prop} from file: ${absolutePath}`);
        } catch (error) {
          logger.error(
            error,
            `Failed to load ${prop} from file ${filePath} for broker ${brokerId}`,
          );
          throw error;
        }
      }
    }
    processedBrokers[brokerId] = processedBroker;
  }
  return processedBrokers;
}

function autoDetermineBroker(
  device: Device,
  brokers: Record<string, BrokerDefinition>,
): string | undefined {
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
    if (
      minVersions &&
      Object.prototype.hasOwnProperty.call(minVersions, baseType)
    ) {
      const min = minVersions[baseType];
      if (device.version >= min && min > highest) {
        chosen = id;
        highest = min;
      }
    }
  }
  return chosen;
}

function shouldUseRemoteTopicId(
  device: Device,
  broker: BrokerDefinition,
): boolean {
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
    throw new Error("No devices specified in config file");
  }
  const remainingDevices: Device[] = [];
  const errors: string[] = [];
  for (const device of config.devices) {
    logger.debug(`Validating device: ${device.device_id}`);
    try {
      if (!device.device_id) {
        throw new Error("Device ID is required");
      }
      if (!device.mac) {
        throw new Error("MAC address is required");
      }
      if (!device.type) {
        throw new Error("Device type is required");
      }
      device.device_id = device.device_id.trim();
      device.mac = device.mac.trim().replace(/:/g, "").toLowerCase();
      device.type = device.type.trim().toUpperCase() as DeviceTypeIdentifier;
      if (
        device.device_id.length !== 12 &&
        (device.device_id.length < 22 || device.device_id.length > 24)
      ) {
        throw new Error(
          "Device ID must be between 22 and 24 or exactly 12 characters long",
        );
      }
      if (!/^[0-9A-Fa-f]{12}$/.test(device.mac)) {
        throw new Error(
          "MAC address must be a 12-character hexadecimal string",
        );
      }
      if (device.type && !knownDeviceTypes.includes(device.type)) {
        logger.warn(
          `Unknown device type: ${device.type}. This device will likely not be forwarded.`,
        );
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
      throw new Error(`All devices failed validation:\n${errors.join("\n")}`);
    } else {
      logger.warn(`Some devices failed validation:\n${errors.join("\n")}`);
    }
  }
}

async function start() {
  try {
    const configPath = process.env.CONFIG_PATH || "./config/config.json";
    const brokersPath = process.env.BROKERS_PATH || "./brokers.json";
    const config = JSON.parse(readFileSync(configPath, "utf8")) as MainConfig;
    let brokers: Record<string, BrokerDefinition>;
    try {
      const rawBrokers = JSON.parse(
        readFileSync(brokersPath, "utf8"),
      ) as Record<string, BrokerDefinition>;
      brokers = processBrokerProperties(rawBrokers, brokersPath);
    } catch (err) {
      logger.error(err, `Failed to load brokers config at ${brokersPath}`);
      throw err;
    }

    // Username and password are now required since we need salt data
    if (!config.username || !config.password) {
      throw new Error(
        "Username and password are required to fetch device information and salt data from the Hame API",
      );
    }

    logger.info("Fetching devices from Hame API...");
    try {
      const api = new HameApi();
      const apiDevicesRaw: DeviceInfo[] = await api.fetchDevices(
        config.username,
        config.password,
      );

      if (apiDevicesRaw.length === 0) {
        throw new Error(
          "No devices found in your Hame account. Please check your credentials and ensure you have devices registered.",
        );
      }

      const apiDevices: Device[] = apiDevicesRaw.map((device) => {
        let deviceType = device.type as DeviceTypeIdentifier;
        if (!knownDeviceTypes.includes(deviceType)) {
          logger.warn(
            `Unknown device type from API: ${device.type}. Using as-is.`,
          );
        }
        const v = parseInt(device.version, 10);
        return {
          device_id: device.devid,
          mac: device.mac,
          type: deviceType,
          name: device.name,
          version: isNaN(v) ? undefined : v,
          salt: device.salt,
        } as Device;
      });

      config.devices = apiDevices;
      logger.info(
        `Successfully retrieved ${apiDevices.length} devices from API`,
      );
    } catch (apiError) {
      logger.error(apiError, "Failed to fetch devices from Hame API");
      throw new Error(
        `Unable to fetch device information from Hame API: ${apiError instanceof Error ? apiError.message : String(apiError)}`,
      );
    }

    // Ensure TypeScript knows devices is now defined
    const devicesConfig = config as MainConfig & { devices: Device[] };

    // Apply selective inverse forwarding logic
    const selectiveInverseDeviceIds = new Set<string>();
    if (config.inverse_forwarding_device_ids) {
      const deviceIds = config.inverse_forwarding_device_ids
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
      deviceIds.forEach((id) => selectiveInverseDeviceIds.add(id));
      logger.info(
        `Selective inverse forwarding enabled for device IDs: ${Array.from(selectiveInverseDeviceIds).join(", ")}`,
      );
    }

    for (const device of devicesConfig.devices) {
      // Set inverse forwarding based on device type and configuration
      if (device.inverse_forwarding === undefined) {
        const deviceType = device.type.toUpperCase();
        const selectableTypes = ["HMA", "HMF", "HMK", "HMJ"];

        if (selectableTypes.some((type) => deviceType.startsWith(type))) {
          // For selectable device types, check if device ID is in the list
          device.inverse_forwarding = selectiveInverseDeviceIds.has(
            device.device_id,
          );
          logger.debug(
            `Device ${device.device_id} (${device.type}): inverse_forwarding = ${device.inverse_forwarding} (selective)`,
          );
        } else {
          // For all other device types, always use inverse forwarding
          device.inverse_forwarding = true;
          logger.debug(
            `Device ${device.device_id} (${device.type}): inverse_forwarding = true (automatic)`,
          );
        }
      } else {
        logger.debug(
          `Device ${device.device_id} (${device.type}): inverse_forwarding = ${device.inverse_forwarding} (explicit)`,
        );
      }
    }

    // Apply global inverse_forwarding flip if enabled
    if (config.inverse_forwarding === true) {
      logger.info(
        "Global inverse_forwarding flag is true - flipping all device settings",
      );
      for (const device of devicesConfig.devices) {
        const originalValue = device.inverse_forwarding;
        device.inverse_forwarding = !device.inverse_forwarding;
        logger.debug(
          `Device ${device.device_id} (${device.type}): inverse_forwarding flipped from ${originalValue} to ${device.inverse_forwarding} (global flip)`,
        );
      }
    }

    for (const device of devicesConfig.devices) {
      if (!device.broker_id) {
        const auto = autoDetermineBroker(device, brokers);
        if (auto) {
          device.broker_id = auto;
          logger.info(
            `Auto-selected broker ${auto} for device ${device.device_id}`,
          );
        }
      }
    }

    cleanAndValidate(devicesConfig);

    const defaultId = config.default_broker_id || "hame-2024";
    const devicesByBroker: Record<string, Device[]> = {};
    for (const device of devicesConfig.devices) {
      const brokerId = device.broker_id || defaultId;
      logger.debug(
        `Using broker ID: ${brokerId} for device ${device.device_id}`,
      );
      const broker = brokers[brokerId];
      if (!broker) {
        throw new Error(`Broker '${brokerId}' not defined`);
      }
      device.broker_id = brokerId;
      if (!device.remote_id) {
        logger.debug(
          CommonHelper.isSupportVid(device.type, device.version!.toString()),
        );
        // Check if device supports the new CommonHelper.cq method
        if (
          device.salt &&
          device.version &&
          CommonHelper.isSupportVid(device.type, device.version.toString())
        ) {
          logger.debug(
            `Device ${device.device_id} supports CommonHelper.cq method, using salt-based calculation`,
          );
          const firstSalt = CommonHelper.extractFirstSalt(device.salt);
          if (firstSalt) {
            device.remote_id = CommonHelper.cq(
              firstSalt,
              device.mac,
              device.type,
            );
            logger.debug(
              `Calculated remote ID using CommonHelper.cq: ${device.remote_id} for device ${device.device_id}`,
            );
          } else {
            logger.warn(
              `Failed to extract salt for device ${device.device_id}, falling back to alternative method`,
            );
            device.remote_id = device.device_id;
          }
        } else if (broker.topic_encryption_key) {
          logger.debug(
            `Using topic encryption key for device ${device.device_id}`,
          );
          device.remote_id = calculateNewVersionTopicId(
            Buffer.from(broker.topic_encryption_key, "hex"),
            device.mac,
          );
          logger.debug(
            `Calculated remote ID: ${device.remote_id} for device ${device.device_id}`,
          );
        } else {
          logger.debug(
            `No topic encryption key found for device ${device.device_id}, using device ID as remote ID`,
          );
          device.remote_id = device.device_id;
        }
      }
      if (device.use_remote_topic_id == null) {
        const autoRemote = shouldUseRemoteTopicId(device, broker);
        if (autoRemote) {
          device.use_remote_topic_id = true;
          logger.debug(
            `Enabled remote topic ID for device ${device.device_id}`,
          );
        }
      }
      logger.debug(`Adding device ${device.device_id} to broker ${brokerId}`);
      (devicesByBroker[brokerId] ??= []).push(device);
    }

    logger.info(`\nConfigured devices: ${devicesConfig.devices.length} total`);
    logger.info("------------------");
    devicesConfig.devices.forEach((device, index) => {
      logger.info(`Device ${index + 1}:`);
      logger.info(`  Name: ${device.name || "Not specified"}`);
      logger.info(`  Device ID: ${device.device_id}`);
      logger.info(`  Remote ID: ${device.remote_id}`);
      logger.info(`  MAC: ${device.mac}`);
      logger.info(`  Type: ${device.type}`);
      logger.info(`  Version: ${device.version ?? "Unknown"}`);
      logger.info(`  Broker: ${device.broker_id}`);
      logger.info(
        `  Inverse Forwarding: ${device.inverse_forwarding ?? config.inverse_forwarding ?? false}`,
      );
      logger.info(
        `  Use Remote Topic ID: ${device.use_remote_topic_id ?? false}`,
      );
      logger.info("------------------");
    });
    logger.info("");

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
      healthServer.addBroker("local", forwarders[0].getConfigBroker());
    }

    process.on("SIGINT", () => {
      logger.info("Shutting down...");
      forwarders.forEach((f) => f.close());
      healthServer.close();
      process.exit(0);
    });
  } catch (error: unknown) {
    logger.error(error, "Failed to start MQTT forwarder");
    process.exit(1);
  }
}

start();
