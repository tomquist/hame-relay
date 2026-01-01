export const deviceGenerations = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 25, 50,
] as const;
export type DeviceGen = (typeof deviceGenerations)[number];

export const deviceTypes = [
  "HMA",
  "HMB",
  "HMD",
  "HME",
  "HMF",
  "HMG",
  "HMJ",
  "HMK",
  "HMI",
  "HMM",
  "HMN",
  "VNSE3",
  "VNSA",
  "VNSD",
] as const;
export type DeviceType = (typeof deviceTypes)[number];

export type DeviceTypeIdentifier = `${DeviceType}-${DeviceGen}` | `JPLS-8H`;

export const knownDeviceTypes: DeviceTypeIdentifier[] = [
  ...(deviceGenerations.flatMap((gen) =>
    deviceTypes.map((type) => `${type}-${gen}` as const),
  ) as DeviceTypeIdentifier[]),
  "JPLS-8H",
];

export interface Device {
  device_id: string;
  mac: string;
  type: DeviceTypeIdentifier;
  version?: number;
  inverse_forwarding?: boolean;
  name?: string;
  broker_id?: string;
  remote_id?: string;
  use_remote_topic_id?: boolean;
  salt?: string; // Comma-separated salt values from device list
}

export interface BrokerDefinition {
  url: string;
  ca: string;
  cert: string;
  key: string;
  topic_prefix?: string;
  local_topic_prefix?: string;
  topic_encryption_key?: string;
  client_id_prefix?: string;
  use_remote_topic_id_versions?: Record<string, number[]>;
  min_versions?: Record<string, number>;
}

export interface ForwarderConfig {
  broker_url: string;
  devices: Device[];
  inverse_forwarding?: boolean;
  username?: string;
  password?: string;
  remote: BrokerDefinition;
  broker_id: string;
}

export interface MainConfig {
  broker_url: string;
  devices?: Device[]; // Now optional since devices are fetched from API
  inverse_forwarding?: boolean;
  username: string; // Now required
  password: string; // Now required
  default_broker_id?: string;
  inverse_forwarding_device_ids?: string; // Comma-separated list of device IDs for selective inverse forwarding
}
