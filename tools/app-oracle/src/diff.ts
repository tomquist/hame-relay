import { existsSync, readFileSync } from "fs";
import { resolveProfile } from "../../../src/device_matrix.js";
import { knownDeviceTypes } from "../../../src/types.js";
import { type Report, type RoutingFacts } from "./report.js";

/** What `src/device_matrix.ts` claims for one device family. */
interface MatrixFamily {
  name: string;
  family: string | null;
  broker: number[];
  topicId: number[];
  /**
   * Firmware versions that make a device use the remote topic id on the local
   * broker. The app has no separate decision for this — the version is the one
   * it migrates the device on — so these are checked against its broker
   * constants.
   */
  remoteTopicId: number[];
  /** For families the matrix routes without a threshold: which broker, always. */
  brokerMode?: string;
  /** For families that always or never encrypt the topic id. */
  topicIdMode?: "always" | "never";
}

/**
 * Which app-side family a profile's rules should live in. Only used to sharpen
 * the report — an unmapped profile is still checked against every family.
 */
const PROFILE_FAMILY: Array<[RegExp, string]> = [
  [/^HM[ABFKJ]$/u, "b2500"],
  [/^(HMM|HMN|JPLS)$/u, "jupiter"],
  [/^(HME|TPM|SMR)/u, "ct-hme"],
  [/^HMI/u, "hmi"],
  [/^HMD/u, "hmd"],
  [/^HMG$/u, "hmg"],
  [/^(VNS|VAAC)/u, "venus"],
];

/**
 * Firmware-line boundaries this project invents to express "the second line
 * starts here" as a version step. The app reads the line off the *shape* of the
 * version string instead — a length check, not a comparison — so these numbers
 * are not expected to appear in it.
 */
const SYNTHETIC_BOUNDARIES = new Set([100, 200]);

