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
    } catch (fileError) {
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
        (testCase: any, index: number) => {
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

  describe("extractFirstSalt method", () => {
    test("should extract first salt from comma-separated pair", () => {
      assert.strictEqual(CommonHelper.extractFirstSalt("salt1,salt2"), "salt1");
      assert.strictEqual(
        CommonHelper.extractFirstSalt("first,second,third"),
        "first",
      );
    });

    test("should handle single salt value", () => {
      assert.strictEqual(CommonHelper.extractFirstSalt("onlysalt"), "onlysalt");
    });

    test("should handle salt with whitespace", () => {
      assert.strictEqual(
        CommonHelper.extractFirstSalt(" salt1 , salt2 "),
        "salt1",
      );
      assert.strictEqual(
        CommonHelper.extractFirstSalt("  trimmed  ,  other  "),
        "trimmed",
      );
    });

    test("should return empty string for invalid input", () => {
      assert.strictEqual(CommonHelper.extractFirstSalt(""), "");
      assert.strictEqual(CommonHelper.extractFirstSalt(null as any), "");
      assert.strictEqual(CommonHelper.extractFirstSalt(undefined as any), "");
    });

    test("should handle edge cases", () => {
      assert.strictEqual(CommonHelper.extractFirstSalt(",second"), "");
      assert.strictEqual(CommonHelper.extractFirstSalt("first,"), "first");
      assert.strictEqual(CommonHelper.extractFirstSalt(","), "");
    });
  });
});
