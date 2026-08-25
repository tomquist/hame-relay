import { test, describe } from "node:test";
import assert from "node:assert";
import {
  MAX_SUBSCRIPTIONS_PER_CONNECTION,
  MAX_TOPICS_PER_SUBSCRIBE,
  splitIntoConnections,
} from "./subscriptions.js";

const devices = (count: number) =>
  Array.from({ length: count }, (_, i) => `device-${i}`);

describe("splitIntoConnections", () => {
  test("keeps a single connection while the devices fit into one", () => {
    for (const count of [1, 8, 9, 49, MAX_SUBSCRIPTIONS_PER_CONNECTION]) {
      const groups = splitIntoConnections(devices(count));
      assert.strictEqual(
        groups.length,
        1,
        `${count} devices should need one connection`,
      );
      assert.strictEqual(groups[0].length, count);
    }
  });

  test("opens another connection once the devices no longer fit", () => {
    const groups = splitIntoConnections(
      devices(MAX_SUBSCRIPTIONS_PER_CONNECTION + 1),
    );
    assert.strictEqual(groups.length, 2);
    assert.strictEqual(groups[0].length, MAX_SUBSCRIPTIONS_PER_CONNECTION);
    assert.strictEqual(groups[1].length, 1);
  });

  test("no connection exceeds the broker's subscription quota", () => {
    for (const count of [51, 100, 101, 250]) {
      const groups = splitIntoConnections(devices(count));
      for (const group of groups) {
        assert.ok(
          group.length <= MAX_SUBSCRIPTIONS_PER_CONNECTION,
          `${group.length} devices on one connection exceeds the quota`,
        );
      }
      assert.strictEqual(
        groups.reduce((sum, group) => sum + group.length, 0),
        count,
        "every device must be assigned to a connection",
      );
    }
  });

  test("assigns each device to exactly one connection, in order", () => {
    const all = devices(120);
    const groups = splitIntoConnections(all);
    assert.deepStrictEqual(groups.flat(), all);
  });

  test("returns one empty connection for a broker without devices", () => {
    assert.deepStrictEqual(splitIntoConnections([]), [[]]);
  });

  test("honors an explicit maximum", () => {
    assert.deepStrictEqual(splitIntoConnections(devices(5), 2), [
      ["device-0", "device-1"],
      ["device-2", "device-3"],
      ["device-4"],
    ]);
  });

  test("rejects a maximum below one instead of looping forever", () => {
    assert.throws(() => splitIntoConnections(devices(3), 0), /at least 1/u);
  });
});

describe("broker quotas", () => {
  test("a connection's subscriptions are reachable in whole SUBSCRIBE packets", () => {
    // The broker checks the per-connection quota against the count already
    // held, so the last packet may only start below the quota. Batches of
    // MAX_TOPICS_PER_SUBSCRIBE must therefore land on or below it.
    const packetsBeforeLast = Math.floor(
      MAX_SUBSCRIPTIONS_PER_CONNECTION / MAX_TOPICS_PER_SUBSCRIBE,
    );
    assert.ok(
      packetsBeforeLast * MAX_TOPICS_PER_SUBSCRIBE <
        MAX_SUBSCRIPTIONS_PER_CONNECTION,
      "a full connection must not need a packet that starts at the quota",
    );
  });
});
