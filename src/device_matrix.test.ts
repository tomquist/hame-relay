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
    describe("Jupiter devices (JPLS, HMM, HMN) - require firmware >= 136", () => {
      test("true for JPLS at 136, HMM at 140, HMN at 150", () => {
        assert.strictEqual(supportsVid("JPLS", "136"), true);
        assert.strictEqual(supportsVid("HMM", "140"), true);
        assert.strictEqual(supportsVid("HMN", "150"), true);
      });

      test("false for JPLS at 135", () => {
        assert.strictEqual(supportsVid("JPLS", "135"), false);
      });

      test("case insensitive", () => {
        assert.strictEqual(supportsVid("jpls", "136"), true);
        assert.strictEqual(supportsVid("hmm", "136"), true);
      });

      // The app puts a device on the 1xx line only when the raw firmware
      // string is exactly three digits starting with "1", so a value that is
      // numerically inside 136–199 but shaped differently belongs to the 2xx
      // line, where nothing below 236 is encrypted.
      test("versions not shaped like 1xx stay off the encrypted 1xx line", () => {
        assert.strictEqual(supportsVid("JPLS", "136.0"), false);
        assert.strictEqual(supportsVid("HMN", "150.5"), false);
        assert.strictEqual(supportsVid("HMM", "199.9"), false);
      });

      test("the 2xx line is unaffected by shape (>= 236 either way)", () => {
        assert.strictEqual(supportsVid("JPLS", "236.5"), true);
        assert.strictEqual(supportsVid("JPLS", "231.5"), false);
      });
    });

    describe("Jupiter 2xx firmware line - requires firmware >= 236 (#209)", () => {
      test("false across the whole 2xx range below 236", () => {
        assert.strictEqual(supportsVid("JPLS-8H", "200"), false);
        assert.strictEqual(supportsVid("JPLS-8H", "231"), false);
        assert.strictEqual(supportsVid("JPLS-8H", "235.9"), false);
        assert.strictEqual(supportsVid("HMM-1", "231"), false);
        assert.strictEqual(supportsVid("HMN-1", "231"), false);
      });

      test("true at/above 236", () => {
        assert.strictEqual(supportsVid("JPLS-8H", "236"), true);
        assert.strictEqual(supportsVid("HMM-1", "240"), true);
      });

      test("1xx line is unaffected", () => {
        assert.strictEqual(supportsVid("JPLS-8H", "136"), true);
        assert.strictEqual(supportsVid("JPLS-8H", "199"), true);
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

    describe("HME-2, HME-4 - main firmware line requires >= 122", () => {
      test("true at/above 122", () => {
        assert.strictEqual(supportsVid("HME-2", "122"), true);
        assert.strictEqual(supportsVid("HME-4", "125"), true);
      });
      test("false below 122", () => {
        assert.strictEqual(supportsVid("HME-2", "121"), false);
      });
    });

    describe("TPM-CN - require firmware >= 101.0", () => {
      test("true at/above 101", () => {
        assert.strictEqual(supportsVid("TPM-CN", "101.0"), true);
        assert.strictEqual(supportsVid("TPM-CN", "130.0"), true);
      });
      test("false below 101", () => {
        assert.strictEqual(supportsVid("TPM-CN", "100.9"), false);
      });
    });

    describe("TPM2 (CT002 new generation) - always topic-encryption capable", () => {
      test("true at any firmware (threshold 0)", () => {
        assert.strictEqual(supportsVid("TPM2-0", "0"), true);
        assert.strictEqual(supportsVid("TPM2-0", "105.0"), true);
        assert.strictEqual(supportsVid("TPM2-0", "1.0"), true);
      });
      test("case insensitive", () => {
        assert.strictEqual(supportsVid("tpm2-0", "105.0"), true);
      });
    });

    describe("HME-3, HME-5 - main firmware line requires >= 120", () => {
      test("true at/above 120", () => {
        assert.strictEqual(supportsVid("HME-3", "120"), true);
        assert.strictEqual(supportsVid("HME-5", "125"), true);
      });
      test("false below 120", () => {
        assert.strictEqual(supportsVid("HME-3", "119"), false);
        assert.strictEqual(supportsVid("HME-5", "115"), false);
        // At the broker-migration fw (116) the meter moves to the 2025 broker
        // but still does not encrypt topic ids (#145): thresholds are distinct.
        assert.strictEqual(supportsVid("HME-3", "116"), false);
      });
    });

    describe("HME second firmware line - much lower thresholds (#212)", () => {
      test("HME-2/HME-4 encrypt from 25 on the second line", () => {
        assert.strictEqual(supportsVid("HME-2", "24"), false);
        assert.strictEqual(supportsVid("HME-2", "25"), true);
        assert.strictEqual(supportsVid("HME-4", "50"), true);
        assert.strictEqual(supportsVid("HME-2", "99"), true);
      });

      test("HME-3/HME-5 encrypt from 34 on the second line", () => {
        assert.strictEqual(supportsVid("HME-3", "33"), false);
        assert.strictEqual(supportsVid("HME-3", "34"), true);
        assert.strictEqual(supportsVid("HME-5", "50"), true);
        assert.strictEqual(supportsVid("HME-3", "99"), true);
      });

      test("the main line starts over unencrypted at 100", () => {
        assert.strictEqual(supportsVid("HME-2", "100"), false);
        assert.strictEqual(supportsVid("HME-3", "100"), false);
      });

      // Four-digit versions are on the second line again, where everything
      // from 25 / 34 up is encrypted.
      test("four-digit versions stay encrypted", () => {
        assert.strictEqual(supportsVid("HME-2", "1000"), true);
        assert.strictEqual(supportsVid("HME-3", "1000"), true);
      });
    });

    describe("HME base / other generations (non-2/3/4/5) - never supported", () => {
      test("HME-1 and HME-25 never support vid regardless of firmware", () => {
        assert.strictEqual(supportsVid("HME-1", "999"), false);
        assert.strictEqual(supportsVid("HME-25", "999"), false);
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

    test("HMK: hame-2024 below 226, hame-2025 at/above", () => {
      assert.strictEqual(brokerForVersion("HMK-1", 225), "hame-2024");
      assert.strictEqual(brokerForVersion("HMK-1", 226), "hame-2025");
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

    test("Jupiter 2xx firmware line restarts on hame-2024 (#209)", () => {
      // JPLS migrates at 232, HMM/HMN at 230.
      assert.strictEqual(brokerForVersion("JPLS-8H", 200), "hame-2024");
      assert.strictEqual(brokerForVersion("JPLS-8H", 231), "hame-2024");
      assert.strictEqual(brokerForVersion("JPLS-8H", 232), "hame-2025");
      assert.strictEqual(brokerForVersion("HMM-1", 229), "hame-2024");
      assert.strictEqual(brokerForVersion("HMM-1", 230), "hame-2025");
      assert.strictEqual(brokerForVersion("HMN-1", 229), "hame-2024");
      assert.strictEqual(brokerForVersion("HMN-1", 230), "hame-2025");
      // The 1xx line keeps its own thresholds.
      assert.strictEqual(brokerForVersion("JPLS-8H", 199), "hame-2025");
    });

    test("HME-2/HME-4 main line: hame-2024 below 119, hame-2025 at/above (#145)", () => {
      assert.strictEqual(brokerForVersion("HME-2", 118), "hame-2024");
      assert.strictEqual(brokerForVersion("HME-2", 119), "hame-2025");
      assert.strictEqual(brokerForVersion("HME-4", 119), "hame-2025");
    });

    test("HME-3/HME-5 main line: hame-2024 below 116, hame-2025 at/above (#145)", () => {
      assert.strictEqual(brokerForVersion("HME-3", 115), "hame-2024");
      assert.strictEqual(brokerForVersion("HME-3", 116), "hame-2025");
      assert.strictEqual(brokerForVersion("HME-5", 116), "hame-2025");
    });

    test("HME second firmware line migrates far earlier (#212)", () => {
      // HME-2/HME-4 at 24, HME-3/HME-5 at 33 — then the main line starts over
      // on the 2024 broker at 100.
      assert.strictEqual(brokerForVersion("HME-2", 23), "hame-2024");
      assert.strictEqual(brokerForVersion("HME-2", 24), "hame-2025");
      assert.strictEqual(brokerForVersion("HME-4", 99), "hame-2025");
      assert.strictEqual(brokerForVersion("HME-2", 100), "hame-2024");
      assert.strictEqual(brokerForVersion("HME-3", 32), "hame-2024");
      assert.strictEqual(brokerForVersion("HME-3", 33), "hame-2025");
      assert.strictEqual(brokerForVersion("HME-5", 99), "hame-2025");
      assert.strictEqual(brokerForVersion("HME-3", 100), "hame-2024");
      // Four-digit versions are back on the second line, long since migrated.
      assert.strictEqual(brokerForVersion("HME-2", 1000), "hame-2025");
      assert.strictEqual(brokerForVersion("HME-3", 1000), "hame-2025");
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

    test("HMI (regular): hame-2024 below 129, hame-2025 at/above (#173)", () => {
      assert.strictEqual(brokerForVersion("HMI-1", 128), "hame-2024");
      assert.strictEqual(brokerForVersion("HMI-1", 129), "hame-2025");
      // HMI-3500 / HMI-5000 are not route-1 devices; they follow regular HMI.
      assert.strictEqual(brokerForVersion("HMI-3500", 128), "hame-2024");
      assert.strictEqual(brokerForVersion("HMI-3500", 129), "hame-2025");
    });

    test("HMI-2000: hame-2024 below 113, hame-2025 at/above", () => {
      assert.strictEqual(brokerForVersion("HMI-2000", 112), "hame-2024");
      assert.strictEqual(brokerForVersion("HMI-2000", 113), "hame-2025");
    });

    test("HME base (non-2/3/4/5) is always hame-2024", () => {
      assert.strictEqual(brokerForVersion("HME-1", 0), "hame-2024");
      assert.strictEqual(brokerForVersion("HME-1", 999), "hame-2024");
      assert.strictEqual(brokerForVersion("HME", 999), "hame-2024");
    });

    test("HMD-V/HMD-N always hame-2025; other HMD migrates at 155", () => {
      assert.strictEqual(brokerForVersion("HMD-V1", 0), "hame-2025");
      assert.strictEqual(brokerForVersion("HMD-N1", 0), "hame-2025");
      assert.strictEqual(brokerForVersion("HMD-1", 154), "hame-2024");
      assert.strictEqual(brokerForVersion("HMD-1", 155), "hame-2025");
      // Non-target HMD ids (no V/N sub-type token) follow the base HMD route.
      assert.strictEqual(brokerForVersion("HMD-41", 154), "hame-2024");
      assert.strictEqual(brokerForVersion("HMD-41", 155), "hame-2025");
    });

    test("all Venus VNS* types are always hame-2025 (no 2024 migration)", () => {
      // The whole Venus family runs on the 2025 broker at any firmware, including
      // VNSD-0 on firmware 142.
      for (const type of [
        "VNSD-0",
        "VNSA-0",
        "VNSD2-0",
        "VNSA2-0",
        "VNSE3-0",
        "VNSE4-0",
      ]) {
        assert.strictEqual(brokerForVersion(type, 0), "hame-2025", type);
        assert.strictEqual(brokerForVersion(type, 142), "hame-2025", type);
        assert.strictEqual(brokerForVersion(type, 999), "hame-2025", type);
      }
    });

    test("2025-only families are always hame-2025", () => {
      for (const type of [
        "VNSD-0",
        "VNSA-0",
        "VNSD2-0",
        "VNSA2-0",
        "VNSE3-0",
        "VNSE4-0",
        "VDAC-0",
        "VAAC2-0",
        "HMD-V1",
        "HMD-N1",
        "TPM-CN",
        "TPM2-0",
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
        "TPM2-0",
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

    test("TPM2 resolves to its own profile without colliding with TPM-CN", () => {
      assert.strictEqual(resolveProfile("TPM2-0").name, "TPM2");
      assert.strictEqual(resolveProfile("TPM-CN").name, "TPM-CN");
    });

    test("unknown types resolve to the default profile", () => {
      assert.strictEqual(resolveProfile("ZZZ-1").name, "unknown");
      assert.strictEqual(resolveProfile("").name, "unknown");
    });
  });
});
