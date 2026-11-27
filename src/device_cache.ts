import { createHash } from "crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";
import { type DeviceInfo } from "./hame_api.js";

/**
 * The device list from the last successful login, kept so the relay can still
 * start when the Hame API cannot be reached (#293).
 *
 * It holds what the API returned rather than the relay's derived settings, so
 * broker and topic selection are worked out afresh from it on every start, and
 * fixes to that logic reach cached devices too. The cloud's MQTT status is left
 * out: it describes one moment and would be stale on the next start.
 */
export interface DeviceCache {
  format: 1;
  /** Which account the list belongs to, as a hash so the file carries no e-mail address. */
  account: string;
  /** When the list was fetched (ISO 8601). */
  saved_at: string;
  devices: DeviceInfo[];
}

/** Hash of the account name, trimmed and case-folded as the cloud treats it. */
export function accountKey(username: string): string {
  return createHash("sha256")
    .update(username.trim().toLowerCase())
    .digest("hex");
}

export function saveDeviceCache(
  path: string,
  username: string,
  devices: DeviceInfo[],
  now: Date = new Date(),
): void {
  const cache: DeviceCache = {
    format: 1,
    account: accountKey(username),
    saved_at: now.toISOString(),
    devices: devices.map(({ cloud_mqtt: _status, ...device }) => device),
  };
  mkdirSync(dirname(path), { recursive: true });
  // Written next to the target and renamed over it, so a crash mid-write
  // leaves the previous cache in place rather than a truncated one.
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(cache, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(tmpPath, path);
}

/**
 * The cached device list for this account, or `undefined` when there is none,
 * it belongs to another account, or it cannot be read. A missing or unusable
 * cache is never an error of its own: the caller reports the login failure
 * that made it look.
 */
export function loadDeviceCache(
  path: string,
  username: string,
): DeviceCache | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
  if (!isDeviceCache(parsed) || parsed.account !== accountKey(username)) {
    return undefined;
  }
  return parsed;
}

function isDeviceCache(value: unknown): value is DeviceCache {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const cache = value as Partial<DeviceCache>;
  return (
    cache.format === 1 &&
    typeof cache.account === "string" &&
    typeof cache.saved_at === "string" &&
    Array.isArray(cache.devices) &&
    cache.devices.length > 0 &&
    cache.devices.every(isDeviceInfo)
  );
}

function isDeviceInfo(value: unknown): value is DeviceInfo {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const device = value as Record<string, unknown>;
  return (
    typeof device.devid === "string" &&
    typeof device.mac === "string" &&
    typeof device.type === "string" &&
    typeof device.version === "string" &&
    (device.salt === undefined || typeof device.salt === "string")
  );
}
