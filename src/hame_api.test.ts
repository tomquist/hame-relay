import { test, describe } from "node:test";
import assert from "node:assert";
import { readOnlineFlag, redactSecrets } from "./hame_api.js";

describe("redactSecrets", () => {
  // node-fetch puts the whole URL in its error message, which is how the
  // account's credentials would otherwise reach the log.
  test("masks the credentials a failed request reports back", () => {
    const message =
      "request to https://eu.hamedata.com/ems/api/v1/getDeviceMqttStatus?devid=abc&token=SUPERSECRET failed, reason: getaddrinfo ENOTFOUND";
    const redacted = redactSecrets(message);
    assert.ok(!redacted.includes("SUPERSECRET"));
    assert.ok(redacted.includes("devid=abc"));
    assert.ok(redacted.includes("token=***"));
  });

  test("masks the login call's mailbox and password hash", () => {
    const redacted = redactSecrets(
      "request to https://eu.hamedata.com/app/Solar/v2_get_device.php?mailbox=user%40example.com&pwd=5f4dcc3b5aa765d61d8327deb882cf99 failed",
    );
    assert.ok(!redacted.includes("example.com"));
    assert.ok(!redacted.includes("5f4dcc3b5aa765d61d8327deb882cf99"));
    assert.strictEqual(
      redacted,
      "request to https://eu.hamedata.com/app/Solar/v2_get_device.php?mailbox=***&pwd=*** failed",
    );
  });

  test("leaves a message without credentials alone", () => {
    const message = "HTTP 503: Service Unavailable";
    assert.strictEqual(redactSecrets(message), message);
  });
});

describe("readOnlineFlag", () => {
  test("reads the values that plainly mean connected", () => {
    for (const value of [true, 1, "1", "true", "online", "Connected", " 1 "]) {
      assert.strictEqual(readOnlineFlag(value), true, `for ${String(value)}`);
    }
  });

  test("reads the values that plainly mean not connected", () => {
    for (const value of [false, 0, "0", "false", "offline", "DISCONNECTED"]) {
      assert.strictEqual(readOnlineFlag(value), false, `for ${String(value)}`);
    }
  });

  // The encoding of this field is not documented, so an unrecognized value has
  // to stay unknown: reporting it as offline would accuse a device that may
  // well be connected.
  test("leaves anything it cannot read unknown", () => {
    for (const value of [undefined, null, "", "2", 2, -1, {}, [], "maybe"]) {
      assert.strictEqual(
        readOnlineFlag(value),
        undefined,
        `for ${JSON.stringify(value)}`,
      );
    }
  });
});
