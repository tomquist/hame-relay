import { test, describe } from "node:test";
import assert from "node:assert";
import { readOnlineFlag } from "./hame_api.js";

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
