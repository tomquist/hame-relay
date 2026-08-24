import { createHash } from "crypto";
import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { runOrThrow, run } from "./exec.js";
import {
  APP_ABI,
  APP_PACKAGE,
  ensureDir,
  type Metadata,
  paths,
} from "./env.js";

const APKEEP_RELEASE =
  "https://github.com/EFForg/apkeep/releases/latest/download";

function apkeepAsset(): string {
  switch (process.arch) {
    case "x64": {
      return "apkeep-x86_64-unknown-linux-gnu";
    }
    case "arm64": {
      return "apkeep-aarch64-unknown-linux-gnu";
    }
    default: {
      throw new Error(
        `No apkeep build for ${process.arch}; pass --apk with a locally downloaded XAPK instead.`,
      );
    }
  }
}

async function ensureApkeep(): Promise<string> {
  const target = join(ensureDir(paths.bin), "apkeep");
  if (existsSync(target)) {
    return target;
  }
  console.log("Downloading apkeep...");
  await runOrThrow("curl", [
    "-sSfL",
    "-o",
    target,
    `${APKEEP_RELEASE}/${apkeepAsset()}`,
  ]);
  chmodSync(target, 0o755);
  return target;
}

/**
 * The newest version APKPure lists. Pinning it explicitly (rather than letting
 * apkeep pick) is what puts a version number in the results file, so a table
 * can be attributed to the build it came from.
 */
async function latestVersion(apkeep: string): Promise<string> {
  const { stdout } = await runOrThrow(apkeep, ["-l", "-a", APP_PACKAGE], {
    quiet: true,
  });
  const versions = stdout
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .flatMap((line) => line.replace("|", "").split(","))
    .map((v) => v.trim())
    .filter((v) => /^[\d.]+$/u.test(v));
  const latest = versions.at(-1);
  if (!latest) {
    throw new Error(`Could not read a version list for ${APP_PACKAGE}`);
  }
  return latest;
}

function newestFile(dir: string, extensions: string[]): string | null {
  if (!existsSync(dir)) {
    return null;
  }
  const candidates = readdirSync(dir)
    .filter((name) => extensions.some((ext) => name.endsWith(ext)))
    .map((name) => join(dir, name))
    .toSorted((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] ?? null;
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export interface PullOptions {
  version?: string;
  apk?: string;
}

/**
 * Fetches the app and unpacks the two native libraries blutter needs. Both
 * must come from the same build, so they are always taken from one archive.
 */
export async function pull(options: PullOptions = {}): Promise<Metadata> {
  ensureDir(paths.apk);
  let archive = options.apk;
  let version = options.version ?? "unknown";

  if (archive) {
    console.log(`Using local archive ${archive}`);
  } else {
    const apkeep = await ensureApkeep();
    if (!options.version) {
      version = await latestVersion(apkeep);
      console.log(`Latest published version: ${version}`);
    }
    console.log(`Downloading ${APP_PACKAGE}@${version} (${APP_ABI})...`);
    await runOrThrow(apkeep, [
      "-a",
      `${APP_PACKAGE}@${version}`,
      "-o",
      `arch=${APP_ABI}`,
      paths.apk,
    ]);
    archive = newestFile(paths.apk, [".xapk", ".apk"]) ?? undefined;
    if (!archive) {
      throw new Error(
        `apkeep reported success but no archive appeared in ${paths.apk}. ` +
          `The ${APP_ABI} split may not exist for version ${version}.`,
      );
    }
  }

  ensureDir(paths.unpacked);
  // An XAPK is a bundle of split APKs: the base carries the Dart/Flutter glue,
  // and the per-ABI split carries libapp.so + libflutter.so.
  await run("unzip", ["-o", "-q", archive, "-d", paths.unpacked]);
  const abiSplit = join(
    paths.unpacked,
    `config.${APP_ABI.replaceAll("-", "_")}.apk`,
  );
  const source = existsSync(abiSplit) ? abiSplit : archive;
  await runOrThrow("unzip", [
    "-o",
    "-q",
    source,
    "lib/*",
    "-d",
    paths.unpacked,
  ]);

  const libapp = join(paths.libs, "libapp.so");
  const libflutter = join(paths.libs, "libflutter.so");
  for (const lib of [libapp, libflutter]) {
    if (!existsSync(lib)) {
      throw new Error(
        `${lib} missing after unpacking ${source}. blutter needs libapp.so and ` +
          `libflutter.so from the same build.`,
      );
    }
  }

  const metadata: Metadata = {
    appVersion: version,
    libappSha256: sha256(libapp),
    pulledAt: new Date().toISOString(),
  };
  writeFileSync(paths.metadata, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(
    `Unpacked ${APP_ABI} libraries for ${version} (libapp.so ${metadata.libappSha256.slice(0, 12)})`,
  );
  return metadata;
}
