/**
 * Subscription planning for the remote brokers.
 *
 * The remote brokers are AWS IoT Core endpoints, and AWS IoT enforces two
 * subscription quotas that a relay with many devices runs into. Both were
 * measured against the live endpoints of both brokers, which behave
 * identically:
 *
 *   - A single SUBSCRIBE packet may carry at most 8 topic filters. A packet
 *     with 9 or more is not answered with a SUBACK at all — the broker closes
 *     the connection. Because the client reconnects and re-subscribes the same
 *     way, an account with more than 8 devices on one broker never gets past
 *     the handshake and no data is ever exchanged. This is the quota behind
 *     the immediate disconnects reported in #232.
 *   - A single connection may hold at most 50 subscriptions. Beyond it the
 *     broker answers SUBSCRIBE with 0x80 for every filter in the packet and
 *     keeps the connection open, so the devices beyond the quota fail
 *     silently. The check is made per packet against the count already held,
 *     which leaves two ways to exceed it that we deliberately do not use: a
 *     packet that starts below the quota is granted in full even if it ends
 *     above it, and packets sent back to back without waiting for their
 *     SUBACKs are all granted regardless of the quota (a connection can be
 *     made to hold 200 live subscriptions that way). Both work today and are
 *     one server-side change away from not working, so the devices of a
 *     broker are spread over enough connections to stay under the quota
 *     instead.
 *
 * The relay subscribes to exactly one topic per device per broker connection,
 * so the second quota is a cap on devices per connection.
 */
export const MAX_TOPICS_PER_SUBSCRIBE = 8;
export const MAX_SUBSCRIPTIONS_PER_CONNECTION = 50;

/**
 * Splits the devices of one broker into the groups that each remote connection
 * subscribes to. Always returns at least one group, so a broker without
 * devices still gets a connection.
 */
export function splitIntoConnections<T>(
  devices: readonly T[],
  maxPerConnection: number = MAX_SUBSCRIPTIONS_PER_CONNECTION,
): T[][] {
  if (maxPerConnection < 1) {
    throw new Error(
      `Devices per connection must be at least 1, got ${maxPerConnection}`,
    );
  }
  const groups: T[][] = [];
  for (let i = 0; i < devices.length; i += maxPerConnection) {
    groups.push(devices.slice(i, i + maxPerConnection));
  }
  return groups.length > 0 ? groups : [[]];
}
