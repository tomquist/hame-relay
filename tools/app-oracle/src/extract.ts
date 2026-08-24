import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { runOrThrow } from "./exec.js";
import { ensureDir, type Metadata, paths } from "./env.js";

const BLUTTER_REPO = "https://github.com/worawit/blutter.git";

async function ensureBlutter(): Promise<void> {
  if (existsSync(join(paths.blutter, "blutter.py"))) {
    return;
  }
  ensureDir(paths.blutter);
  console.log("Cloning blutter...");
  await runOrThrow("git", [
    "clone",
    "--depth",
    "1",
    BLUTTER_REPO,
    paths.blutter,
  ]);
}

/**
 * blutter prints what it detected before it starts building, e.g.
 * `Dart version: 3.8.1, Snapshot: <hash>, Target: android arm64`. Recording it
 * pins each results file to the runtime the app was compiled against: a change
 * here means the whole disassembly moved, not just a threshold.
 */
function parseBanner(
  output: string,
): Pick<Metadata, "dartVersion" | "snapshotHash"> {
  const match = /Dart version:\s*([\d.]+),\s*Snapshot:\s*([0-9a-f]+)/u.exec(
    output,
  );
  return match ? { dartVersion: match[1], snapshotHash: match[2] } : {};
}

/**
 * Runs blutter over the unpacked libraries. The first run also builds a Dart VM
 * matching the app's Dart version, which takes several minutes; later runs
 * reuse it.
 */
export async function extract(): Promise<void> {
  if (!existsSync(join(paths.libs, "libapp.so"))) {
    throw new Error(`No libapp.so in ${paths.libs}. Run "pull" first.`);
  }
  await ensureBlutter();
  ensureDir(paths.asm);

  console.log(
    "Running blutter (first run builds a Dart VM — several minutes)...",
  );
  const { stdout } = await runOrThrow("python3", [
    join(paths.blutter, "blutter.py"),
    paths.libs,
    paths.asm,
  ]);

  if (existsSync(paths.metadata)) {
    const metadata = JSON.parse(
      readFileSync(paths.metadata, "utf8"),
    ) as Metadata;
    writeFileSync(
      paths.metadata,
      `${JSON.stringify({ ...metadata, ...parseBanner(stdout) }, null, 2)}\n`,
    );
  }
  console.log(`Disassembly written to ${paths.asm}`);
}
