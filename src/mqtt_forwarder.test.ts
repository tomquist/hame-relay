import { test, describe } from "node:test";
import assert from "node:assert";
import {
  MAX_SUBSCRIPTIONS_PER_CONNECTION,
  MAX_TOPICS_PER_SUBSCRIBE,
  limitToSubscribable,
} from "./mqtt_forwarder.js";

const devices = (count: number) =>
  Array.from({ length: count }, (_, i) => `device-${i}`);

describe("limitToSubscribable", () => {
  test("forwards every device while they fit within the quota", () => {
    for (const count of [0, 1, 8, 9, 49, MAX_SUBSCRIPTIONS_PER_CONNECTION]) {
      const { forwarded, ignored } = limitToSubscribable(devices(count));
      assert.strictEqual(forwarded.length, count);
      assert.deepStrictEqual(ignored, []);
    }
  });

  test("ignores only the devices past the quota, keeping the earlier ones", () => {
    const all = devices(MAX_SUBSCRIPTIONS_PER_CONNECTION + 3);
    const { forwarded, ignored } = limitToSubscribable(all);
    assert.strictEqual(forwarded.length, MAX_SUBSCRIPTIONS_PER_CONNECTION);
    assert.strictEqual(ignored.length, 3);
    assert.deepStrictEqual([...forwarded, ...ignored], all);
  });

  test("never lets a broker exceed the subscription quota", () => {
    for (const count of [51, 100, 250]) {
      const { forwarded } = limitToSubscribable(devices(count));
      assert.ok(
        forwarded.length <= MAX_SUBSCRIPTIONS_PER_CONNECTION,
        `${forwarded.length} subscriptions exceeds the quota`,
      );
    }
  });

  test("honors an explicit maximum", () => {
    assert.deepStrictEqual(limitToSubscribable(devices(4), 2), {
      forwarded: ["device-0", "device-1"],
      ignored: ["device-2", "device-3"],
    });
  });
});

describe("broker quotas", () => {
  test("a full broker's devices are reachable in whole SUBSCRIBE packets", () => {
    // The broker checks the per-connection quota against the count already
    // held, so a packet may only start below the quota. Batching at
    // MAX_TOPICS_PER_SUBSCRIBE must keep every packet of a full broker legal.
    const packetsBeforeLast = Math.floor(
      MAX_SUBSCRIPTIONS_PER_CONNECTION / MAX_TOPICS_PER_SUBSCRIBE,
    );
    assert.ok(
      packetsBeforeLast * MAX_TOPICS_PER_SUBSCRIBE <
        MAX_SUBSCRIPTIONS_PER_CONNECTION,
      "a full broker must not need a packet that starts at the quota",
    );
  });
});
