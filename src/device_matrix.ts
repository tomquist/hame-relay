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

/**
 * One step of a device family's salt-based (`cq`) topic-id encryption: from
 * firmware `since` (and up, until the next step) encryption is used or not.
 */
export interface VidRoute {
  since: number;
  supported: boolean;
}

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
   * "always supported"; `Infinity` means "never". Omit it only when
   * {@link vidRoutes} covers the family instead — a profile with neither never
   * encrypts.
   */
  vidSupportVersion?: number;
  /**
   * Step list for families whose firmware does not encrypt in one contiguous
   * range (see the Jupiter and HME entries), ascending by `since`, with
   * firmware below the first step unencrypted. Set this *or*
   * {@link vidSupportVersion}: this one wins outright, so a profile carrying
   * both hides the other value.
   */
  vidRoutes?: VidRoute[];
  /**
   * For families whose firmware runs in two lines, the app reads the line off
   * the *shape* of the raw version string rather than its numeric value, so
   * {@link vidRoutes} alone cannot place a version like `"150.5"`: it is
   * numerically inside the first line but is not shaped like one. `shape`
   * matches the raw versions that really are on the first line, and
   * `endsBefore` is where the second line starts — below it, a version that
   * does not match `shape` belongs to the second line and is not encrypted.
   */
  vidFirstLine?: { shape: RegExp; endsBefore: number };
  /**
   * Exact firmware versions that enable the remote topic id on the local
   * broker. Matched by equality, so a device reporting a fractional version
   * (e.g. `226.5`) does not match the `226` entry.
   */
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

/**
 * The Jupiter family (HMM/HMN/JPLS) ships two independent firmware lines: a
 * 1xx line and a 2xx line (e.g. Jupiter C Plus / JPLS-8H is on 2xx). The app
 * picks its thresholds per line — `JupiterVersionController.isRelease()` is
 * true only for a three-digit firmware starting with "1" — so a 2xx device is
 * *not* simply "newer than" a 1xx one: it starts over on the 2024 broker with
 * plaintext topics and migrates again at its own, much higher thresholds
 * (#209). Expressed as version steps, both lines are covered by one table.
 */
function jupiterBrokerRoutes(secondLineMigration: number): BrokerRoute[] {
  return [
    { since: 0, broker: BROKER_2024 },
    { since: 135, broker: BROKER_2025 },
    { since: 200, broker: BROKER_2024 },
    { since: secondLineMigration, broker: BROKER_2025 },
  ];
}

/** Salt-based (`cq`) topic-id encryption for both Jupiter firmware lines. */
const JUPITER_VID_ROUTES: VidRoute[] = [
  { since: 136, supported: true },
  { since: 200, supported: false },
  { since: 236, supported: true },
];

/**
 * `JupiterVersionController.isRelease()` puts a device on the 1xx line only
 * when its raw firmware string is exactly three digits starting with "1" — so
 * "150.5" is *not* on that line even though it sits between 100 and 200.
 * Numbers and 1xx strings agree with the steps above; this only keeps
 * differently shaped versions out of the encrypted 1xx range.
 */
const JUPITER_FIRST_LINE = { shape: /^1\d\d$/, endsBefore: 200 };

/**
 * Where the HME meters' main firmware line starts. `CtVersionController` reads
 * the line off the *length* of the raw version string: a three-character
 * version ("116", "119") is on the main line, anything else — a two-digit
 * version such as "50", or a four-digit one — is on the second line. For whole
 * versions that is exactly the range 100–999, so the numeric steps below
 * reproduce the app's choice; only a fractional version inside that range
 * would need the {@link DeviceProfile.vidFirstLine} treatment, and HME
 * firmware is always reported whole.
 */
const HME_MAIN_LINE_START = 100;

/**
 * Broker routing for an HME meter across both of its firmware lines (#212).
 * Like the Jupiter family, a main-line firmware is not simply "newer" than a
 * second-line one: the second line migrated to the 2025 broker at a far lower
 * version, and the main line starts over on the 2024 broker at 100. Above 999
 * the second line resumes, where both thresholds are long since passed and the
 * last step already says 2025.
 */
function hmeBrokerRoutes(
  secondLineMigration: number,
  mainLineMigration: number,
): BrokerRoute[] {
  return [
    { since: 0, broker: BROKER_2024 },
    { since: secondLineMigration, broker: BROKER_2025 },
    { since: HME_MAIN_LINE_START, broker: BROKER_2024 },
    { since: mainLineMigration, broker: BROKER_2025 },
  ];
}

