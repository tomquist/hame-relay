# Device support matrix

This table describes how Hame Relay treats each Marstek/Hame device family
depending on its firmware version: which cloud broker it talks to, when it
switches to encrypted topic ids, and how forwarding is configured.

> **Source of truth:** the authoritative implementation is
> [`src/device_matrix.ts`](../src/device_matrix.ts). This document is a
> human-readable mirror of that table — keep the two in sync when either
> changes.

## Legend

- **Broker** — which broker generation serves the device:
  - `modern` — always the `hame-2025` broker (encrypted topics).
  - `legacy@N` — the `hame-2024` broker below firmware `N`, the `hame-2025`
    broker at/above `N`.
  - `legacy-only` — always the `hame-2024` broker, regardless of firmware.
- **vid ≥** — minimum firmware for salt-based (`cq`) topic-id encryption.
  `0` means always supported; `never` means never.
- **remote-topic-id** — exact firmware versions that make the device use the
  remote (encrypted) topic structure on the local broker.
- **inverse** — forwarding policy:
  - `selectable` — direct forwarding by default; inverse forwarding only for
    device ids listed in `inverse_forwarding_device_ids`.
  - `auto` — always inverse forwarding.

## Matrix

| Device              | Broker        | vid ≥ | remote-topic-id | inverse     | Notes |
|---------------------|---------------|-------|-----------------|-------------|-------|
| HMA                 | legacy@226    | 230   | [226]           | selectable  | |
| HMB                 | legacy-only   | 230   | —               | selectable  | never offered the modern broker |
| HMF                 | legacy@226    | 230   | [226]           | selectable  | |
| HMK                 | modern        | 230   | [226]           | selectable  | |
| HMJ                 | legacy@108    | 116   | [108]           | selectable  | |
| HMG                 | legacy@153    | 154   | —               | auto        | |
| HMM                 | legacy@135    | 136   | —               | auto        | |
| HMN                 | legacy@135    | 136   | —               | auto        | |
| JPLS (`JPLS-NH`)    | legacy@135    | 136   | —               | auto        | |
| HMD                 | modern        | 0     | —               | auto        | |
| HME (base / other)  | modern        | 0     | —               | auto        | AstraMeter family |
| HME-2, HME-4        | modern        | 122   | —               | auto        | AstraMeter family |
| HME-3, HME-5        | modern        | 120   | —               | auto        | AstraMeter family |
| TPM-CN              | modern        | 122   | —               | auto        | standalone identifier |
| HMI (regular)       | modern        | 120   | —               | auto        | |
| HMI-2000            | modern        | 105   | —               | auto        | 4-PV microinverter |
| HMI-350, HMI-500    | legacy-only   | never | —               | auto        | "route 1", see #158 / #164 |
| VNSE3, VNSA, VNSD   | modern        | 123   | —               | auto        | Venus series |
| _unknown_           | modern        | 0     | —               | auto        | assume a modern device |

## Matching precedence

A device type is matched most-specific first:

1. Exact identifiers — `HME-2`/`HME-4`, `HME-3`/`HME-5`, `TPM-CN`.
2. HMI model tokens — `HMI-350`/`HMI-500` and `HMI-2000`, matched on a whole
   number token so ids like `HMI-3500`, `HMI-5000`, `HMI-12000` or `HMI-20001`
   fall through to the regular HMI profile.
3. Base-type prefixes — `HMA`, `HMB`, `HMF`, `HMK`, `HMJ`, `HMG`, `HMM`, `HMN`,
   `JPLS`, `HMD`, `HME`, `HMI`, `VNS`.
4. Unknown — assume a modern, topic-encryption-capable device.

## AstraMeter placeholder devices

HME devices reported by the Marstek cloud with a synthetic "managed" MAC
(`02b250` + 6 hex nibbles) are not real hardware on local MQTT. For these,
inverse forwarding is disabled and the remote id is derived from the broker's
topic encryption key rather than the salt-based `cq` method.
