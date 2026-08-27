# Device support matrix

This table describes how Hame Relay treats each Marstek/Hame device family
depending on its firmware version: which cloud broker it talks to, when it
switches to encrypted topic ids, and how forwarding is configured.

> **Source of truth:** the authoritative implementation is
> [`src/device_matrix.ts`](../src/device_matrix.ts). This document is a
> human-readable mirror of that table — keep the two in sync when either
> changes.

## Legend

- **Broker** — which broker generation serves the device (brokers are named by
  the year they were introduced):
  - `hame-2025` — always the `hame-2025` broker (encrypted topics).
  - `hame-2024 → hame-2025 @N` — the `hame-2024` broker below firmware `N`, the
    `hame-2025` broker at/above `N`.
  - `hame-2024` — always the `hame-2024` broker, regardless of firmware.
- **vid ≥** — minimum firmware for salt-based (`cq`) topic-id encryption.
  `0` means always supported; `never` means never.
- **remote-topic-id** — exact firmware versions that make the device use the
  remote (encrypted) topic structure on the local broker.
- **inverse** — forwarding policy:
  - `selectable` — direct forwarding by default; inverse forwarding only for
    device ids listed in `inverse_forwarding_device_ids`.
  - `auto` — always inverse forwarding.

## Matrix

| Device              | Broker                      | vid ≥ | remote-topic-id | inverse     | Notes |
|---------------------|-----------------------------|-------|-----------------|-------------|-------|
| HMA                 | hame-2024 → hame-2025 @226  | 230   | [226]           | selectable  | |
| HMB                 | hame-2024                   | 230   | —               | selectable  | never offered the 2025 broker |
| HMF                 | hame-2024 → hame-2025 @226  | 230   | [226]           | selectable  | |
| HMK                 | hame-2024 → hame-2025 @226  | 230   | [226]           | selectable  | |
| HMJ                 | hame-2024 → hame-2025 @108  | 116   | [108]           | selectable  | |
| HMG                 | hame-2024 → hame-2025 @153  | 154   | —               | auto        | |
| HMM (1xx-shaped fw) | hame-2024 → hame-2025 @135  | 136   | —               | auto        | see "Jupiter firmware lines" |
| HMM (other fw)      | hame-2024 → hame-2025 @230  | 236   | —               | auto        | |
| HMN (1xx-shaped fw) | hame-2024 → hame-2025 @135  | 136   | —               | auto        | |
| HMN (other fw)      | hame-2024 → hame-2025 @230  | 236   | —               | auto        | |
| JPLS (1xx-shaped fw)| hame-2024 → hame-2025 @135  | 136   | —               | auto        | `JPLS-NH` |
| JPLS (other fw)     | hame-2024 → hame-2025 @232  | 236   | —               | auto        | e.g. Jupiter C Plus, #209 |
| HMD-V               | hame-2025                   | never | —               | auto        | outdoor power station |
| HMD-N               | hame-2024 → hame-2025 @1.42 | never | —               | auto        | outdoor power station |
| HMD (other)         | hame-2024                   | never | —               | auto        | `HMD-1`…`HMD-7`, `HMD-41/61/71/72`, bare `HMD`; never offered the 2025 broker |
| HME (base / other)  | hame-2024                   | never | —               | auto        | AstraMeter family; non-2/3/4/5 |
| HME-2, HME-4 (3-char fw)  | hame-2024 → hame-2025 @119  | 122   | —               | auto        | AstraMeter family; see "CT firmware lines" |
| HME-2, HME-4 (other fw)   | hame-2024 → hame-2025 @24   | 25    | —               | auto        | |
| HME-3, HME-5 (3-char fw)  | hame-2024 → hame-2025 @116  | 120   | —               | auto        | AstraMeter family |
| HME-3, HME-5 (other fw)   | hame-2024 → hame-2025 @33   | 34    | —               | auto        | |
| TPM-CN (3-char fw)  | hame-2025                   | 101   | —               | auto        | standalone identifier; see "CT firmware lines" |
| TPM-CN (other fw)   | hame-2025                   | 0     | —               | auto        | |
| TPM2-0              | hame-2025                   | 0     | —               | auto        | CT002 new generation (#201) |
| TPM2 (other)        | hame-2024                   | never | —               | auto        | unrecognised; only `TPM2-0` ships today |
| SMR-0, SMR-1, SMR-2 | hame-2025                   | 0     | —               | auto        | CT003 meter readers: P1 (NL) / IR (DE) / TIC (FR) |
| HMI-2000, HMI-02KS (fw ≥100)    | hame-2024 → hame-2025 @113  | 105   | —               | auto        | "route 4"; 4-PV microinverter; see "HMI firmware lines" |
| HMI-2000, HMI-02KS (fw <100)    | hame-2025                   | 0     | —               | auto        | second firmware line |
| HMI-350, HMI-500    | hame-2024                   | never | —               | auto        | "route 1", incl. `HMI-350S` / `HMI-500S`; see #158 / #164 |
| HMI (regular, fw ≥100)    | hame-2024 → hame-2025 @129  | 120   | —               | auto        | "route 2": any remaining HMI id containing a digit 1-5 |
| HMI (regular, fw <100)    | hame-2025                   | 0     | —               | auto        | second firmware line |
| HMI (other)         | hame-2024                   | never | —               | auto        | "route 0", e.g. `HMI-6` |
| HMC, SCH, HML, UB   | hame-2024                   | never | —               | auto        | M5000 (`HMC-1/2/7`, `SCH-1`), Mars-A (other HMC) |
| HMHL                | hame-2025                   | 0     | —               | auto        | Mars SE |
| SDH-6K              | hame-2025                   | 0     | —               | auto        | V6000 |
| HMH, SDH, VENX      | hame-2025                   | never | —               | auto        | Mars, M5000 (other SDH), Venus X |
| VNSD, VNSA (incl. VNSD2, VNSA2) | hame-2025      | 123   | —               | auto        | Venus series; always 2025 |
| VNSE3, VNSE3AU, VNSE4, VNSEMAX | hame-2025       | 123   | —               | auto        | Venus series |
| VNSE3US, VNSE3CH    | hame-2025                   | 0     | —               | auto        | Venus series; encrypts unconditionally |
| VNSGPV              | hame-2024                   | never | —               | auto        | Venus G PV; unlike its VNSG sibling |
| VNSG, VNSEMINI, VNSB | hame-2025                  | never | —               | auto        | VNS-prefixed but not Venus devices |
| VAAC2               | hame-2025                   | never | —               | auto        | |
| _unknown_           | hame-2025                   | 0     | —               | auto        | assume a 2025-broker device; incl. `VEPRO`, `VDAC` — but see "Unverified rows" |

## Jupiter firmware lines

The Jupiter family (HMM, HMN, JPLS) ships two independent firmware lines, a
1xx line and a 2xx line (Jupiter C Plus / `JPLS-8H` is on the 2xx line). A 2xx
firmware is not simply "newer" than a 1xx one: the line starts over on the 2024
broker with plaintext topic ids and migrates again at its own thresholds. So a
JPLS on fw 231 is on the 2024 broker without topic encryption, while the same
family on fw 136 is already on the 2025 broker with encrypted topic ids.

The line comes from the *shape* of the reported version, not its value:
`JupiterVersionController.isRelease()` puts a device on the 1xx line only when
the raw firmware string is exactly three digits starting with `1`. The app reads
that once and answers both columns from it, so a version like `150.5` is
second-line firmware on both — the 2024 broker and plaintext topic ids — even
though it reads as 1xx by value. From 200 up the shape stops mattering: the
second line's own thresholds apply either way, which is why `230.5` is on the
2025 broker for HMM and still on the 2024 broker for JPLS.

## HMI firmware lines

The HMI inverters on routes 2 and 4 have the same split, keyed on the numeric
version rather than its shape: `InvertVersionController` compares the parsed
version against 100 *before* the route's own threshold, and anything below it
takes the supported branch on both axes. So an HMI-2000 on fw 50 is on the 2025
broker with encrypted topic ids, while the same inverter on fw 100 is back on
the 2024 broker with plaintext ones until it reaches 113 (129 for route 2).
Routes 0 and 1 return false unconditionally and have no second line.

## CT firmware lines

The CT meters (HME-2/HME-4, HME-3/HME-5 and TPM-CN) share a two-line split. The
line is picked from the *length* of the firmware version string: a three-digit
version (`116`, `119`) is on the main line, any other length (a two-digit
version such as `50`, or a four-digit one) is on the second line, which reached
the 2025 broker and encrypted topic ids at much lower versions. So an HME-2 on
fw 50 is on the 2025 broker with encrypted topic ids, while the same meter on
fw 100 is back on the 2024 broker with plaintext ones (#212). TPM-CN is on the
2025 broker either way, but the same split governs its topic ids: off the main
line it encrypts at any firmware rather than from fw 101.

The table's numbers reproduce that length rule exactly for whole firmware
versions, and the shape of the reported version settles the rest: a version like
`116.5` reads as main-line by value but is five characters, so it is second-line
firmware and takes the second line's thresholds on both columns. The converse
holds too — `1.5` is three characters, so it is main-line firmware and is
measured against the main line's thresholds however low it reads, which for a
TPM-CN means plaintext topic ids rather than the second line's "encrypt at any
version". Neither line is ever measured against the other's thresholds. Zeros at
either end are the one gap: the version reaches the table as a number, so `116.0`
arrives as `116` and `050` as `50`, and each is placed on the line its shortened
shape implies rather than the one the app would pick.

## Unverified rows

The broker and topic-id columns of every other row have been checked against the
app's own code, most recently by *executing* it: `marstool app call` runs
`MqttUtil.isSupportNewMqttCertificate` and the app's per-family version
controllers out of the shipped snapshot, once per device type and firmware. That
sweep answered 2,464 broker cells and 962 topic-id cells of this table, and
disagreed with none of them. What it could not answer:

- **The Venus and HMG broker column.** HMG, `VNSD2`, `VNSA2`, the `VNSE3`
  models, `VNSE4`, `VNSEMAX`, `VAAC2`, `VEPRO` and `VDAC` pick their broker
  through a per-device object the app builds at run time, and the rule dies in
  the app's dependency injection instead of answering for them. Those objects
  can be reached one at a time, but what they say is thinner than it looks: the
  `VNSE3`, `VNSE4`, `VNSEMAX` and `VAAC2` objects share a single inherited
  implementation, which dispatches on the object it is called on, so asking each
  in turn measures one function four times — and on an object built with no
  firmware in it, which is the question that matters. `VNSD2` and `VNSA2` sit on
  a different base and do not answer at all, and HMG's brings the runtime down.
  So this group's `hame-2025` rests on the reading of the app's code, not on
  running it, and HMG's migration at fw 153 remains the one value in it a device
  is most likely to disagree with. `VNSG`, `VNSGPV`, `VNSEMINI` and `VNSB` are
  *not* in this group: the app answers for them, and agrees.
- **The HMI, HMG and Venus topic-id column.** `CommonHelper.isSupportVid` routes
  these through that same run-time dispatch, so those thresholds rest on a
  reading of the app's code rather than on running it. The families whose
  controllers do answer — HMA/HMB/HMF/HMK/HMJ, the Jupiter models, the HME
  meters, TPM-CN, TPM2-0 and the SMR readers — are confirmed by execution, and
  each of them is claimed by exactly one controller, so the dispatch is not in
  doubt for those.
- **`VEPRO` and `VDAC`.** The app groups both with the Venus family, while this
  table leaves them to the unknown default. The two agree on the broker and
  differ on topic ids: the default encrypts at any firmware, the Venus rule from
  fw 123. Neither has been observed on a real device, so the default stands
  until one is.

The `inverse` column and the AstraMeter placeholder-MAC rule are Hame Relay's
own handling rather than app behaviour, and cannot be confirmed from the app at
all.

## Matching precedence

A device type is matched most-specific first:

1. Exact identifiers — `HME-2`/`HME-4`, `HME-3`/`HME-5`, `TPM-CN`, `TPM2-0`.
2. HMI routes, tested in the order 4 → 1 → 2 → 0. The app classifies an HMI id
   by plain **substring**, not by whole token, and checks `2000`/`02KS` before
   `350`/`500` — so `HMI-3500` is route 1 and `HMI-12000` is route 4, not the
   regular HMI profile.
3. Sub-type rules that must precede their base prefix:
   - `HMD-V*` and `HMD-N*` before base `HMD`.
   - `HMHL` before `HMH`.
   - `SDH-6K` before `SDH`.
   - `VNSE3US`/`VNSE3CH` before `VNS`.
   - `VNSGPV` before `VNSG`, and both before `VNS`.
4. Base-type prefixes — `HMA`, `HMB`, `HMF`, `HMK`, `HMJ`, `HMG`, `HMM`, `HMN`,
   `JPLS`, `HMD`, `HME`, `HMH`, `SDH`, `VENX`, `SMR-`, `HMC`, `SCH`, `HML`,
   `UB`, `TPM2`, `VNS`, `VAAC2`.
5. Unknown — assume a `hame-2025`, topic-encryption-capable device.

## AstraMeter placeholder devices

HME devices reported by the Marstek cloud with a synthetic "managed" MAC
(`02b250` + 6 hex nibbles) are not real hardware on local MQTT. For these,
inverse forwarding is disabled and the remote id is derived from the broker's
topic encryption key rather than the salt-based `cq` method.
