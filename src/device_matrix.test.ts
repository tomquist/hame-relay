import { test, describe } from "node:test";
import assert from "node:assert";
import {
  supportsVid,
  brokerForVersion,
  usesRemoteTopicId,
  inverseForwardingPolicy,
  isAstraMeterFamily,
  isAstraMeterSyntheticMac,
  resolveProfile,
} from "./device_matrix.js";

describe("device_matrix", () => {
  describe("supportsVid (salt-based topic encryption threshold)", () => {
    describe("Jupiter devices (JPLS, HMM, HMN) - require firmware >= 136.0", () => {
      test("true for JPLS at 136.0, HMM at 140, HMN at 150.5", () => {
        assert.strictEqual(supportsVid("JPLS", "136.0"), true);
        assert.strictEqual(supportsVid("HMM", "140.0"), true);
        assert.strictEqual(supportsVid("HMN", "150.5"), true);
      });

      test("false for JPLS at 135.9", () => {
        assert.strictEqual(supportsVid("JPLS", "135.9"), false);
      });

      test("case insensitive", () => {
        assert.strictEqual(supportsVid("jpls", "136.0"), true);
        assert.strictEqual(supportsVid("hmm", "136.0"), true);
      });
    });

    describe("HMB/HMA/HMK/HMF devices - require firmware >= 230.0", () => {
      test("true at/above 230", () => {
        assert.strictEqual(supportsVid("HMB", "230.0"), true);
        assert.strictEqual(supportsVid("HMA", "250.1"), true);
        assert.strictEqual(supportsVid("HMK", "235.0"), true);
        assert.strictEqual(supportsVid("HMF", "240.0"), true);
      });

      test("false below 230", () => {
        assert.strictEqual(supportsVid("HMB", "229.9"), false);
      });
    });

    describe("HMJ - require firmware >= 116.0", () => {
      test("true at/above 116", () => {
        assert.strictEqual(supportsVid("HMJ", "116.0"), true);
        assert.strictEqual(supportsVid("HMJ", "120.0"), true);
      });
      test("false below 116", () => {
        assert.strictEqual(supportsVid("HMJ", "115.9"), false);
      });
    });

    describe("HME-2, HME-4, TPM-CN - require firmware >= 122.0", () => {
      test("true at/above 122", () => {
        assert.strictEqual(supportsVid("HME-2", "122.0"), true);
        assert.strictEqual(supportsVid("HME-4", "125.0"), true);
        assert.strictEqual(supportsVid("TPM-CN", "130.0"), true);
      });
      test("false below 122", () => {
        assert.strictEqual(supportsVid("HME-2", "121.9"), false);
        assert.strictEqual(supportsVid("TPM-CN", "121.5"), false);
      });
    });

    describe("HME-3, HME-5 - require firmware >= 120.0", () => {
      test("true at/above 120", () => {
        assert.strictEqual(supportsVid("HME-3", "120.0"), true);
        assert.strictEqual(supportsVid("HME-5", "125.0"), true);
      });
      test("false below 120", () => {
        assert.strictEqual(supportsVid("HME-3", "119.9"), false);
        assert.strictEqual(supportsVid("HME-5", "115.0"), false);
      });
    });

    describe("HME base / other generations - always supported", () => {
      test("HME-1 and HME-25 supported regardless of firmware", () => {
        assert.strictEqual(supportsVid("HME-1", "1"), true);
        assert.strictEqual(supportsVid("HME-25", "1"), true);
      });
    });

    describe("HMG - require firmware >= 154.0", () => {
      test("true at/above 154", () => {
        assert.strictEqual(supportsVid("HMG", "154.0"), true);
        assert.strictEqual(supportsVid("HMG", "160.0"), true);
      });
      test("false below 154", () => {
        assert.strictEqual(supportsVid("HMG", "153.9"), false);
        assert.strictEqual(supportsVid("HMG", "150.0"), false);
      });
      test("case insensitive", () => {
        assert.strictEqual(supportsVid("hmg", "154.0"), true);
        assert.strictEqual(supportsVid("hmg", "153.9"), false);
      });
    });

    describe("HMI devices", () => {
      test("HMI-2000 from 105", () => {
        assert.strictEqual(supportsVid("HMI-2000", "105.0"), true);
        assert.strictEqual(supportsVid("HMI-2000", "104.9"), false);
      });
      test("other HMI from 120", () => {
        assert.strictEqual(supportsVid("HMI-1", "120.0"), true);
        assert.strictEqual(supportsVid("HMI-1", "119.9"), false);
      });
      test("HMI-350 / HMI-500 never support topic encryption", () => {
        assert.strictEqual(supportsVid("HMI-350", "120.0"), false);
        assert.strictEqual(supportsVid("HMI-350", "999.0"), false);
        assert.strictEqual(supportsVid("HMI-500", "120.0"), false);
        assert.strictEqual(supportsVid("HMI-500", "999.0"), false);
      });
      test("ids containing 350/500 as a substring stay on the regular HMI path", () => {
        assert.strictEqual(supportsVid("HMI-3500", "120.0"), true);
        assert.strictEqual(supportsVid("HMI-5000", "119.9"), false);
      });
    });

    describe("Venus series (VNSE3, VNSA, VNSD) - require firmware >= 123.0", () => {
      test("true at/above 123", () => {
        assert.strictEqual(supportsVid("VNSE3", "123.0"), true);
        assert.strictEqual(supportsVid("VNSA", "135.0"), true);
        assert.strictEqual(supportsVid("VNSD", "135.0"), true);
      });
      test("false below 123", () => {
        assert.strictEqual(supportsVid("VNSE3", "122.9"), false);
      });
      test("case insensitive", () => {
        assert.strictEqual(supportsVid("vnse3", "123.0"), true);
        assert.strictEqual(supportsVid("vnsa", "122.9"), false);
      });
    });

    describe("edge cases", () => {
      test("unknown device type is assumed topic-encryption-capable (supported)", () => {
        assert.strictEqual(supportsVid("UNKNOWN", "200.0"), true);
      });
      test("empty vid -> false", () => {
        assert.strictEqual(supportsVid("", "200.0"), false);
      });
      test("empty / invalid firmware -> false", () => {
        assert.strictEqual(supportsVid("HMJ", ""), false);
        assert.strictEqual(supportsVid("HMJ", "invalid"), false);
      });
      test("partially-numeric firmware fails closed", () => {
        assert.strictEqual(supportsVid("HMJ", "116foo"), false);
        assert.strictEqual(supportsVid("HMJ", "120 "), true);
        assert.strictEqual(supportsVid("HMJ", "1.2.3"), false);
      });
      test("null/undefined inputs -> false", () => {
        assert.strictEqual(supportsVid(null as any, "200.0"), false);
        assert.strictEqual(supportsVid("HMJ", null), false);
        assert.strictEqual(supportsVid("HMJ", undefined), false);
      });
      test("accepts numeric firmware versions", () => {
        assert.strictEqual(supportsVid("HMJ", 116), true);
        assert.strictEqual(supportsVid("HMJ", 115), false);
      });
      test("handles decimal versions", () => {
        assert.strictEqual(supportsVid("HMJ", "116.1"), true);
        assert.strictEqual(supportsVid("HMJ", "115.999"), false);
      });
    });
  });

  describe("brokerForVersion (hame-2024 vs hame-2025 broker)", () => {
    test("HMA: hame-2024 below 226, hame-2025 at/above", () => {
      assert.strictEqual(brokerForVersion("HMA-3", 225), "hame-2024");
      assert.strictEqual(brokerForVersion("HMA-3", 226), "hame-2025");
      assert.strictEqual(brokerForVersion("HMA-3", 230), "hame-2025");
    });

    test("HMF: hame-2024 below 226, hame-2025 at/above", () => {
      assert.strictEqual(brokerForVersion("HMF-1", 225), "hame-2024");
      assert.strictEqual(brokerForVersion("HMF-1", 226), "hame-2025");
    });

    test("HMJ: hame-2024 below 108, hame-2025 at/above", () => {
      assert.strictEqual(brokerForVersion("HMJ-1", 107), "hame-2024");
      assert.strictEqual(brokerForVersion("HMJ-1", 108), "hame-2025");
    });

    test("HMG: hame-2024 below 153, hame-2025 at/above", () => {
      assert.strictEqual(brokerForVersion("HMG-50", 152), "hame-2024");
      assert.strictEqual(brokerForVersion("HMG-50", 153), "hame-2025");
    });

    test("HMM/HMN/JPLS: hame-2024 below 135, hame-2025 at/above", () => {
      assert.strictEqual(brokerForVersion("HMM-1", 134), "hame-2024");
      assert.strictEqual(brokerForVersion("HMM-1", 135), "hame-2025");
      assert.strictEqual(brokerForVersion("HMN-1", 134), "hame-2024");
      assert.strictEqual(brokerForVersion("JPLS-8H", 134), "hame-2024");
      assert.strictEqual(brokerForVersion("JPLS-8H", 135), "hame-2025");
    });

    test("HMB: always hame-2024 (never migrates to the 2025 broker)", () => {
      assert.strictEqual(brokerForVersion("HMB-1", 0), "hame-2024");
      assert.strictEqual(brokerForVersion("HMB-1", 999), "hame-2024");
    });

    test("HMI-350 / HMI-500 are always hame-2024 (route 1)", () => {
      assert.strictEqual(brokerForVersion("HMI-350", 0), "hame-2024");
      assert.strictEqual(brokerForVersion("HMI-350", 999), "hame-2024");
      assert.strictEqual(brokerForVersion("HMI-500", 999), "hame-2024");
      assert.strictEqual(brokerForVersion(" hmi-350 ", 999), "hame-2024");
    });

    test("2025-only families are always hame-2025", () => {
      for (const type of [
        "HMK-1",
        "HME-1",
        "HMD-1",
        "HMI-1",
        "HMI-2000",
        "HMI-3500",
        "VNSE3-0",
        "VNSA-0",
        "TPM-CN",
        "UNKNOWN-9",
      ]) {
        assert.strictEqual(brokerForVersion(type, 0), "hame-2025", type);
        assert.strictEqual(brokerForVersion(type, 999), "hame-2025", type);
      }
    });
  });

  describe("usesRemoteTopicId (exact firmware match)", () => {
    test("HMA/HMF/HMK at 226", () => {
      assert.strictEqual(usesRemoteTopicId("HMA-1", 226), true);
      assert.strictEqual(usesRemoteTopicId("HMF-1", 226), true);
      assert.strictEqual(usesRemoteTopicId("HMK-1", 226), true);
      assert.strictEqual(usesRemoteTopicId("HMA-1", 227), false);
      assert.strictEqual(usesRemoteTopicId("HMA-1", 225), false);
    });

    test("HMJ at 108", () => {
      assert.strictEqual(usesRemoteTopicId("HMJ-1", 108), true);
      assert.strictEqual(usesRemoteTopicId("HMJ-1", 109), false);
    });

    test("families without a remote-topic-id list -> false", () => {
      assert.strictEqual(usesRemoteTopicId("HMG-50", 226), false);
      assert.strictEqual(usesRemoteTopicId("HMB-1", 226), false);
      assert.strictEqual(usesRemoteTopicId("UNKNOWN", 226), false);
    });
  });

  describe("inverseForwardingPolicy", () => {
    test("HMA/HMF/HMK/HMJ/HMB are selectable", () => {
      for (const type of ["HMA-1", "HMF-1", "HMK-1", "HMJ-1", "HMB-1"]) {
        assert.strictEqual(inverseForwardingPolicy(type), "selectable", type);
      }
    });

    test("everything else is auto", () => {
      for (const type of [
        "JPLS-8H",
        "HMM-1",
        "HMN-1",
        "HME-1",
        "HMG-50",
        "HMI-1",
        "HMI-350",
        "TPM-CN",
        "VNSE3-0",
        "UNKNOWN",
      ]) {
        assert.strictEqual(inverseForwardingPolicy(type), "auto", type);
      }
    });
  });

  describe("AstraMeter helpers", () => {
    test("isAstraMeterFamily is true only for HME family", () => {
      assert.strictEqual(isAstraMeterFamily("HME-1"), true);
      assert.strictEqual(isAstraMeterFamily("HME-2"), true);
      assert.strictEqual(isAstraMeterFamily("HMA-1"), false);
      assert.strictEqual(isAstraMeterFamily("TPM-CN"), false);
    });

    test("isAstraMeterSyntheticMac matches the 02b250 placeholder pattern", () => {
      assert.strictEqual(isAstraMeterSyntheticMac("02b250abcdef"), true);
      assert.strictEqual(isAstraMeterSyntheticMac("02:B2:50:AB:CD:EF"), true);
      assert.strictEqual(isAstraMeterSyntheticMac("aabbccddeeff"), false);
      assert.strictEqual(isAstraMeterSyntheticMac("02b250abcd"), false);
    });
  });

  describe("resolveProfile precedence", () => {
    test("HMI token rules beat the HMI base entry", () => {
      assert.strictEqual(
        resolveProfile("HMI-350").name,
        "HMI-350/HMI-500 (route 1)",
      );
      assert.strictEqual(resolveProfile("HMI-2000").name, "HMI-2000");
      assert.strictEqual(resolveProfile("HMI-1").name, "HMI");
      // substring-only ids fall through to the regular HMI profile
      assert.strictEqual(resolveProfile("HMI-3500").name, "HMI");
      assert.strictEqual(resolveProfile("HMI-12000").name, "HMI");
    });

    test("HME exact models beat the HME base entry", () => {
      assert.strictEqual(resolveProfile("HME-2").name, "HME-2/HME-4");
      assert.strictEqual(resolveProfile("HME-3").name, "HME-3/HME-5");
      assert.strictEqual(resolveProfile("HME-25").name, "HME");
      assert.strictEqual(resolveProfile("HME-1").name, "HME");
    });

    test("unknown types resolve to the default profile", () => {
      assert.strictEqual(resolveProfile("ZZZ-1").name, "unknown");
      assert.strictEqual(resolveProfile("").name, "unknown");
    });
  });
});