function familyForProfile(name: string): string | null {
  return PROFILE_FAMILY.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

/** Every distinct profile the matrix can resolve to, with its firmware numbers. */
function matrixFamilies(): MatrixFamily[] {
  const byName = new Map<string, MatrixFamily>();
  for (const type of knownDeviceTypes) {
    const profile = resolveProfile(type);
    if (byName.has(profile.name)) {
      continue;
    }
    const broker = (profile.brokerRoutes ?? [])
      .map((route) => route.since)
      .filter((since) => since > 0);
    const topicId: number[] = [];
    if (
      profile.vidSupportVersion !== undefined &&
      profile.vidSupportVersion > 0 &&
      Number.isFinite(profile.vidSupportVersion)
    ) {
      topicId.push(profile.vidSupportVersion);
    }
    for (const route of profile.vidRoutes ?? []) {
      if (route.since > 0) {
        topicId.push(route.since);
      }
    }
    const brokers = new Set(
      (profile.brokerRoutes ?? [{ since: 0, broker: "hame-2025" }]).map(
        (route) => route.broker,
      ),
    );
    const alwaysEncrypts = profile.vidSupportVersion === 0;
    const neverEncrypts =
      profile.vidRoutes === undefined &&
      !Number.isFinite(profile.vidSupportVersion ?? Infinity);
    let topicIdMode: MatrixFamily["topicIdMode"];
    if (alwaysEncrypts) {
      topicIdMode = "always";
    } else if (neverEncrypts) {
      topicIdMode = "never";
    }
    byName.set(profile.name, {
      name: profile.name,
      brokerMode: brokers.size === 1 ? `always ${[...brokers][0]}` : undefined,
      topicIdMode,
      family: familyForProfile(profile.name),
      broker: [...new Set(broker)].toSorted((a, b) => a - b),
      topicId: [...new Set(topicId)].toSorted((a, b) => a - b),
      remoteTopicId: [...new Set(profile.useRemoteTopicIdVersions)].toSorted(
        (a, b) => a - b,
      ),
    });
  }
  return [...byName.values()];
}

function findThreshold(
  routing: RoutingFacts[],
  axis: RoutingFacts["axis"],
  value: number,
): string[] {
  return routing
    .filter((facts) => facts.axis === axis && facts.thresholds.includes(value))
    .map((facts) => facts.family);
}

/**
 * What the app says about the device types one matrix profile owns, next to
 * what the profile says. `agrees` is false when the app states a number for
 * this profile's types that the profile does not carry, or the other way
 * round — in the family that owns the rule, ignoring the app's older path.
 */
export interface PerTypeComparison {
  profile: string;
  axis: "broker" | "topic-id";
  matrix: number[];
  /** How the matrix routes this family when it uses no threshold at all. */
  matrixMode?: string;
  /** Threshold(s) the app states for these types, per family. */
  app: Array<{ family: string; types: string[]; thresholds: number[] }>;
  agrees: boolean;
}

export interface DiffResult {
  missing: Array<{
    profile: string;
    axis: string;
    value: number;
    foundIn: string[];
  }>;
  unmodelled: Array<{ family: string; axis: string; values: number[] }>;
  perType: PerTypeComparison[];
}

/**
 * Which profile owns a device type the app names. `resolveProfile` is the same
 * matcher the relay uses at run time, so a rule about `HME-2` lands on exactly
 * the profile that would serve an HME-2 device. Trailing separators are dropped
 * first: the app tests some types with the generation separator attached.
 */
function profileForLiteral(literal: string): string {
  return resolveProfile(literal.replace(/-$/u, "")).name;
}

/**
 * Turns the app's per-type rules into a comparison against the matrix, one row
 * per profile and axis. This is the part that answers "what does the app do
 * with this device type" without reading any disassembly.
 */
function comparePerType(
  report: Report,
  families: MatrixFamily[],
): PerTypeComparison[] {
  const byProfileAxis = new Map<string, PerTypeComparison>();

  for (const facts of report.routing) {
    for (const rule of facts.rules) {
      const profiles = new Map<string, string[]>();
      for (const literal of rule.types) {
        const profile = profileForLiteral(literal);
        profiles.set(profile, [...(profiles.get(profile) ?? []), literal]);
      }
      if (rule.types.length === 0) {
        // A rule with no type of its own is the family's — the firmware-line
        // comparison it makes before looking at the type. It applies to every
        // profile that family serves.
        for (const family of families) {
          if (family.family === facts.family) {
            profiles.set(family.name, []);
          }
        }
      }
      for (const [profile, types] of profiles) {
        const matrix = families.find((family) => family.name === profile);
        if (!matrix) {
          continue;
        }
        const key = `${profile}:${facts.axis}`;
        const declared =
          facts.axis === "broker" ? matrix.broker : matrix.topicId;
        const row = byProfileAxis.get(key) ?? {
          profile,
          axis: facts.axis,
          // Line boundaries are this project's way of writing "the second
          // firmware line starts here" as a version step; the app reads the
          // line off the shape of the version string instead, so comparing
          // them against its constants means nothing.
          matrix: declared.filter((value) => !SYNTHETIC_BOUNDARIES.has(value)),
          matrixMode:
            facts.axis === "broker" ? matrix.brokerMode : matrix.topicIdMode,
          app: [],
          agrees: true,
        };
        const entry = row.app.find((a) => a.family === facts.family);
        if (entry) {
          entry.types = [...new Set([...entry.types, ...types])].toSorted();
          entry.thresholds = [
            ...new Set([...entry.thresholds, rule.threshold]),
          ].toSorted((a, b) => a - b);
        } else {
          row.app.push({
            family: facts.family,
            types: types.toSorted(),
            thresholds: [rule.threshold],
          });
        }
        byProfileAxis.set(key, row);
      }
    }
  }

  for (const row of byProfileAxis.values()) {
    // The app keeps an older routing path alongside the current one; judge
    // agreement on the family that owns the device, not on the legacy copy.
    const owning = row.app.filter((entry) => entry.family !== "legacy-mqtt");
    const stated = new Set(
      (owning.length > 0 ? owning : row.app).flatMap((e) => e.thresholds),
    );
    row.agrees = row.matrix.every((value) => stated.has(value));
  }

  return [...byProfileAxis.values()].toSorted((a, b) =>
    `${a.profile}:${a.axis}`.localeCompare(`${b.profile}:${b.axis}`),
  );
}

/**
 * Compares the matrix against what the app actually contains. This is a drift
 * detector, not a prover: a number can legitimately appear in more than one
 * family, so a match means "the app still has this number here", and only a
 * miss is a hard signal.
 */
export function compare(report: Report): DiffResult {
  const families = matrixFamilies();
  const missing: DiffResult["missing"] = [];

  for (const family of families) {
    for (const [axis, values] of [
      ["broker", family.broker],
      ["topic-id", family.topicId],
      ["remote-topic-id", family.remoteTopicId],
    ] as const) {
      for (const value of values) {
        if (SYNTHETIC_BOUNDARIES.has(value)) {
          continue;
        }
        // The app decides the remote topic id on the same constant it migrates
        // the broker on, so that is where to look for it.
        const foundIn = findThreshold(
          report.routing,
          axis === "remote-topic-id" ? "broker" : axis,
          value,
        );
        const expected = family.family;
        if (foundIn.length === 0 || (expected && !foundIn.includes(expected))) {
          missing.push({ profile: family.name, axis, value, foundIn });
        }
      }
    }
  }

  const modelled = new Set<string>();
  for (const family of families) {
    for (const value of family.broker) {
      modelled.add(`broker:${value}`);
    }
    for (const value of family.topicId) {
      modelled.add(`topic-id:${value}`);
    }
  }
  const unmodelled: DiffResult["unmodelled"] = [];
  for (const facts of report.routing) {
    const values = facts.thresholds.filter(
      (value) => value > 0 && !modelled.has(`${facts.axis}:${value}`),
    );
    if (values.length > 0) {
      unmodelled.push({ family: facts.family, axis: facts.axis, values });
    }
  }

  return { missing, unmodelled, perType: comparePerType(report, families) };
}

/** Prints the comparison; returns a process exit code. */
export function diff(reportFile: string): number {
  if (!existsSync(reportFile)) {
    throw new Error(`No report at ${reportFile}. Run "report" first.`);
  }
  const report = JSON.parse(readFileSync(reportFile, "utf8")) as Report;
  const { missing, unmodelled, perType } = compare(report);

  console.log(
    `Comparing src/device_matrix.ts against app ${report.appVersion}\n`,
  );

  console.log("Rules the app states per device type:");
  for (const row of perType) {
    const app = row.app
      .map((entry) => `${entry.family} ${entry.thresholds.join("/")}`)
      .join(", ");
    const matrix = row.matrix.join("/") || row.matrixMode || "-";
    console.log(
      `  ${row.agrees ? " " : "!"} ${row.profile.padEnd(28)} ${row.axis.padEnd(9)}` +
        ` matrix ${matrix.padEnd(18)} app ${app}`,
    );
  }
  console.log("");

  if (missing.length === 0) {
    console.log(
      "Every firmware threshold in the matrix is still present in the app.",
    );
  } else {
    console.log(
      "Thresholds in the matrix that the app no longer has where expected:",
    );
    for (const entry of missing) {
      const where =
        entry.foundIn.length > 0
          ? `found instead in: ${entry.foundIn.join(", ")}`
          : "not found anywhere in the app";
      console.log(
        `  ${entry.profile.padEnd(24)} ${entry.axis.padEnd(9)} ${String(entry.value).padEnd(7)} ${where}`,
      );
    }
  }

  if (unmodelled.length > 0) {
    console.log("\nThresholds the app has that the matrix does not model:");
    for (const entry of unmodelled) {
      console.log(
        `  ${entry.family.padEnd(12)} ${entry.axis.padEnd(9)} ${entry.values.join(", ")}`,
      );
    }
  }

  console.log(
    "\nBoth lists need a human read before the matrix changes: the app keeps more " +
      "than one routing path, and a number can be shared between families.",
  );
  return missing.length > 0 ? 1 : 0;
}
