/**
 * Single source of truth for per-device-type / per-firmware behavior.
 *
 * Historically this knowledge was spread across `brokers.json` (`min_versions`,
 * `use_remote_topic_id_versions`), `topic.ts` (`isSupportVid`), a separate
 * `broker_selection.ts`, and inline lists in `main.ts`. Those sources
 * overlapped and even disagreed (e.g. the broker migration threshold and the
 * topic-encryption threshold differ for the same device). This module
 * consolidates everything into one ordered table of {@link DeviceProfile}
 * entries plus a small set of pure helper functions.
 *
 * A human-readable rendering of the table lives in `docs/device-matrix.md`;
 * keep the two in sync.
 */

export type InversePolicy = "selectable" | "auto";

export interface DeviceProfile {
  /** Stable name for logging/debugging (not used for matching). */
  name: string;
  /** Matches a device type that has already been normalized (trim + uppercase). */
  matches(normalizedType: string): boolean;
  /**
   * Device is never served by the modern broker and never uses topic
   * encryption at any firmware ("route 1", e.g. HMI-350 / HMI-500). Implies the
   * legacy broker and `supportsVid` === false regardless of firmware.
   */
  legacyOnly?: boolean;
  /**
   * Device is served by the legacy broker below {@link migrationVersion} and by
   * the modern broker at/above it. When false/undefined the device always uses
   * the modern broker.
   */
  legacyCapable?: boolean;
  /** Firmware at which a {@link legacyCapable} device moves to the modern broker. */
  migrationVersion?: number;
  /**
   * Minimum firmware for salt-based (`cq`) topic-id encryption. `0` means
   * "always supported"; `Infinity` means "never".
   */
  vidSupportVersion: number;
  /** Exact firmware versions that enable the remote topic id on the local broker. */
  useRemoteTopicIdVersions?: number[];
  /** Inverse-forwarding policy for this family. */
  inverse: InversePolicy;
  /** HME family: subject to AstraMeter synthetic-MAC handling. */
  astraMeter?: boolean;
}

/** Trim + uppercase so base-type handling is done exactly one way everywhere. */
export function normalizeType(type: string): string {
  return type.trim().toUpperCase();
}

const startsWith =
  (...prefixes: string[]) =>
  (type: string): boolean =>
    prefixes.some((p) => type.startsWith(p));

const exact =
  (...ids: string[]) =>
  (type: string): boolean =>
    ids.includes(type);

/**
 * Ordered most-specific → most-general. The first profile whose `matches`
 * returns true wins, so exact ids and HMI model tokens must precede the
 * base-type `startsWith` entries.
 */
const DEVICE_PROFILES: DeviceProfile[] = [
  // --- HME exact models (must precede the HME base entry) ---
  {
    name: "HME-2/HME-4",
    matches: exact("HME-2", "HME-4"),
    vidSupportVersion: 122,
    inverse: "auto",
    astraMeter: true,
  },
  {
    name: "HME-3/HME-5",
    matches: exact("HME-3", "HME-5"),
    vidSupportVersion: 120,
    inverse: "auto",
    astraMeter: true,
  },
  {
    name: "TPM-CN",
    matches: exact("TPM-CN"),
    vidSupportVersion: 122,
    inverse: "auto",
  },

  // --- HMI model-token rules (must precede the HMI base entry) ---
  {
    // HMI-350 / HMI-500 ("route 1", #158 / #164): never reach the modern
    // broker and never use topic encryption. Whole-token match so ids like
    // "HMI-3500" / "HMI-5000" stay on the regular HMI path.
    name: "HMI-350/HMI-500 (route 1)",
    matches: (t) => t.startsWith("HMI") && /\b(350|500)\b/.test(t),
    legacyOnly: true,
    vidSupportVersion: Infinity,
    inverse: "auto",
  },
  {
    // HMI-2000 (4-PV) uses topic encryption from an earlier firmware than other
    // HMI models. Whole-token match so "HMI-12000" / "HMI-20001" don't match.
    name: "HMI-2000",
    matches: (t) => t.startsWith("HMI") && /\b2000\b/.test(t),
    vidSupportVersion: 105,
    inverse: "auto",
  },

  // --- Base-type families ---
  {
    name: "HMA",
    matches: startsWith("HMA"),
    legacyCapable: true,
    migrationVersion: 226,
    vidSupportVersion: 230,
    useRemoteTopicIdVersions: [226],
    inverse: "selectable",
  },
  {
    // HMB is only ever served by the legacy broker (never listed for the modern
    // broker), so it stays on legacy at every firmware.
    name: "HMB",
    matches: startsWith("HMB"),
    legacyOnly: false,
    legacyCapable: true,
    migrationVersion: Infinity,
    vidSupportVersion: 230,
    inverse: "selectable",
  },
  {
    name: "HMF",
    matches: startsWith("HMF"),
    legacyCapable: true,
    migrationVersion: 226,
    vidSupportVersion: 230,
    useRemoteTopicIdVersions: [226],
    inverse: "selectable",
  },
  {
    name: "HMK",
    matches: startsWith("HMK"),
    vidSupportVersion: 230,
    useRemoteTopicIdVersions: [226],
    inverse: "selectable",
  },
  {
    name: "HMJ",
    matches: startsWith("HMJ"),
    legacyCapable: true,
    migrationVersion: 108,
    vidSupportVersion: 116,
    useRemoteTopicIdVersions: [108],
    inverse: "selectable",
  },
  {
    name: "HMG",
    matches: startsWith("HMG"),
    legacyCapable: true,
    migrationVersion: 153,
    vidSupportVersion: 154,
    inverse: "auto",
  },
  {
    name: "HMM",
    matches: startsWith("HMM"),
    legacyCapable: true,
    migrationVersion: 135,
    vidSupportVersion: 136,
    inverse: "auto",
  },
  {
    name: "HMN",
    matches: startsWith("HMN"),
    legacyCapable: true,
    migrationVersion: 135,
    vidSupportVersion: 136,
    inverse: "auto",
  },
  {
    name: "JPLS",
    matches: startsWith("JPLS"),
    legacyCapable: true,
    migrationVersion: 135,
    vidSupportVersion: 136,
    inverse: "auto",
  },
  {
    name: "HMD",
    matches: startsWith("HMD"),
    vidSupportVersion: 0,
    inverse: "auto",
  },
  {
    // HME base / other HME generations (e.g. HME-0, HME-1, HME-6, HME-25): no
    // firmware gate on topic encryption. The exact HME-2/3/4/5 entries above
    // take precedence.
    name: "HME",
    matches: startsWith("HME"),
    vidSupportVersion: 0,
    inverse: "auto",
    astraMeter: true,
  },
  {
    name: "HMI",
    matches: startsWith("HMI"),
    vidSupportVersion: 120,
    inverse: "auto",
  },
  {
    // VNSE3 / VNSA / VNSD all share the same behavior.
    name: "VNS",
    matches: startsWith("VNS"),
    vidSupportVersion: 123,
    inverse: "auto",
  },
];

