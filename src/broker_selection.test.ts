import { test, describe } from "node:test";
import assert from "node:assert";
import {
  resolveBrokerMinVersion,
  isLegacyOnlyDevice,
} from "./broker_selection.js";

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

describe("isLegacyOnlyDevice", () => {
  test("HMI-350 and HMI-500 are legacy-only (route 1)", () => {
    assert.strictEqual(isLegacyOnlyDevice("HMI-350"), true);
    assert.strictEqual(isLegacyOnlyDevice("HMI-500"), true);
  });

  test("is case insensitive and tolerates surrounding whitespace", () => {
    assert.strictEqual(isLegacyOnlyDevice(" hmi-350 "), true);
    assert.strictEqual(isLegacyOnlyDevice("hmi-500"), true);
  });

  test("other HMI models are not legacy-only (route 2)", () => {
    assert.strictEqual(isLegacyOnlyDevice("HMI-2000"), false);
    assert.strictEqual(isLegacyOnlyDevice("HMI-1"), false);
  });

  test("ids containing 350/500 as a substring do not false-match", () => {
    assert.strictEqual(isLegacyOnlyDevice("HMI-3500"), false);
    assert.strictEqual(isLegacyOnlyDevice("HMI-5000"), false);
  });

  test("non-HMI device types are never legacy-only", () => {
    assert.strictEqual(isLegacyOnlyDevice("HMA-350"), false);
    assert.strictEqual(isLegacyOnlyDevice("JPLS-8H"), false);
  });
});
