import { test, describe } from "node:test";
import assert from "node:assert";
import { CommonHelper } from "./topic.js";
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
 */

describe("CommonHelper", () => {
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

  describe("isSupportVid method", () => {
    describe("Jupiter devices (JPLS, HMM, HMN) - require firmware ≥ 136.0", () => {
      test("should return true for JPLS with firmware 136.0", () => {
        assert.strictEqual(CommonHelper.isSupportVid("JPLS", "136.0"), true);
      });

      test("should return true for HMM with firmware 140.0", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HMM", "140.0"), true);
      });

      test("should return true for HMN with firmware 150.5", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HMN", "150.5"), true);
      });

      test("should return false for JPLS with firmware 135.9", () => {
        assert.strictEqual(CommonHelper.isSupportVid("JPLS", "135.9"), false);
      });

      test("should handle case insensitive VID", () => {
        assert.strictEqual(CommonHelper.isSupportVid("jpls", "136.0"), true);
        assert.strictEqual(CommonHelper.isSupportVid("hmm", "136.0"), true);
      });
    });

    describe("HMB/HMA/HMK/HMF devices - require firmware ≥ 230.0", () => {
      test("should return true for HMB with firmware 230.0", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HMB", "230.0"), true);
      });

      test("should return true for HMA with firmware 250.1", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HMA", "250.1"), true);
      });

      test("should return true for HMK with firmware 235.0", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HMK", "235.0"), true);
      });

      test("should return true for HMF with firmware 240.0", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HMF", "240.0"), true);
      });

      test("should return false for HMB with firmware 229.9", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HMB", "229.9"), false);
      });
    });

    describe("HMJ device - require firmware ≥ 116.0", () => {
      test("should return true for HMJ with firmware 116.0", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HMJ", "116.0"), true);
      });

      test("should return true for HMJ with firmware 120.0", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HMJ", "120.0"), true);
      });

      test("should return false for HMJ with firmware 115.9", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HMJ", "115.9"), false);
      });
    });

    describe("HME-2, HME-4, TPM-CN devices - require firmware ≥ 122.0", () => {
      test("should return true for HME-2 with firmware 122.0", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HME-2", "122.0"), true);
      });

      test("should return true for HME-4 with firmware 125.0", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HME-4", "125.0"), true);
      });

      test("should return true for TPM-CN with firmware 130.0", () => {
        assert.strictEqual(CommonHelper.isSupportVid("TPM-CN", "130.0"), true);
      });

      test("should return false for HME-2 with firmware 121.9", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HME-2", "121.9"), false);
      });

      test("should return false for TPM-CN with firmware 121.5", () => {
        assert.strictEqual(CommonHelper.isSupportVid("TPM-CN", "121.5"), false);
      });
    });

    describe("HME-3, HME-5 devices - require firmware ≥ 120.0", () => {
      test("should return true for HME-3 with firmware 120.0", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HME-3", "120.0"), true);
      });

      test("should return true for HME-5 with firmware 125.0", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HME-5", "125.0"), true);
      });

      test("should return false for HME-3 with firmware 119.9", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HME-3", "119.9"), false);
      });

      test("should return false for HME-5 with firmware 115.0", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HME-5", "115.0"), false);
      });
    });

    describe("HMG device - require firmware ≥ 154.0", () => {
      test("should return true for HMG with firmware 154.0", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HMG", "154.0"), true);
      });

      test("should return true for HMG with firmware 160.0", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HMG", "160.0"), true);
      });

      test("should return false for HMG with firmware 153.9", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HMG", "153.9"), false);
      });

      test("should return false for HMG with firmware 150.0", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HMG", "150.0"), false);
      });

      test("should handle case insensitive HMG VID", () => {
        assert.strictEqual(CommonHelper.isSupportVid("hmg", "154.0"), true);
        assert.strictEqual(CommonHelper.isSupportVid("hmg", "153.9"), false);
      });
    });

    describe("Edge cases and error handling", () => {
      test("should return false for unknown VID", () => {
        assert.strictEqual(
          CommonHelper.isSupportVid("UNKNOWN", "200.0"),
          false,
        );
      });

      test("should return false for empty VID", () => {
        assert.strictEqual(CommonHelper.isSupportVid("", "200.0"), false);
      });

      test("should return false for empty firmware version", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HMJ", ""), false);
      });

      test("should return false for invalid firmware version", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HMJ", "invalid"), false);
      });

      test("should return false for null/undefined inputs", () => {
        assert.strictEqual(
          CommonHelper.isSupportVid(null as any, "200.0"),
          false,
        );
        assert.strictEqual(
          CommonHelper.isSupportVid("HMJ", null as any),
          false,
        );
      });

      test("should handle decimal versions correctly", () => {
        assert.strictEqual(CommonHelper.isSupportVid("HMJ", "116.1"), true);
        assert.strictEqual(CommonHelper.isSupportVid("HMJ", "115.999"), false);
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

  describe("Integration: isSupportVid + cq method", () => {
    test("should use cq method for supported devices", () => {
      // Test with HMJ device that supports firmware >= 116.0
      const isSupported = CommonHelper.isSupportVid("HMJ", "116.0");
      assert.strictEqual(isSupported, true);

      if (isSupported) {
        const salt = CommonHelper.extractFirstSalt(
          "abc123def456789a,othersalt",
        );
        const result = CommonHelper.cq(salt, "112233445566", "HMJ");
        assert.strictEqual(typeof result, "string");
        assert.ok(result.length > 0);
      }
    });

    test("should handle JPLS device with supported firmware", () => {
      const isSupported = CommonHelper.isSupportVid("JPLS", "136.0");
      assert.strictEqual(isSupported, true);

      if (isSupported) {
        const salt = CommonHelper.extractFirstSalt("fedcba9876543210,another");
        const result = CommonHelper.cq(salt, "aabbccddeeff", "JPLS");
        assert.strictEqual(typeof result, "string");
        assert.ok(result.length > 0);
      }
    });

    test("should not use cq method for unsupported devices", () => {
      // Test with HMJ device with too old firmware
      const isSupported = CommonHelper.isSupportVid("HMJ", "115.0");
      assert.strictEqual(isSupported, false);
    });

    test("should not use cq method for unknown device types", () => {
      const isSupported = CommonHelper.isSupportVid("UNKNOWN", "200.0");
      assert.strictEqual(isSupported, false);
    });
  });
});
