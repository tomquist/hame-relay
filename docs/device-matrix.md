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
| HMM                 | hame-2024 → hame-2025 @135  | 136   | —               | auto        | |
| HMN                 | hame-2024 → hame-2025 @135  | 136   | —               | auto        | |
| JPLS (`JPLS-NH`)    | hame-2024 → hame-2025 @135  | 136   | —               | auto        | |
| HMD-V, HMD-N        | hame-2025                   | never | —               | auto        | V6000 / M5000 outdoor power |
| HMD (other)         | hame-2024 → hame-2025 @155  | never | —               | auto        | outdoor power station |
| HME (base / other)  | hame-2024                   | never | —               | auto        | AstraMeter family; non-2/3/4/5 |
| HME-2, HME-4        | hame-2024 → hame-2025 @119  | 122   | —               | auto        | AstraMeter family |
| HME-3, HME-5        | hame-2024 → hame-2025 @116  | 120   | —               | auto        | AstraMeter family |
| TPM-CN              | hame-2025                   | 101   | —               | auto        | standalone identifier |
| HMI (regular)       | hame-2024 → hame-2025 @129  | 120   | —               | auto        | |
| HMI-2000            | hame-2024 → hame-2025 @113  | 105   | —               | auto        | 4-PV microinverter |
| HMI-350, HMI-500    | hame-2024                   | never | —               | auto        | "route 1", see #158 / #164 |
| VNSD, VNSA (incl. VNSD2, VNSA2) | hame-2024 → hame-2025 @153 | 123 | —          | auto        | Venus series |
| VNSE3, VNSE4        | hame-2025                   | 123   | —               | auto        | Venus series |
| _unknown_           | hame-2025                   | 0     | —               | auto        | assume a 2025-broker device |

## Matching precedence

A device type is matched most-specific first:

1. Exact identifiers — `HME-2`/`HME-4`, `HME-3`/`HME-5`, `TPM-CN`.
2. Model-token rules (must precede their base prefix):
   - `HMI-350`/`HMI-500` and `HMI-2000`, matched on a whole number token so ids
     like `HMI-3500`, `HMI-5000`, `HMI-12000` or `HMI-20001` fall through to the
     regular HMI profile.
   - `HMD-V*`/`HMD-N*` (V6000 / M5000 sub-types) before base `HMD`.
   - `VNSD`/`VNSA` (incl. `VNSD2`/`VNSA2`) before base `VNS`.
3. Base-type prefixes — `HMA`, `HMB`, `HMF`, `HMK`, `HMJ`, `HMG`, `HMM`, `HMN`,
   `JPLS`, `HMD`, `HME`, `HMI`, `VNS`.
4. Unknown — assume a `hame-2025`, topic-encryption-capable device.

## AstraMeter placeholder devices

HME devices reported by the Marstek cloud with a synthetic "managed" MAC
(`02b250` + 6 hex nibbles) are not real hardware on local MQTT. For these,
inverse forwarding is disabled and the remote id is derived from the broker's
topic encryption key rather than the salt-based `cq` method.
