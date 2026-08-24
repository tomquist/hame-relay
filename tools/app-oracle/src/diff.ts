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
    byName.set(profile.name, {
      name: profile.name,
      family: familyForProfile(profile.name),
      broker: [...new Set(broker)].toSorted((a, b) => a - b),
      topicId: [...new Set(topicId)].toSorted((a, b) => a - b),
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

export interface DiffResult {
  missing: Array<{
    profile: string;
    axis: string;
    value: number;
    foundIn: string[];
  }>;
  unmodelled: Array<{ family: string; axis: string; values: number[] }>;
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
    ] as const) {
      for (const value of values) {
        if (SYNTHETIC_BOUNDARIES.has(value)) {
          continue;
        }
        const foundIn = findThreshold(report.routing, axis, value);
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

  return { missing, unmodelled };
}

/** Prints the comparison; returns a process exit code. */
export function diff(reportFile: string): number {
  if (!existsSync(reportFile)) {
    throw new Error(`No report at ${reportFile}. Run "report" first.`);
  }
  const report = JSON.parse(readFileSync(reportFile, "utf8")) as Report;
  const { missing, unmodelled } = compare(report);

  console.log(
    `Comparing src/device_matrix.ts against app ${report.appVersion}\n`,
  );

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
