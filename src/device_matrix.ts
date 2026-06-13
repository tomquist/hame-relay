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

// Broker generations are identified by the year they were introduced, never by
// a relative label like "current" or "legacy" (today's newest broker becomes an
// older one once the next generation ships). Adding a future generation is just
// another constant plus a routing entry.
export const BROKER_2024 = "hame-2024";
export const BROKER_2025 = "hame-2025";

/**
 * One step of a device family's broker routing: from firmware `since` (and up,
 * until the next step) the device talks to `broker`.
 */
export interface BrokerRoute {
  since: number;
  broker: string;
}

/** Routing for devices that always use the 2025 broker. */
const DEFAULT_BROKER_ROUTES: BrokerRoute[] = [
  { since: 0, broker: BROKER_2025 },
];

export interface DeviceProfile {
  /** Stable name for logging/debugging (not used for matching). */
  name: string;
  /** Matches a device type that has already been normalized (trim + uppercase). */
  matches(normalizedType: string): boolean;
  /**
   * Broker routing across firmware versions, ascending by `since`. The entry
   * with the greatest `since` not exceeding the device firmware wins. Defaults
   * to {@link DEFAULT_BROKER_ROUTES} (always the 2025 broker).
   */
  brokerRoutes?: BrokerRoute[];
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

/** Routing for a device that moves from the 2024 broker to the 2025 broker at `migrationVersion`. */
function migrate2024to2025(migrationVersion: number): BrokerRoute[] {
  return [
    { since: 0, broker: BROKER_2024 },
    { since: migrationVersion, broker: BROKER_2025 },
  ];
}

/** Routing for a device that always uses the 2024 broker. */
const ALWAYS_2024: BrokerRoute[] = [{ since: 0, broker: BROKER_2024 }];

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
    brokerRoutes: migrate2024to2025(119),
    vidSupportVersion: 122,
    inverse: "auto",
    astraMeter: true,
  },
  {
    name: "HME-3/HME-5",
    matches: exact("HME-3", "HME-5"),
    brokerRoutes: migrate2024to2025(116),
    vidSupportVersion: 120,
    inverse: "auto",
    astraMeter: true,
  },
  {
    name: "TPM-CN",
    matches: exact("TPM-CN"),
    vidSupportVersion: 101,
    inverse: "auto",
  },

  // --- HMI model-token rules (must precede the HMI base entry) ---
  {
    // HMI-350 / HMI-500 ("route 1", #158 / #164): always stay on the 2024
    // broker and never use topic encryption. Whole-token match so ids like
    // "HMI-3500" / "HMI-5000" stay on the regular HMI path.
    name: "HMI-350/HMI-500 (route 1)",
    matches: (t) => t.startsWith("HMI") && /\b(350|500)\b/.test(t),
    brokerRoutes: ALWAYS_2024,
    vidSupportVersion: Infinity,
    inverse: "auto",
  },
  {
    // HMI-2000 (4-PV) uses topic encryption from an earlier firmware than other
    // HMI models. Whole-token match so "HMI-12000" / "HMI-20001" don't match.
    name: "HMI-2000",
    matches: (t) => t.startsWith("HMI") && /\b2000\b/.test(t),
    brokerRoutes: migrate2024to2025(113),
    vidSupportVersion: 105,
    inverse: "auto",
  },

  // --- Base-type families ---
  {
    name: "HMA",
    matches: startsWith("HMA"),
    brokerRoutes: migrate2024to2025(226),
    vidSupportVersion: 230,
    useRemoteTopicIdVersions: [226],
    inverse: "selectable",
  },
  {
    // HMB always stays on the 2024 broker (never offered the 2025 broker).
    name: "HMB",
    matches: startsWith("HMB"),
    brokerRoutes: ALWAYS_2024,
    vidSupportVersion: 230,
    inverse: "selectable",
  },
  {
    name: "HMF",
    matches: startsWith("HMF"),
    brokerRoutes: migrate2024to2025(226),
    vidSupportVersion: 230,
    useRemoteTopicIdVersions: [226],
    inverse: "selectable",
  },
  {
    name: "HMK",
    matches: startsWith("HMK"),
    brokerRoutes: migrate2024to2025(226),
    vidSupportVersion: 230,
    useRemoteTopicIdVersions: [226],
    inverse: "selectable",
  },
  {
    name: "HMJ",
    matches: startsWith("HMJ"),
    brokerRoutes: migrate2024to2025(108),
    vidSupportVersion: 116,
    useRemoteTopicIdVersions: [108],
    inverse: "selectable",
  },
  {
    name: "HMG",
    matches: startsWith("HMG"),
    brokerRoutes: migrate2024to2025(153),
    vidSupportVersion: 154,
    inverse: "auto",
  },
  {
    name: "HMM",
    matches: startsWith("HMM"),
    brokerRoutes: migrate2024to2025(135),
    vidSupportVersion: 136,
    inverse: "auto",
  },
  {
    name: "HMN",
    matches: startsWith("HMN"),
    brokerRoutes: migrate2024to2025(135),
    vidSupportVersion: 136,
    inverse: "auto",
  },
  {
    name: "JPLS",
    matches: startsWith("JPLS"),
    brokerRoutes: migrate2024to2025(135),
    vidSupportVersion: 136,
    inverse: "auto",
  },
  {
    // HMD outdoor power stations. The "V" (V6000) and "N" (M5000) sub-types are
    // always on the 2025 broker; any other HMD (e.g. HMD-1..7) migrates only
    // above firmware 154. None of the HMD family supports vid (topic encryption)
    // — the app's CommonHelper.isSupportVid has no HMD branch and returns false.
    // Match the V/N sub-type token directly (HMD-V*/HMD-N*) rather than a loose
    // substring, so other HMD ids that merely contain V/N elsewhere don't match.
    name: "HMD-V/HMD-N",
    matches: (t) => t.startsWith("HMD-V") || t.startsWith("HMD-N"),
    vidSupportVersion: Infinity,
    inverse: "auto",
  },
  {
    name: "HMD",
    matches: startsWith("HMD"),
    brokerRoutes: migrate2024to2025(155),
    vidSupportVersion: Infinity,
    inverse: "auto",
  },
  {
    // HME base / other HME generations not in {HME-2,3,4,5} (e.g. bare "HME",
    // HME-1, HME-6). The app's CtVersionController only enumerates HME-2/3/4/5
    // (plus TPM/SMR); any other HME falls through to a hard `return false` in
    // both isSupportMqttEncrypt and isSupportVid, so these stay on the 2024
    // broker and never use topic encryption. The exact HME-2/3/4/5 entries above
    // take precedence.
    name: "HME",
    matches: startsWith("HME"),
    brokerRoutes: ALWAYS_2024,
    vidSupportVersion: Infinity,
    inverse: "auto",
    astraMeter: true,
  },
  {
    // Regular HMI inverters migrate from the 2024 broker to the 2025 broker at
    // firmware 129. The HMI-350/HMI-500 (always 2024) and HMI-2000 (migrates at
    // 113) exact entries above take precedence. Without an explicit brokerRoutes
    // this would silently default to always-2025 and strand pre-129 devices on
    // the wrong broker (#173).
    name: "HMI",
    matches: startsWith("HMI"),
    brokerRoutes: migrate2024to2025(129),
    vidSupportVersion: 120,
    inverse: "auto",
  },
  {
    // Venus series (VNSD*/VNSA* incl. VNSD2/VNSA2, VNSE3*, VNSE4): always on the
    // 2025 broker, at any firmware — the whole family runs on the 2025
    // infrastructure and never used the 2024 broker. VAAC2/VDAC do not start with
    // "VNS" and reach the default (also always-2025).
    name: "VNS",
    matches: startsWith("VNS"),
    vidSupportVersion: 123,
    inverse: "auto",
  },
];

/** Unknown/unlisted device types: assume a 2025-broker, topic-encryption-capable device. */
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
  if (typeof version === "number") {
    return version;
  }
  // Only accept fully-numeric strings; fail closed (NaN) on trailing junk like
  // "116foo" so supportsVid does not satisfy a threshold from a partial parse.
  const trimmed = version.trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    return NaN;
  }
  return parseFloat(trimmed);
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

/**
 * The broker id (e.g. `hame-2024` / `hame-2025`) that serves a device at a
 * given firmware. Replaces the `autoDetermineBroker` / `resolveBrokerMinVersion`
 * / `isLegacyOnlyDevice` logic.
 */
export function brokerForVersion(type: string, version: number): string {
  const routes = resolveProfile(type).brokerRoutes ?? DEFAULT_BROKER_ROUTES;
  let chosen = routes[0].broker;
  for (const route of routes) {
    if (version >= route.since) {
      chosen = route.broker;
    }
  }
  return chosen;
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
