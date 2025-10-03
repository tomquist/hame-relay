import * as mqtt from "mqtt";
import { MqttClient } from "mqtt";
import { createHash } from "crypto";
import { logger } from "./logger.js";
import { Device, ForwarderConfig } from "./types.js";

export class MQTTForwarder {
  private configBroker!: mqtt.MqttClient;
  private remoteBroker!: mqtt.MqttClient;
  private readonly logger: typeof logger;
  private readonly MESSAGE_HISTORY_TIMEOUT = 1000; // 1 second timeout
  private readonly RATE_LIMIT_INTERVAL = 59900; // Rate limit interval in milliseconds
  private readonly MESSAGE_CACHE_TIMEOUT = 1000; // 1 second timeout for message loop prevention
  private readonly INSTANCE_ID = createHash("md5")
    .update(`${Date.now()}-${Math.random()}`)
    .digest("hex")
    .substring(0, 8); // Unique ID for this instance
  private appMessageHistory: Map<string, number> = new Map(); // Store when App messages were forwarded
  private rateLimitedMessages: Map<string, number> = new Map(); // Store when rate-limited messages were last forwarded
  private processedMessages: Map<string, number> = new Map(); // Store message hashes to prevent loops
  private readonly RATE_LIMITED_CODES = [1, 13, 15, 16, 21, 26, 28, 30]; // Message codes to rate-limit (as numbers)

  constructor(private readonly config: ForwarderConfig) {
    this.logger = logger.child(
      {},
      {
        msgPrefix: `[${config.broker_id}] `,
      },
    );
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

      if (
        lastSentTime &&
        currentTime - lastSentTime < this.RATE_LIMIT_INTERVAL
      ) {
        const remainingTime =
          this.RATE_LIMIT_INTERVAL - (currentTime - lastSentTime);
        this.logger.info(
          `Devices configured with inverse_forwarding get rate limited. Rate limiting message with code cd=${messageCodeNum} for device ${deviceKey}. Please wait for ${remainingTime}ms before sending another message. Use inverse_forwarding=false to avoid rate limiting.`,
        );
        return true;
      }

      // Update the last sent time for this message type
      this.rateLimitedMessages.set(rateLimitKey, currentTime);
      return false;
    } catch (error) {
      this.logger.error(error, "Error in rate limiting logic");
      return false; // On error, don't rate limit
    }
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
    this.configBroker = mqtt.connect(this.config.broker_url, configOptions);

    const certs = this.loadCertificates();
    const remoteOptions = {
      ...certs,
      protocol: "mqtts" as const,
      keepalive: 30,
      clientId: this.generateClientId(
        this.config.remote.client_id_prefix || "hm_",
      ),
    };
    this.remoteBroker = mqtt.connect(this.config.remote.url, remoteOptions);

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
    this.remoteBroker.on("connect", () => {
      this.logger.info("Connected to remote broker");
    });
    this.setupRemoteSubscriptions();

    this.remoteBroker.on("error", (error: Error) => {
      this.logger.error(error, "Remote broker error");
    });

    this.remoteBroker.on("disconnect", () => {
      this.logger.warn("Remote broker disconnected");
    });

    this.remoteBroker.on("offline", () => {
      this.logger.warn("Remote broker went offline");
    });
  }

  private setupConfigSubscriptions(): void {
    this.setupSubscriptions(this.configBroker);
  }

  private setupRemoteSubscriptions(): void {
    this.setupSubscriptions(this.remoteBroker);
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
   * For REMOTE broker (remoteBroker):
   *   - Always uses remote structure (topic_prefix + remote_id)
   *
   * @param device The device configuration
   * @param broker The MQTT broker (configBroker for local, remoteBroker for remote)
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
      } else {
        // Use local topic structure
        return {
          prefix:
            this.config.remote.local_topic_prefix ||
            this.config.remote.topic_prefix ||
            "hame_energy/",
          identifier: device.mac,
        };
      }
    } else {
      // Remote broker - always use remote structure
      return {
        prefix: this.config.remote.topic_prefix || "hame_energy/",
        identifier: device.remote_id!,
      };
    }
  }

  private setupSubscriptions(broker: MqttClient): void {
    const brokerName = broker === this.configBroker ? "local" : "remote";

    const topics = this.config.devices.map((device) => {
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
      (topic: string, message: Buffer, packet: mqtt.IPublishPacket) => {
        this.forwardMessage(
          topic,
          message,
          broker === this.configBroker ? this.remoteBroker : this.configBroker,
          packet,
        );
      },
    );
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
            this.logger.debug("Skipping message from our own relay instance");
            return true;
          } else {
            // Message from another relay instance - also skip it to prevent loops
            this.logger.debug(
              `Skipping message from relay instance: ${userProps.relayInstanceId.substring(0, 8)}`,
            );
            return true;
          }
        }
      }
      return false;
    } catch (error) {
      this.logger.error(error, "Error checking if message is processed");
      return false; // On error, don't skip the message
    }
  }

  private forwardMessage(
    topic: string,
    message: Buffer,
    targetClient: MqttClient,
    packet?: mqtt.IPublishPacket,
  ): void {
    // Check if this is a looped message that should be skipped
    if (packet && this.isMessageProcessed(packet)) {
      return;
    }

    // Try to match the topic and find the corresponding device
    let matchedDevice: Device | undefined;
    let topicType = "";
    let isDevice = false;

    // Try to match against all possible topic patterns for all devices
    for (const device of this.config.devices) {
      const sourceClient =
        targetClient === this.configBroker
          ? this.remoteBroker
          : this.configBroker;

      // Get the expected topic structure for this device on the source broker
      const { prefix: expectedPrefix, identifier: expectedIdentifier } =
        this.getTopicStructureForDevice(device, sourceClient);

      // Try to match this device's topic pattern
      const pattern = new RegExp(
        `^${expectedPrefix.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}([^/]+)/(device|App)/(.*)/ctrl$`,
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
    } else {
      if (isDevice && inverseForwarding) {
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

      // Apply rate limiting for messages going from local to Hame
      if (
        targetClient === this.remoteBroker &&
        this.shouldRateLimit(message, deviceKey)
      ) {
        return;
      }
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
