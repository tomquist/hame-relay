import { connect, type IPublishPacket, type MqttClient } from "mqtt";
import { createHash } from "crypto";
import { logger } from "./logger.js";
import {
  MAX_SUBSCRIPTIONS_PER_CONNECTION,
  MAX_TOPICS_PER_SUBSCRIBE,
  splitIntoConnections,
} from "./subscriptions.js";
import { type Device, type ForwarderConfig } from "./types.js";

/**
 * One connection to the remote broker together with the devices it is
 * responsible for. The remote broker caps how many subscriptions a single
 * connection may hold, so the devices of a broker are spread over as many
 * connections as they need (see ./subscriptions.ts).
 */
interface RemoteConnection {
  client: MqttClient;
  devices: Device[];
  label: string;
}

export class MQTTForwarder {
  private configBroker!: MqttClient;
  private remoteConnections: RemoteConnection[] = [];
  private remoteClientByDevice = new Map<Device, MqttClient>();
  private readonly logger: typeof logger;
  private readonly MESSAGE_HISTORY_TIMEOUT = 1000; // 1 second timeout
  private readonly MESSAGE_CACHE_TIMEOUT = 1000; // 1 second timeout for message loop prevention
  private readonly INSTANCE_ID = createHash("md5")
    .update(`${Date.now()}-${Math.random()}`)
    .digest("hex")
    .slice(0, 8); // Unique ID for this instance
  private appMessageHistory = new Map<string, number>(); // Store when App messages were forwarded
  private processedMessages = new Map<string, number>(); // Store message hashes to prevent loops

  constructor(private readonly config: ForwarderConfig) {
    this.logger = logger.child(
      {},
      {
        msgPrefix: `[${config.broker_id}] `,
      },
    );
    this.initializeBrokers();
  }

  /**
   * The remote broker connections of this forwarder, in the order the devices
   * were split over them. There is more than one only when the device count
   * exceeds what a single connection may subscribe to.
   */
  public getRemoteBrokers(): Array<{ id: string; client: MqttClient }> {
    return this.remoteConnections.map((connection) => ({
      id: connection.label,
      client: connection.client,
    }));
  }

  public getConfigBroker(): MqttClient {
    return this.configBroker;
  }

  private loadCertificates(): { ca: Buffer; cert: Buffer; key: Buffer } {
    try {
      return {
        ca: Buffer.from(this.config.remote.ca, "utf8"),
        cert: Buffer.from(this.config.remote.cert, "utf8"),
        key: Buffer.from(this.config.remote.key, "utf8"),
      };
    } catch (error: unknown) {
      this.logger.error(error, "Failed to load certificates");
      throw error;
    }
  }

  private initializeBrokers(): void {
    const configOptions = {
      keepalive: 30,
      clientId: this.generateClientId("config_"),
    };
    this.configBroker = connect(this.config.broker_url, configOptions);

    const certs = this.loadCertificates();
    const deviceGroups = splitIntoConnections(this.config.devices);
    if (deviceGroups.length > 1) {
      this.logger.info(
        `Splitting ${this.config.devices.length} devices over ${deviceGroups.length} remote broker connections; a single connection can subscribe to at most ${MAX_SUBSCRIPTIONS_PER_CONNECTION} devices`,
      );
    }
    this.remoteConnections = deviceGroups.map((devices, index) => {
      const remoteOptions = {
        ...certs,
        protocol: "mqtts" as const,
        keepalive: 30,
        clientId: this.generateClientId(
          this.config.remote.client_id_prefix || "hm_",
        ),
        // The remote broker closes the connection instead of answering a
        // SUBSCRIBE that carries more topics than it allows per packet. This
        // splits every SUBSCRIBE, including the automatic one after a
        // reconnect, into packets it accepts.
        subscribeBatchSize: MAX_TOPICS_PER_SUBSCRIBE,
      };
      return {
        client: connect(this.config.remote.url, remoteOptions),
        devices,
        label:
          deviceGroups.length > 1
            ? `${this.config.broker_id}#${index + 1}`
            : this.config.broker_id,
      };
    });
    for (const connection of this.remoteConnections) {
      for (const device of connection.devices) {
        this.remoteClientByDevice.set(device, connection.client);
      }
    }

    this.setupBrokerEventHandlers();
  }