/** Salt-based (`cq`) topic-id encryption across both HME firmware lines. */
function hmeVidRoutes(secondLineVid: number, mainLineVid: number): VidRoute[] {
  return [
    { since: secondLineVid, supported: true },
    { since: HME_MAIN_LINE_START, supported: false },
    { since: mainLineVid, supported: true },
  ];
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
    brokerRoutes: hmeBrokerRoutes(24, 119),
    vidRoutes: hmeVidRoutes(25, 122),
    inverse: "auto",
    astraMeter: true,
  },
  {
    name: "HME-3/HME-5",
    matches: exact("HME-3", "HME-5"),
    brokerRoutes: hmeBrokerRoutes(33, 116),
    vidRoutes: hmeVidRoutes(34, 120),
    inverse: "auto",
    astraMeter: true,
  },
  {
    name: "TPM-CN",
    matches: exact("TPM-CN"),
    vidSupportVersion: 101,
    inverse: "auto",
  },
  {
    // Marstek CT002 "new generation" (reported as TPM2-0, #201). Ships on the
    // 2025 broker and uses salt-based topic-id encryption on every firmware, so
    // there is no pre-encryption threshold. Only this exact id is recognized —
    // see the TPM2 catch-all below. TPM-CN starts with "TPM-" and is unaffected.
    name: "TPM2-0",
    matches: exact("TPM2-0"),
    vidSupportVersion: 0,
    inverse: "auto",
  },
  {
    // Any other TPM2 id is unrecognized by the app: it stays on the 2024 broker
    // and never uses topic encryption. Guessing the other way for a future
    // TPM2-1 would be wrong on both axes at once.
    name: "TPM2 (other)",
    matches: startsWith("TPM2"),
    brokerRoutes: ALWAYS_2024,
    vidSupportVersion: Infinity,
    inverse: "auto",
  },

  // --- HMI routes ---
  // The app classifies an HMI id by plain substring, not by whole token, and
  // tests "2000"/"02KS" before "350"/"500". The four entries below reproduce
  // that order (route 4 → 1 → 2 → 0); reordering them changes which route an id
  // carrying more than one of those tokens lands on.
  {
    // Route 4. HMI-2000 (4-PV) and HMI-02KS use topic encryption from an
    // earlier firmware than other HMI models.
    name: "HMI-2000/HMI-02KS (route 4)",
    matches: (t) =>
      t.startsWith("HMI") && (t.includes("2000") || t.includes("02KS")),
    brokerRoutes: migrate2024to2025(113),
    vidSupportVersion: 105,
    inverse: "auto",
  },
  {
    // Route 1 (#158 / #164): always stays on the 2024 broker and never uses
    // topic encryption. Substring match, so HMI-350S / HMI-500S are included.
    name: "HMI-350/HMI-500 (route 1)",
    matches: (t) =>
      t.startsWith("HMI") && (t.includes("350") || t.includes("500")),
    brokerRoutes: ALWAYS_2024,
    vidSupportVersion: Infinity,
    inverse: "auto",
  },
  {
    // Route 2: any remaining HMI id containing a digit 1-5. Without an explicit
    // brokerRoutes this would silently default to always-2025 and strand
    // pre-129 devices on the wrong broker (#173).
    name: "HMI (route 2)",
    matches: (t) => t.startsWith("HMI") && /[1-5]/.test(t),
    brokerRoutes: migrate2024to2025(129),
    vidSupportVersion: 120,
    inverse: "auto",
  },
  {
    // Route 0: everything else, e.g. HMI-6. Behaves like route 1.
    name: "HMI (route 0)",
    matches: startsWith("HMI"),
    brokerRoutes: ALWAYS_2024,
    vidSupportVersion: Infinity,
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
    brokerRoutes: jupiterBrokerRoutes(230),
    vidRoutes: JUPITER_VID_ROUTES,
    vidFirstLine: JUPITER_FIRST_LINE,
    inverse: "auto",
  },
  {
    name: "HMN",
    matches: startsWith("HMN"),
    brokerRoutes: jupiterBrokerRoutes(230),
    vidRoutes: JUPITER_VID_ROUTES,
    vidFirstLine: JUPITER_FIRST_LINE,
    inverse: "auto",
  },
  {
    name: "JPLS",
    matches: startsWith("JPLS"),
    brokerRoutes: jupiterBrokerRoutes(232),
    vidRoutes: JUPITER_VID_ROUTES,
    vidFirstLine: JUPITER_FIRST_LINE,
    inverse: "auto",
  },
  // HMD outdoor power stations. The app keys off the sub-type token after the
  // first "-", so the three entries below match that token directly rather than
  // a loose substring. No HMD supports vid (topic encryption) on any firmware —
  // the app's CommonHelper.isSupportVid has no HMD branch and returns false.
  {
    name: "HMD-V",
    matches: startsWith("HMD-V"),
    // No brokerRoutes: always the 2025 broker.
    vidSupportVersion: Infinity,
    inverse: "auto",
  },
  {
    name: "HMD-N",
    matches: startsWith("HMD-N"),
    brokerRoutes: migrate2024to2025(1.42),
    vidSupportVersion: Infinity,
    inverse: "auto",
  },
  {
    // HMD-1..7, HMD-41/61/71/72, bare HMD: never offered the 2025 broker. The
    // former migration at firmware 155 sent these to the 2025 broker with the
    // wrong credentials and topic prefix, so they exchanged no traffic (#214).
    name: "HMD",
    matches: startsWith("HMD"),
    brokerRoutes: ALWAYS_2024,
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
    // Mars SE. Must precede the HMH entry below, which its id also starts with.
    name: "HMHL (Mars SE)",
    matches: startsWith("HMHL"),
    vidSupportVersion: 0,
    inverse: "auto",
  },
  {
    // V6000. Must precede the SDH entry below.
    name: "SDH-6K (V6000)",
    matches: startsWith("SDH-6K"),
    vidSupportVersion: 0,
    inverse: "auto",
  },
  {
    // Mars (HMH), M5000 (SDH other than SDH-6K) and Venus X (VENX): on the 2025
    // broker, but never topic encryption.
    name: "HMH/SDH/VENX",
    matches: startsWith("HMH", "SDH", "VENX"),
    vidSupportVersion: Infinity,
    inverse: "auto",
  },
  {
    // Marstek CT003 meter readers: SMR-0 (P1, NL), SMR-1 (IR, DE), SMR-2
    // (TIC, FR).
    name: "SMR (CT003)",
    matches: startsWith("SMR-"),
    vidSupportVersion: 0,
    inverse: "auto",
  },
  {
    // M5000 (HMC-1/2/7 and SCH-1), Mars-A (other HMC), HML and the Mars-family
    // UB variant: 2024 broker and never topic encryption. Without this entry
    // they reach DEFAULT_PROFILE, which is wrong on both axes, so they exchange
    // no traffic at all.
    name: "HMC/SCH/HML/UB",
    matches: startsWith("HMC", "SCH", "HML", "UB"),
    brokerRoutes: ALWAYS_2024,
    vidSupportVersion: Infinity,
    inverse: "auto",
  },
  {
    // These two use topic encryption unconditionally, not from 123 like the
    // rest of the Venus family.
    name: "VNSE3US/VNSE3CH",
    matches: startsWith("VNSE3US", "VNSE3CH"),
    vidSupportVersion: 0,
    inverse: "auto",
  },
  {
    // Venus G PV: on the 2024 broker and never topic encryption, unlike its
    // VNSG sibling. Must precede VNSG, whose prefix would otherwise swallow it.
    name: "VNSGPV",
    matches: startsWith("VNSGPV"),
    brokerRoutes: ALWAYS_2024,
    vidSupportVersion: Infinity,
    inverse: "auto",
  },
  {
    // VNS-prefixed but not Venus devices: 2025 broker, never topic encryption.
    name: "VNSG/VNSEMINI/VNSB",
    matches: startsWith("VNSG", "VNSEMINI", "VNSB"),
    vidSupportVersion: Infinity,
    inverse: "auto",
  },
  {
    // 2025 broker (like the default it used to reach), but never topic
    // encryption.
    name: "VAAC2",
    matches: startsWith("VAAC2"),
    vidSupportVersion: Infinity,
    inverse: "auto",
  },
  {
    // Venus series (VNSD*/VNSA* incl. VNSD2/VNSA2, VNSE3, VNSE3AU, VNSE4,
    // VNSEMAX): always on the 2025 broker, at any firmware — the whole family
    // runs on the 2025 infrastructure and never used the 2024 broker. VEPRO/VDAC
    // do not start with "VNS" and reach the default (also always-2025).
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

/**
 * Parses a reported firmware version. Fractional versions are preserved: the
 * HMD-N broker threshold is `1.42`, so truncating here would make it
 * unreachable. Callers that turn an API string into a `Device.version` must go
 * through this too, so the whole codebase agrees on what a version means.
 */
export function parseVersion(version: string | number): number {
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
  const profile = resolveProfile(type);
  if (profile.vidRoutes) {
    // Only the raw string carries the shape the app keys off, so check it
    // before falling back to the numeric steps. A number reaching here keeps
    // any fractional part the API reported (`main.ts` uses parseFloat) and so
    // stringifies back to the same shape the app saw.
    const raw = String(version).trim();
    const firstLine = profile.vidFirstLine;
    if (
      firstLine &&
      parsed < firstLine.endsBefore &&
      !firstLine.shape.test(raw)
    ) {
      return false;
    }
    let supported = false;
    for (const route of profile.vidRoutes) {
      if (parsed >= route.since) {
        supported = route.supported;
      }
    }
    return supported;
  }
  // A profile with neither vidRoutes nor a threshold never encrypts, rather
  // than comparing against undefined (which would silently be false anyway).
  return parsed >= (profile.vidSupportVersion ?? Infinity);
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
