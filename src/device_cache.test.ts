import { test, describe } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadDeviceCache, saveDeviceCache } from "./device_cache.js";
import { type DeviceInfo } from "./hame_api.js";

const device: DeviceInfo = {
  devid: "0123456789abcdef01234567",
  name: "Inverter",
  mac: "aabbccddeeff",
  type: "HMI-1",
  version: "132",
  salt: "abc,abc",
};

function cachePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "hame-relay-cache-"));
  return join(dir, "cache.json");
}

describe("device cache", () => {
  test("returns what was saved for the same account", () => {
    const path = cachePath();
    const savedAt = new Date("2026-11-27T10:00:00.000Z");
    saveDeviceCache(path, "user@example.com", [device], savedAt);

    const cache = loadDeviceCache(path, "user@example.com");
    assert.ok(cache);
    assert.deepStrictEqual(cache.devices, [device]);
    assert.strictEqual(cache.saved_at, savedAt.toISOString());
  });

  test("matches the account regardless of case and surrounding spaces", () => {
    const path = cachePath();
    saveDeviceCache(path, "User@Example.com", [device]);
    assert.ok(loadDeviceCache(path, " user@example.com "));
  });

  test("ignores a list saved for another account", () => {
    const path = cachePath();
    saveDeviceCache(path, "user@example.com", [device]);
    assert.strictEqual(loadDeviceCache(path, "other@example.com"), undefined);
  });

  test("does not store the e-mail address or the cloud's MQTT status", () => {
    const path = cachePath();
    saveDeviceCache(path, "user@example.com", [
      { ...device, cloud_mqtt: { mqtt: 1 } },
    ]);
    const raw = readFileSync(path, "utf8");
    assert.ok(!raw.includes("example.com"));
    assert.ok(!raw.includes("cloud_mqtt"));
  });

  test("is readable by its owner only", () => {
    const path = cachePath();
    saveDeviceCache(path, "user@example.com", [device]);
    assert.strictEqual(statSync(path).mode & 0o777, 0o600);
  });

  test("treats a missing, corrupt or empty cache as no cache", () => {
    const path = cachePath();
    assert.strictEqual(loadDeviceCache(path, "user@example.com"), undefined);

    writeFileSync(path, "{not json");
    assert.strictEqual(loadDeviceCache(path, "user@example.com"), undefined);

    saveDeviceCache(path, "user@example.com", []);
    assert.strictEqual(loadDeviceCache(path, "user@example.com"), undefined);
  });

  test("rejects a cache whose devices lack required fields", () => {
    const path = cachePath();
    saveDeviceCache(path, "user@example.com", [device]);
    const cache = JSON.parse(readFileSync(path, "utf8"));
    delete cache.devices[0].mac;
    writeFileSync(path, JSON.stringify(cache));
    assert.strictEqual(loadDeviceCache(path, "user@example.com"), undefined);
  });
});