  private generateClientId(prefix: string): string {
    let randomClientId = "";
    for (let i = 0; i < 24; i++) {
      randomClientId += Math.floor(Math.random() * 16).toString(16);
    }
    return `${prefix}${randomClientId}`;
  }

  private setupBrokerEventHandlers(): void {
    // Config broker event handlers
    this.configBroker.on("connect", () => {
      this.logger.info("Connected to config broker");
    });
    this.setupConfigSubscriptions();

    // Set up error handlers
    this.configBroker.on("error", (error: Error) => {
      this.logger.error(error, "Config broker error");
    });

    this.configBroker.on("disconnect", () => {
      this.logger.warn("Config broker disconnected");
    });

    this.configBroker.on("offline", () => {
      this.logger.warn("Config broker went offline");
    });

    // Remote broker event handlers
    for (const connection of this.remoteConnections) {
      // Only name the individual connection when there is more than one.
      const which =
        this.remoteConnections.length > 1
          ? ` connection ${connection.label}`
          : "";
      connection.client.on("connect", () => {
        this.logger.info(`Connected to remote broker${which}`);
      });
      this.setupRemoteSubscriptions(connection);

      connection.client.on("error", (error: Error) => {
        this.logger.error(error, `Remote broker${which} error`);
      });

      connection.client.on("disconnect", () => {
        this.logger.warn(`Remote broker${which} disconnected`);
      });

      connection.client.on("offline", () => {
        this.logger.warn(`Remote broker${which} went offline`);
      });
    }
  }

  private setupConfigSubscriptions(): void {
    this.setupSubscriptions(this.configBroker, this.config.devices);
  }

  private setupRemoteSubscriptions(connection: RemoteConnection): void {
    this.setupSubscriptions(connection.client, connection.devices);
  }

  /**
   * Determines the appropriate topic prefix and identifier for a device on a specific broker
   *
   * This centralized method handles all the logic for determining which topic structure to use:
   *
   * For LOCAL broker (configBroker):
   *   - If use_remote_topic_id=true: Uses remote structure (topic_prefix + remote_id)
   *   - If use_remote_topic_id=false: Uses local structure (local_topic_prefix + mac)
   *
   * For REMOTE broker (any of the remote connections):
   *   - Always uses remote structure (topic_prefix + remote_id)
   *
   * @param device The device configuration
   * @param broker The MQTT broker (configBroker for local, a remote connection otherwise)
   * @returns Object containing prefix and identifier to use for this device on this broker
   */
  private getTopicStructureForDevice(
    device: Device,
    broker: MqttClient,
  ): { prefix: string; identifier: string } {
    if (broker === this.configBroker) {
      // Local broker
      if (device.use_remote_topic_id) {
        // Use remote topic structure on local broker
        return {
          prefix: this.config.remote.topic_prefix || "hame_energy/",
          identifier: device.remote_id!,
        };
      }
      // Use local topic structure
      return {
        prefix:
          this.config.remote.local_topic_prefix ||
          this.config.remote.topic_prefix ||
          "hame_energy/",
        identifier: device.mac,
      };
    }
    // Remote broker - always use remote structure
    return {
      prefix: this.config.remote.topic_prefix || "hame_energy/",
      identifier: device.remote_id!,
    };
  }

