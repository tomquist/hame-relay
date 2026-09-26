import { test, describe } from "node:test";
import assert from "node:assert";
import {
  MAX_SUBSCRIPTIONS_PER_CONNECTION,
  MAX_TOPICS_PER_SUBSCRIBE,
  limitToSubscribable,
  remoteClientOptions,
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

describe("remoteClientOptions", () => {
  const certs = {
    ca: Buffer.from("ca"),
    cert: Buffer.from("cert"),
    key: Buffer.from("key"),
  };

  test("splits SUBSCRIBE packets to what the broker accepts", () => {
    // Without this the client sends one SUBSCRIBE for the whole device list
    // and the broker drops the connection, which is the bug behind #232.
    const { subscribeBatchSize } = remoteClientOptions(certs, "hm_test");
    assert.ok(
      subscribeBatchSize !== undefined &&
        subscribeBatchSize <= MAX_TOPICS_PER_SUBSCRIBE,
      `SUBSCRIBE packets of ${subscribeBatchSize} topics exceed what the broker accepts`,
    );
  });

  test("connects with the given identity and certificates", () => {
    const options = remoteClientOptions(certs, "hm_test");
    assert.strictEqual(options.clientId, "hm_test");
    assert.strictEqual(options.protocol, "mqtts");
    assert.deepStrictEqual(
      { ca: options.ca, cert: options.cert, key: options.key },
      certs,
    );
  });
});

describe("broker quotas", () => {
  test("a full broker's devices are reachable in whole SUBSCRIBE packets", () => {
    // The broker checks the per-connection quota against the count already
    // held, so every packet must start below it. Only the last packet of a
    // full broker can come close, so that is the one to check.
    const packets = Math.ceil(
      MAX_SUBSCRIPTIONS_PER_CONNECTION / MAX_TOPICS_PER_SUBSCRIBE,
    );
    const subscriptionsHeldBeforeLastPacket =
      (packets - 1) * MAX_TOPICS_PER_SUBSCRIBE;
    assert.ok(
      subscriptionsHeldBeforeLastPacket < MAX_SUBSCRIPTIONS_PER_CONNECTION,
      `a full broker's last SUBSCRIBE would start at ${subscriptionsHeldBeforeLastPacket} subscriptions, at or above the quota of ${MAX_SUBSCRIPTIONS_PER_CONNECTION}`,
    );
  });
});
