import { existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";

/** `tools/app-oracle` */
export const TOOL_DIR = resolve(import.meta.dirname, "..");
/** Repository root, so the CLI can be run from anywhere. */
export const REPO_ROOT = resolve(TOOL_DIR, "..", "..");
/**
 * Everything derived from the app lands here and never leaves the machine:
 * the XAPK, the extracted `libapp.so`, and blutter's disassembly. Gitignored.
 */
export const WORK_DIR = process.env.ORACLE_WORK_DIR
  ? resolve(process.env.ORACLE_WORK_DIR)
  : join(TOOL_DIR, "work");
/** Derived tables — the only output that is committed. */
export const RESULTS_DIR = join(TOOL_DIR, "results");

export const APP_PACKAGE = "com.hamedata.marstek";
export const APP_ABI = "arm64-v8a";

export const paths = {
  bin: join(WORK_DIR, "bin"),
  apk: join(WORK_DIR, "apk"),
  unpacked: join(WORK_DIR, "unpacked"),
  libs: join(WORK_DIR, "unpacked", "lib", APP_ABI),
  blutter: join(WORK_DIR, "blutter"),
  asm: join(WORK_DIR, "asm-out"),
  metadata: join(WORK_DIR, "metadata.json"),
};

export function ensureDir(path: string): string {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
  return path;
}

export interface Metadata {
  /** App version as published, e.g. "1.6.72". */
  appVersion: string;
  /** sha256 of libapp.so — the real identity of a build. */
  libappSha256: string;
  /** Dart version the app was compiled with, e.g. "3.8.1". */
  dartVersion?: string;
  /** Snapshot hash reported by blutter; changes with the Dart VM version. */
  snapshotHash?: string;
  pulledAt: string;
}