  private setupSubscriptions(broker: MqttClient, devices: Device[]): void {
    const brokerName = broker === this.configBroker ? "local" : "remote";

    const topics = devices.map((device) => {
      // Get the appropriate topic structure for this device on this broker
      const { prefix, identifier } = this.getTopicStructureForDevice(
        device,
        broker,
      );

      let inverseForwarding =
        device.inverse_forwarding ?? this.config.inverse_forwarding;
      if (broker === this.configBroker) {
        inverseForwarding = !inverseForwarding;
      }

      return inverseForwarding
        ? `${prefix}${device.type}/device/${identifier}/ctrl`
        : `${prefix}${device.type}/App/${identifier}/ctrl`;
    });

    this.logger.debug(
      `Subscribing to ${brokerName} broker topics:\n${topics.join("\n")}`,
    );
    broker.subscribe(topics, (err: Error | null) => {
      if (err) {
        this.logger.error(
          err,
          `Error subscribing to ${brokerName} broker for device`,
        );
        return;
      }
      this.logger.info(`Subscribed to ${brokerName} broker topics`);
    });

    broker.on(
      "message",
      (topic: string, message: Buffer, packet: IPublishPacket) => {
        this.forwardMessage(topic, message, broker, packet);
      },
    );
  }

  /**
   * Checks if a message has been processed by this or another relay instance
   * @param packet The MQTT packet containing message and properties
   * @returns true if the message has been processed and should be skipped, false otherwise
   */
  private isMessageProcessed(packet: IPublishPacket): boolean {
    try {
      // Check if this message has a relay header
      if (packet.properties && packet.properties.userProperties) {
        const userProps = packet.properties.userProperties;

        // Check if this message has our relay instance ID or another relay's
        if (typeof userProps.relayInstanceId === "string") {
          // Message has already been processed by a relay
          if (userProps.relayInstanceId === this.INSTANCE_ID) {
            // This is our own message coming back - definitely skip it
            this.logger.debug("Skipping message from our own relay instance");
            return true;
          }
          // Message from another relay instance - also skip it to prevent loops
          this.logger.debug(
            `Skipping message from relay instance: ${userProps.relayInstanceId.slice(0, 8)}`,
          );
          return true;
        }
      }
      return false;
    } catch (error) {
      this.logger.error(error, "Error checking if message is processed");
      return false; // On error, don't skip the message
    }
  }

  /**
   * The remote connection that subscribes to, and publishes for, a device.
   */
  private remoteClientForDevice(device: Device): MqttClient {
    // Every device belongs to exactly one connection; fall back to the first
    // one so an unexpected device still reaches the broker.
    return (
      this.remoteClientByDevice.get(device) ?? this.remoteConnections[0].client
    );
  }

