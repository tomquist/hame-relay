import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  findDecisionSites,
  type DecisionSite,
  type RoutingRule,
} from "./parse.js";
import { ensureDir, type Metadata, paths, RESULTS_DIR } from "./env.js";

/**
 * A routing decision as this project names it. The report deliberately records
 * the *facts* — which firmware numbers a family is routed on — under our own
 * family slugs rather than mirroring the app's internal naming.
 */
export interface RoutingFacts {
  /** Family slug derived from where the decision lives, e.g. `jupiter`. */
  family: string;
  /** `broker` selects the cloud certificate/endpoint, `topic-id` the encryption. */
  axis: "broker" | "topic-id";
  /** Firmware version numbers this decision compares against. */
  thresholds: number[];
  /** Device-type strings the decision branches on. */
  deviceTypes: string[];
  /** String-length checks, already untagged from Dart's small-integer encoding. */
  lengthChecks: number[];
  /**
   * Which device types are routed on which threshold. A rule with no types is
   * one the whole family shares — typically the firmware-line comparison a
   * family makes before it looks at the type at all.
   */
  rules: RoutingRule[];
}

/**
 * Deliberately carries no timestamp: two runs over the same app build produce
 * byte-identical files, so a diff between versions shows only real changes.
 */
export interface Report {
  appVersion: string;
  libappSha256: string;
  dartVersion?: string;
  routing: RoutingFacts[];
}

const FAMILY_PATTERNS: Array<[RegExp, string]> = [
  [/jupiter/iu, "jupiter"],
  [/b2500/iu, "b2500"],
  [/\bct_|ct_version|ct_mqtt/iu, "ct-hme"],
  [/hmi|inveter|inverter/iu, "hmi"],
  [/hmd/iu, "hmd"],
  [/hmg/iu, "hmg"],
  [/vnsd|vnse|vaac|venus|accoupler/iu, "venus"],
  [/mqttutil/iu, "legacy-mqtt"],
  [/common_helper/iu, "common"],
];

function familyOf(site: DecisionSite): string {
  const haystack = `${site.file} ${site.className}`;
  for (const [pattern, slug] of FAMILY_PATTERNS) {
    if (pattern.test(haystack)) {
      return slug;
    }
  }
  return site.className.toLowerCase();
}

/** Version-like literals only: device types such as `HMA-`, not stray text. */
function isDeviceType(literal: string): boolean {
  return /^[A-Z]{2,5}[\d-]*$/u.test(literal);
}

function merge(sites: DecisionSite[]): RoutingFacts[] {
  const byKey = new Map<string, RoutingFacts>();
  for (const site of sites) {
    if (site.thresholds.length === 0) {
      continue;
    }
    const family = familyOf(site);
    const key = `${family}:${site.axis}`;
    const existing = byKey.get(key) ?? {
      family,
      axis: site.axis,
      thresholds: [],
      deviceTypes: [],
      lengthChecks: [],
      rules: [],
    };
    existing.thresholds = [
      ...new Set([...existing.thresholds, ...site.thresholds]),
    ].toSorted((a, b) => a - b);
    existing.deviceTypes = [
      ...new Set([
        ...existing.deviceTypes,
        ...site.literals.filter(isDeviceType),
      ]),
    ].toSorted();
    existing.lengthChecks = [
      ...new Set([
        ...existing.lengthChecks,
        ...site.intCompares
          .filter((c) => c.untagged <= 16)
          .map((c) => c.untagged),
      ]),
    ].toSorted((a, b) => a - b);
    // Several entry points reach the same controller, so the same rule arrives
    // more than once.
    const seen = new Set(
      existing.rules.map((rule) => `${rule.types.join(",")}:${rule.threshold}`),
    );
    for (const rule of site.rules) {
      const ruleKey = `${rule.types.join(",")}:${rule.threshold}`;
      if (!seen.has(ruleKey)) {
        seen.add(ruleKey);
        existing.rules.push(rule);
      }
    }
    byKey.set(key, existing);
  }
  return [...byKey.values()].toSorted((a, b) =>
    `${a.family}:${a.axis}`.localeCompare(`${b.family}:${b.axis}`),
  );
}

export function reportPath(appVersion: string): string {
  return join(RESULTS_DIR, `app-${appVersion}.json`);
}

/**
 * Reads the routing rules out of the disassembly and writes them to
 * `results/app-<version>.json`. That file is the committed artifact: numbers
 * and device types, no disassembly and no app source structure.
 */
export function report(): Report {
  const appRoot = join(paths.asm, "asm", "cross_power_x");
  if (!existsSync(appRoot)) {
    throw new Error(`No disassembly at ${appRoot}. Run "extract" first.`);
  }
  const metadata: Partial<Metadata> = existsSync(paths.metadata)
    ? (JSON.parse(readFileSync(paths.metadata, "utf8")) as Metadata)
    : {};

  const sites = findDecisionSites(appRoot);
  const result: Report = {
    appVersion: metadata.appVersion ?? "unknown",
    libappSha256: metadata.libappSha256 ?? "unknown",
    dartVersion: metadata.dartVersion,
    routing: merge(sites),
  };

  // The full per-method detail stays in the work directory: it is a view of the
  // app's code, useful while investigating a drift and not something to publish.
  ensureDir(paths.asm);
  writeFileSync(
    join(paths.asm, "decision-sites.json"),
    `${JSON.stringify(sites, null, 2)}\n`,
  );
  ensureDir(RESULTS_DIR);
  const out = reportPath(result.appVersion);
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Wrote ${out} (${result.routing.length} routing decisions)`);
  for (const facts of result.routing) {
    console.log(
      `  ${facts.family.padEnd(12)} ${facts.axis.padEnd(9)} ${facts.thresholds.join(", ")}`,
    );
  }
  return result;
}
