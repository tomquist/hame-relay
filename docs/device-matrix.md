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
| HMG (3-char fw)     | hame-2024 → hame-2025 @153  | 154   | —               | auto        | Venus C / Venus E 2.0; see "Venus release line" |
| HMG (other fw)      | hame-2024 → hame-2025 @153.2| 154.5 | —               | auto        | |
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
| SMR (other)         | hame-2024                   | never | —               | auto        | unrecognised; only those three ship today |
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
| VNSD, VNSA (incl. VNSD2, VNSA2), 3-char fw | hame-2025 | 123 | —          | auto        | Venus series; always 2025; see "Venus release line" |
| VNSD, VNSA (incl. VNSD2, VNSA2), other fw  | hame-2025 | 114.8 | —        | auto        | |
| VNSE3, VNSE3AU, VNSE4, VNSEMAX (3-char fw) | hame-2025 | 123 | —          | auto        | Venus series |
| VNSE3, VNSE3AU, VNSE4, VNSEMAX (other fw)  | hame-2025 | 114.8 | —        | auto        | |
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

## Venus release line

HMG and the Venus series split the same way, on the same rule: `DeviceInfo`
`.isRelease` is true when the reported version is exactly three characters, and
each per-device strategy carries one threshold for that line and another for
everything else. The two are close together rather than in separate ranges — the
HMG broker moves at 153 on the release line and at 153.2 off it — so a version
written with a decimal point is not simply "the same firmware, more precisely":
it is measured against the other line's number. `153.0` reads as 153 and is
still on the 2024 broker; `154.0` reads as 154 and still sends plaintext topic
ids, because off the release line those move at 153.2 and 154.5.

For the Venus topic-id column the two lines are far enough apart that the shape
decides most of the range: a three-character firmware encrypts from 123, and
anything else from 114.8. So a Venus E on `122.9` encrypts where the same
reading on the release line would not. `VNSE3US` and `VNSE3CH` sit above the
whole rule and encrypt at every firmware.

Only `HmgDevStrategy`, `VNSDDevStrategy` and `VnSe3DevStrategy` carry these
thresholds in the app. The Venus models whose strategy answers neither question
(`VNSA`, `VNSD2`, `VNSA2`, `VNSE4`, `VNSEMAX`) are given the same split here on
the assumption that the family shares it.

## Unverified rows

Every other row's broker and topic-id columns have been checked against the app's
own code by *executing* it, most recently against Marstek 1.6.72: `marstool app
run` runs `MqttUtil.isSupportNewMqttCertificate` and the app's per-family
version controllers out of the shipped snapshot, once per device type and
firmware. The topic-id sweep follows `CommonHelper.isSupportVid`'s own dispatch —
each family's `is…` predicate is executed first, and whichever one claims the id
decides which controller answers for it. The Venus families, which that route
could not reach, are answered by building the app's own `DeviceInfo`, asking
`DeviceStrategyFactory` for the strategy it picks, and calling that strategy
directly. Together those sweeps answered 4,420 broker cells and 4,222 topic-id
cells of this table. They disagree with one row, deliberately (see below), and
disagreed with the HMG and Venus release-line thresholds until this table was
corrected to match.

What the app still cannot be made to answer:

- **The broker column of the Venus PV models.** `VNSD`, `VNSD2`, `VNSA`, `VNSA2`
  and `VEPRO` reach their broker rule through a per-device strategy object, and
  theirs extend `BasePVDeviceStrategy`, which carries no such member — so the
  call the app makes has nothing to land on and this group's `hame-2025` rests on
  a reading of the app's code rather than on running it. The rest of the family
  does answer: the strategies that extend `BaseDeviceStrategy` — `VNSE3` and its
  variants, `VNSE4`, `VNSEMAX`, `VAAC2`, and the bare base object `VDAC` is
  handed — answer `hame-2025` at every firmware, and `HmgDevStrategy` answers
  with HMG's migration at fw 153 (153.2 off the release line). `VNSG`, `VNSGPV`,
  `VNSEMINI` and `VNSB` are *not* in this group either: the factory hands them
  the unknown-device strategy, so the app answers for them through its own rule,
  and agrees.
- **The topic-id column of the Venus models without a strategy of their own.**
  `VNSA`, `VNSD2`, `VNSA2`, `VNSE4`, `VNSEMAX` and `VAAC2` reach a strategy that
  does not implement it either. `VNSD` and the `VNSE3` models (`VNSE3US` and
  `VNSE3CH` included) do, and are confirmed by execution; the rest are given the
  same numbers on the assumption that the family shares them, and `VAAC2`'s
  `never` is an assumption in the other direction.
- **`VEPRO` and `VDAC`.** The app groups both with the Venus family, while this
  table leaves them to the unknown default. The two agree on the broker and
  differ on topic ids: the default encrypts at any firmware, the Venus rule from
  fw 123 (114.8 off the release line). Neither has been observed on a real
  device, so the default stands until one is.
- **The _unknown_ row, on purpose.** An id the app does not recognise falls
  through its broker rule to `false` — the 2024 broker — where this table assumes
  the 2025 one. Marstek has only added 2025-broker devices since that broker
  shipped, so the assumption is the better guess for hardware newer than the app
  build this was checked against, and it is the one row where disagreeing with
  the app is the point.
- **A firmware the app calls invalid, for the Venus topic-id column.** The app
  treats a version that reads as `0` or `-1` — which includes one it cannot parse
  at all — as no version, and each Venus strategy then answers from a constant
  rather than from its threshold: `VNSD` and the `VNSE3` models encrypt topic
  ids, `HmgDevStrategy` does not. This table has no such constant and answers
  from the thresholds, so it says plaintext for all of them. No device reaches it
  in that state — an unreadable version is read as fw 1 before the table is
  consulted, and a device reported at version 0 is never asked the topic-id
  question at all — so the two differ only on paper.

The `inverse` column, the `remote-topic-id` column and the AstraMeter
placeholder-MAC rule are Hame Relay's own handling rather than app behaviour, and
cannot be confirmed from the app at all.

## Matching precedence

A device type is matched most-specific first:

1. Exact identifiers — `HME-2`/`HME-4`, `HME-3`/`HME-5`, `TPM-CN`, `TPM2-0`,
   `SMR-0`/`SMR-1`/`SMR-2`.
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
   - The exact `TPM2-0` and `SMR-0/1/2` ids before their `TPM2` and `SMR`
     catch-alls, which answer for the ids the app does not recognise.
4. Base-type prefixes — `HMA`, `HMB`, `HMF`, `HMK`, `HMJ`, `HMG`, `HMM`, `HMN`,
   `JPLS`, `HMD`, `HME`, `HMH`, `SDH`, `VENX`, `SMR`, `HMC`, `SCH`, `HML`,
   `UB`, `TPM2`, `VNS`, `VAAC2`.
5. Unknown — assume a `hame-2025`, topic-encryption-capable device.

## AstraMeter placeholder devices

HME devices reported by the Marstek cloud with a synthetic "managed" MAC
(`02b250` + 6 hex nibbles) are not real hardware on local MQTT. For these,
inverse forwarding is disabled and the remote id is derived from the broker's
topic encryption key rather than the salt-based `cq` method.
