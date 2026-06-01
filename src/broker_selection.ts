/**
 * `brokers.json` `min_versions` are keyed by base type only (e.g. "HMI"), but
 * some device families gate broker selection on the specific model. This
 * resolves the effective minimum firmware for a concrete device type, given the
 * base-type threshold configured in `brokers.json`.
 *
 * @param deviceType The concrete device type identifier (e.g. "HMI-2000").
 * @param baseType The extracted base type (e.g. "HMI").
 * @param baseMin The base-type threshold from `brokers.json` `min_versions`.
 * @returns The effective minimum firmware for broker selection.
 */
export function resolveBrokerMinVersion(
  deviceType: string,
  baseType: string,
  baseMin: number,
): number {
  // HMI-2000 (4-PV) reaches the 2025 broker earlier than other HMI models.
  // Match the model as a whole token so ids like "HMI-12000" don't false-match.
  if (
    baseType.toUpperCase() === "HMI" &&
    /\b2000\b/.test(deviceType.trim().toUpperCase())
  ) {
    return 113;
  }
  return baseMin;
}
