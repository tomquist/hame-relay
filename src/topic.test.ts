import { test, describe } from "node:test";
import assert from "node:assert";
import { CommonHelper } from "./topic.js";
import { knownDeviceTypes } from "./types.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadSensitiveTestData(): any {
  try {
    const localFilePath = join(process.cwd(), "test-data.json");
    try {
      const fileContent = readFileSync(localFilePath, "utf8");
      console.log("📍 Loading sensitive test data from local file");
      return JSON.parse(fileContent);
    } catch {
      // File doesn't exist or can't be read - this is expected in public CI
      console.log("ℹ️  No sensitive test data available");
      return null;
    }
  } catch (error) {
    console.warn(
      "⚠️  Failed to load sensitive test data:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/**
 * Test cases for the CommonHelper.cq method
 * These tests verify that the TypeScript conversion maintains the same functionality
 * as the original JavaScript implementation.
 *
 * Note: device-type / firmware support logic (formerly CommonHelper.isSupportVid)
 * now lives in `device_matrix.ts` and is covered by `device_matrix.test.ts`.
 */

describe("CommonHelper", () => {
  describe("known device types", () => {
    test("should include JPLS-6H as a supported Jupiter device type", () => {
      assert.strictEqual(knownDeviceTypes.includes("JPLS-6H"), true);
    });

    test("should keep JPLS-8H as a supported Jupiter device type", () => {
      assert.strictEqual(knownDeviceTypes.includes("JPLS-8H"), true);
    });
  });

  describe("cq method", () => {
    test("should return LV9VDVC0S03VDVlVTVTVK0q0 for test case 1", () => {
      const result = CommonHelper.cq(
        "abc123def456789a",
        "112233445566",
        "HMG-50",
      );
      assert.strictEqual(result, "LV9VDVC0S03VDVlVTVTVK0q0");
    });

    test("should return HVe0ZVW0Y0jVBVRVC0DVC0pV for test case 2", () => {
      const result = CommonHelper.cq(
        "fedcba9876543210",
        "aabbccddeeff",
        "HMG-50",
      );
      assert.strictEqual(result, "HVe0ZVW0Y0jVBVRVC0DVC0pV");
    });

    test("should return C0q0a0w03VdVZVhVc0lVlVE0 for test case 3", () => {
      const result = CommonHelper.cq(
        "1234567890abcdef",
        "001122334455",
        "HMG-50",
      );
      assert.strictEqual(result, "C0q0a0w03VdVZVhVc0lVlVE0");
    });

    test("should return I0a0i03VRVO0w09Vk0BV80g0 for test case 4 (edge case: parsed % 5 === 0)", () => {
      const result = CommonHelper.cq(
        "sample123456782d",
        "aabbccdd1234",
        "HMG-50",
      );
      assert.strictEqual(result, "I0a0i03VRVO0w09Vk0BV80g0");
    });

    // Load sensitive test cases from environment variable (GitHub secret or local file)
    const sensitiveTestData = loadSensitiveTestData();
    if (sensitiveTestData && sensitiveTestData.realTestCases) {
      sensitiveTestData.realTestCases.forEach(
        (testCase: any, _index: number) => {
          test(`should return ${testCase.expected} for ${testCase.name}`, () => {
            const result = CommonHelper.cq(
              testCase.input.salt,
              testCase.input.mac,
              testCase.input.vid,
            );
            assert.strictEqual(result, testCase.expected);
          });
        },
      );
    }

    test("should return empty string when MAC is too short", () => {
      const result = CommonHelper.cq("abc123def456789a", "abc", "HMG-50");
      assert.strictEqual(result, "");
    });

    test("should handle empty salt without throwing error", () => {
      assert.doesNotThrow(() => {
        const result = CommonHelper.cq("", "112233445566", "HMG-50");
        assert.strictEqual(typeof result, "string");
        assert.ok(result.length >= 0);
      });
    });

    test("should handle empty vid without throwing error", () => {
      assert.doesNotThrow(() => {
        const result = CommonHelper.cq("abc123def456789a", "112233445566", "");
        assert.strictEqual(typeof result, "string");
        assert.ok(result.length >= 0);
      });
    });
  });

  describe("resolveTopicId method", () => {
    const MAC = "112233445566";
    const TYPE = "HMI-1";

    test("uses the issued salt when both halves agree", () => {
      const result = CommonHelper.resolveTopicId(
        "abc123def456789a,abc123def456789a",
        MAC,
        TYPE,
      );
      assert.strictEqual(result.kind, "confirmed");
      assert.strictEqual(
        result.id,
        CommonHelper.cq("abc123def456789a", MAC, TYPE),
      );
    });

    // A rotation in progress: a new salt has been issued, but the device still
    // answers on the id from the old one until it is told otherwise.
    test("keeps the old id while the salts differ", () => {
      const result = CommonHelper.resolveTopicId("oldsalt,newsalt", MAC, TYPE);
      assert.strictEqual(result.kind, "rotating");
      assert.strictEqual(result.id, CommonHelper.cq("oldsalt", MAC, TYPE));
    });

    // The regression behind #182: hashing the literal "0" yields a plausible
    // 24-character id that nothing on the cloud is listening to.
    test("reports no id when the device is not on one yet", () => {
      const result = CommonHelper.resolveTopicId("0,newsalt", MAC, TYPE);
      assert.strictEqual(result.kind, "pending");
      assert.strictEqual(result.id, undefined);
      assert.notStrictEqual(CommonHelper.cq("0", MAC, TYPE), "");
    });

    // A third value is ignored rather than rejected: only the first two slots
    // mean anything, and refusing the pair would strand a device that has a
    // perfectly good id in them.
    test("reads the first two halves of a longer list", () => {
      const result = CommonHelper.resolveTopicId(
        "oldsalt,newsalt,extra",
        MAC,
        TYPE,
      );
      assert.strictEqual(result.kind, "rotating");
      assert.strictEqual(result.id, CommonHelper.cq("oldsalt", MAC, TYPE));
    });

    test("reports no id for a pair that carries none", () => {
      for (const pair of ["salt,", "salt,0", ",", "0,", ",issued", ",,"]) {
        const result = CommonHelper.resolveTopicId(pair, MAC, TYPE);
        assert.strictEqual(result.id, undefined, `for "${pair}"`);
      }
    });

    test("reports no id when there is no pair at all", () => {
      for (const pair of ["", "onlysalt", null as any, undefined as any]) {
        const result = CommonHelper.resolveTopicId(pair, MAC, TYPE);
        assert.strictEqual(result.kind, "unusable", `for "${pair}"`);
        assert.strictEqual(result.id, undefined);
      }
    });

    // The cloud has handed out devices with no MAC (#182). cq cannot hash one,
    // and an empty id would subscribe to a topic with an empty segment.
    test("reports no id for a MAC too short to hash", () => {
      const result = CommonHelper.resolveTopicId("salt,salt", "abc", TYPE);
      assert.strictEqual(result.kind, "unusable");
      assert.strictEqual(result.id, undefined);
    });

    test("does not trim, because the app does not either", () => {
      const padded = CommonHelper.resolveTopicId(" salt , salt ", MAC, TYPE);
      assert.strictEqual(padded.kind, "confirmed");
      assert.strictEqual(padded.id, CommonHelper.cq(" salt ", MAC, TYPE));
    });
  });
});
