export const deviceGenerations = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 25, 31, 41, 50, 51,
  61, 71, 72,
] as const;
export type DeviceGen = (typeof deviceGenerations)[number];

export const deviceTypes = [
  "HMA",
  "HMB",
  "HMC",
  "HMD",
  "HME",
  "HMF",
  "HMG",
  "HMH",
  "HMHL",
  "HMJ",
  "HMK",
  "HMI",
  "HML",
  "HMM",
  "HMN",
  "SCH",
  "SDH",
  "SMR",
  "TPM2",
  "UB",
  "VAAC2",
  "VDAC",
  "VENX",
  "VEPRO",
  "VNSA",
  "VNSA2",
  "VNSACH",
  "VNSB",
  "VNSD",
  "VNSD2",
  "VNSDCH",
  "VNSE3",
  "VNSE3AU",
  "VNSE3CH",
  "VNSE3US",
  "VNSE4",
  "VNSEMAX",
  "VNSEMINI",
  "VNSG",
  "VNSGPV",
] as const;
export type DeviceType = (typeof deviceTypes)[number];

// Model-suffixed HMI identifiers (e.g. HMI-2000, the 4-PV microinverter) that
// don't follow the generation numbering used above.
export const hmiModelTypes = [
  "HMI-2000",
  "HMI-350",
  "HMI-500",
  "HMI-350S",
  "HMI-500S",
  "HMI-02KS",
] as const;

// Identifiers that carry no generation suffix at all.
export const standaloneDeviceTypes = ["TPM-CN"] as const;

export type DeviceTypeIdentifier =
  | `${DeviceType}-${DeviceGen}`
  // HMD-V*/HMD-N* are sub-types with their own profiles, and SDH ids carry a
  // "K" suffix (SDH-6K); neither fits the plain `${type}-${gen}` shape.
  | `HMD-${"V" | "N"}${DeviceGen}`
  | `SDH-${DeviceGen}K`
  | `JPLS-${number}H`
  | `HMI-${number}`
  | (typeof hmiModelTypes)[number]
  | (typeof standaloneDeviceTypes)[number];

export const knownDeviceTypes: DeviceTypeIdentifier[] = [
  ...(deviceGenerations.flatMap((gen) =>
    deviceTypes.map((type) => `${type}-${gen}` as const),
  ) as DeviceTypeIdentifier[]),
  ...(deviceGenerations.flatMap((gen) => [
    `HMD-V${gen}` as const,
    `HMD-N${gen}` as const,
    `SDH-${gen}K` as const,
  ]) as DeviceTypeIdentifier[]),
  ...(deviceGenerations.map(
    (gen) => `JPLS-${gen}H` as const,
  ) as DeviceTypeIdentifier[]),
  ...hmiModelTypes,
  ...standaloneDeviceTypes,
];

export interface Device {
  device_id: string;
  mac: string;
  type: DeviceTypeIdentifier;
  version?: number;
  /**
   * The firmware version exactly as the API reported it, kept only when it
   * read as a version. Some families pick their firmware line off the *shape*
   * of that string, which {@link version} no longer carries once "116.0" has
   * become 116 — so the device matrix is given this where it exists.
   */
  version_text?: string;
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
