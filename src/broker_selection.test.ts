import { test, describe } from "node:test";
import assert from "node:assert";
import { resolveBrokerMinVersion } from "./broker_selection.js";

describe("resolveBrokerMinVersion", () => {
  describe("HMI model-aware override", () => {
    test("HMI-2000 reaches the 2025 broker from firmware 113", () => {
      assert.strictEqual(resolveBrokerMinVersion("HMI-2000", "HMI", 130), 113);
    });

    test("HMI-2000 override ignores the base-type threshold", () => {
      assert.strictEqual(resolveBrokerMinVersion("HMI-2000", "HMI", 999), 113);
    });

    test("HMI-2000 override is case insensitive", () => {
      assert.strictEqual(resolveBrokerMinVersion("hmi-2000", "hmi", 130), 113);
    });

    test("other HMI models use the base-type threshold (130)", () => {
      assert.strictEqual(resolveBrokerMinVersion("HMI-1", "HMI", 130), 130);
    });

    test("ids containing 2000 as a substring do not false-match", () => {
      assert.strictEqual(resolveBrokerMinVersion("HMI-12000", "HMI", 130), 130);
      assert.strictEqual(resolveBrokerMinVersion("HMI-20001", "HMI", 130), 130);
    });
  });

  describe("non-HMI device types pass through unchanged", () => {
    test("HMA uses the configured base-type threshold", () => {
      assert.strictEqual(resolveBrokerMinVersion("HMA-3", "HMA", 226), 226);
    });

    test("JPLS uses the configured base-type threshold", () => {
      assert.strictEqual(resolveBrokerMinVersion("JPLS-8H", "JPLS", 135), 135);
    });
  });
});