/** Unknown/unlisted device types: assume a modern, topic-encryption-capable device. */
export const DEFAULT_PROFILE: DeviceProfile = {
  name: "unknown",
  matches: () => true,
  vidSupportVersion: 0,
  inverse: "auto",
};

/** Resolves the profile for a device type. Falls back to {@link DEFAULT_PROFILE}. */
export function resolveProfile(type: string): DeviceProfile {
  if (!type) {
    return DEFAULT_PROFILE;
  }
  const normalized = normalizeType(type);
  return (
    DEVICE_PROFILES.find((profile) => profile.matches(normalized)) ??
    DEFAULT_PROFILE
  );
}

function parseVersion(version: string | number): number {
  return typeof version === "number" ? version : parseFloat(version);
}

/**
 * Whether a device type supports salt-based (`cq`) topic-id encryption at the
 * given firmware. Replaces `CommonHelper.isSupportVid`.
 */
export function supportsVid(
  type: string,
  version: string | number | null | undefined,
): boolean {
  if (!type || version == null || version === "") {
    return false;
  }
  const parsed = parseVersion(version);
  if (isNaN(parsed)) {
    return false;
  }
  return parsed >= resolveProfile(type).vidSupportVersion;
}

export type BrokerRole = "legacy" | "modern";

/**
 * Which broker generation serves a device at a given firmware. Replaces the
 * `autoDetermineBroker` / `resolveBrokerMinVersion` / `isLegacyOnlyDevice`
 * logic.
 */
export function brokerRoleFor(type: string, version: number): BrokerRole {
  const profile = resolveProfile(type);
  if (profile.legacyOnly) {
    return "legacy";
  }
  if (
    profile.legacyCapable &&
    version < (profile.migrationVersion ?? Infinity)
  ) {
    return "legacy";
  }
  return "modern";
}

/** Whether the remote topic id should be used on the local broker. */
export function usesRemoteTopicId(type: string, version: number): boolean {
  return (
    resolveProfile(type).useRemoteTopicIdVersions?.includes(version) ?? false
  );
}

/** Inverse-forwarding policy for a device type. */
export function inverseForwardingPolicy(type: string): InversePolicy {
  return resolveProfile(type).inverse;
}

/** Whether a device type belongs to the HME (AstraMeter) family. */
export function isAstraMeterFamily(type: string): boolean {
  return resolveProfile(type).astraMeter === true;
}

/**
 * Marstek cloud "managed" placeholder devid/mac from AstraMeter
 * (`02b250` prefix + 6 random hex nibbles). Those entries are not real hardware
 * on local MQTT, so inverse forwarding would drop traffic and the `cq`/salt
 * paths do not apply.
 */
export function isAstraMeterSyntheticMac(mac: string): boolean {
  const normalized = mac.trim().replace(/:/g, "").toLowerCase();
  return /^02b250[0-9a-f]{6}$/.test(normalized);
}