  private forwardMessage(
    topic: string,
    message: Buffer,
    sourceClient: MqttClient,
    packet?: IPublishPacket,
  ): void {
    // Check if this is a looped message that should be skipped
    if (packet && this.isMessageProcessed(packet)) {
      return;
    }

    const fromLocal = sourceClient === this.configBroker;
    // Only the devices of the source connection can match a remote message;
    // a local message can match any device.
    const candidateDevices = fromLocal
      ? this.config.devices
      : (this.remoteConnections.find(
          (connection) => connection.client === sourceClient,
        )?.devices ?? this.config.devices);

    // Try to match the topic and find the corresponding device
    let matchedDevice: Device | undefined;
    let topicType = "";
    let isDevice = false;

    // Try to match against all possible topic patterns for all devices
    for (const device of candidateDevices) {
      // Get the expected topic structure for this device on the source broker
      const { prefix: expectedPrefix, identifier: expectedIdentifier } =
        this.getTopicStructureForDevice(device, sourceClient);

      // Try to match this device's topic pattern. No `u` flag: the prefix is
      // escaped character by character, which produces escapes that are only
      // valid in non-unicode mode.
      // oxlint-disable-next-line eslint/require-unicode-regexp
      const pattern = new RegExp(
        `^${expectedPrefix.replaceAll(/[-/\\^$*+?.()|[\]{}]/gu, String.raw`\$&`)}([^/]+)/(device|App)/(.*)/ctrl$`,
      );
      const matches = topic.match(pattern);

      if (
        matches &&
        matches[1] === device.type &&
        matches[3] === expectedIdentifier
      ) {
        matchedDevice = device;
        topicType = matches[1];
        isDevice = matches[2] === "device";
        break;
      }
    }

    if (!matchedDevice) {
      this.logger.warn(`No matching device found for topic: ${topic}`);
      return;
    }
    this.logger.debug(`Matched device: ${matchedDevice?.device_id}`);

    // A local message goes out over the remote connection that owns this
    // device; a remote message goes to the single local connection.
    const targetClient = fromLocal
      ? this.remoteClientForDevice(matchedDevice)
      : this.configBroker;

    const inverseForwarding =
      matchedDevice.inverse_forwarding ?? this.config.inverse_forwarding;
    this.logger.debug(`Inverse forwarding: ${inverseForwarding}`);

    // Create a unique key for this device
    const deviceKey = `${matchedDevice.type}:${matchedDevice.device_id}:${matchedDevice.mac}`;

    if (targetClient === this.configBroker) {
      if (isDevice && !inverseForwarding) {
        this.logger.warn(
          `Ignoring remote device message for device without inverse forwarding: ${topic}`,
        );
        return;
      } else if (!isDevice && inverseForwarding) {
        this.logger.warn(
          `Ignoring remote App message for device with direct forwarding: ${topic}`,
        );
        return;
      }
    } else if (isDevice && inverseForwarding) {
      this.logger.warn(
        `Ignoring local device message for device with inverse forwarding: ${topic}`,
      );
      return;
    } else if (!isDevice && !inverseForwarding) {
      this.logger.warn(
        `Ignoring local App message for device without direct forwarding: ${topic}`,
      );
      return;
    }

    if (isDevice) {
      // Check if we previously forwarded an App message for this device
      const lastAppMessageTime = this.appMessageHistory.get(deviceKey);
      const currentTime = Date.now();

      if (
        !lastAppMessageTime ||
        currentTime - lastAppMessageTime > this.MESSAGE_HISTORY_TIMEOUT
      ) {
        this.logger.debug(
          `Skipping device message forwarding to remote for ${deviceKey}: no recent App message was forwarded`,
        );
        return;
      }
      this.appMessageHistory.delete(deviceKey);
    } else {
      // This is an App message, record it in history
      this.appMessageHistory.set(deviceKey, Date.now());
    }

    // Get the target topic structure for this device on the target broker
    const { prefix: targetPrefix, identifier: targetIdentifier } =
      this.getTopicStructureForDevice(matchedDevice, targetClient);
    this.logger.debug(`Target prefix: ${targetPrefix}`);
    this.logger.debug(`Target identifier: ${targetIdentifier}`);

    // Build the new topic
    const deviceOrApp = isDevice ? "device" : "App";
    const newTopic = `${targetPrefix}${topicType}/${deviceOrApp}/${targetIdentifier}/ctrl`;
    this.logger.debug(`New topic: ${newTopic}`);
    const from = targetClient === this.configBroker ? "remote" : "local";
    const to = targetClient === this.configBroker ? "local" : "remote";
    this.logger.debug(`From: ${from}`);
    this.logger.debug(`To: ${to}`);

    // Add relay instance header to the message to prevent loops
    const publishOptions = {
      properties: {
        userProperties: {
          relayInstanceId: this.INSTANCE_ID,
        },
      },
    };

    targetClient.publish(newTopic, message, publishOptions);
    this.logger.info(
      `Forwarded message from ${from} to ${to}: ${topic} -> ${newTopic}`,
    );
  }

  public close(): void {
    this.configBroker.end();
    for (const connection of this.remoteConnections) {
      connection.client.end();
    }
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

    // Clean up processed messages cache
    for (const [key, timestamp] of this.processedMessages.entries()) {
      if (now - timestamp > this.MESSAGE_CACHE_TIMEOUT * 2) {
        this.processedMessages.delete(key);
      }
    }
  }
}
