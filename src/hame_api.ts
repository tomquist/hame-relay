import { createHash } from "crypto";
import fetch from "node-fetch";
import { logger } from "./logger.js";

/**
 * Custom error class that includes HTTP status code information
 */
class HttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10_000,
  backoffMultiplier: 2,
};

/**
 * Determines if an error should be retried based on HTTP status codes
 * Uses a simple, reliable approach: only retry on known server errors and timeouts
 */
function shouldRetryError(error: Error, statusCode?: number): boolean {
  // If we have an HTTP status code, use standard HTTP semantics
  if (statusCode !== undefined) {
    // Only retry server errors (5xx)
    return statusCode >= 500;
  }

  // For network errors without status codes, only retry specific known transient issues
  // Check Node.js system error codes (most reliable)
  if ("code" in error && typeof (error as any).code === "string") {
    const { code } = error as any;
    return code === "ETIMEDOUT" || code === "ECONNRESET";
  }

  // Don't retry anything else - be conservative
  return false;
}

async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs, backoffMultiplier } = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options,
  };

  let lastError: Error;
  let lastStatusCode: number | undefined;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const result = await operation();
      if (attempt > 1) {
        logger.info(`${operationName} succeeded on attempt ${attempt}`);
      }
      return result;
    } catch (error) {
      lastError = error as Error;

      // Extract status code if it's an HttpError
      lastStatusCode =
        error instanceof HttpError ? error.statusCode : undefined;

      if (
        attempt <= maxRetries &&
        shouldRetryError(lastError, lastStatusCode)
      ) {
        const delay = Math.min(
          baseDelayMs * backoffMultiplier ** (attempt - 1),
          maxDelayMs,
        );

        const statusInfo = lastStatusCode ? ` (HTTP ${lastStatusCode})` : "";
        logger.warn(
          `${operationName} failed on attempt ${attempt}/${maxRetries + 1}: ${lastError.message}${statusInfo}. Retrying in ${delay}ms...`,
        );

        await new Promise((resolve) => {
          setTimeout(resolve, delay);
        });
      } else {
        if (attempt <= maxRetries) {
          const statusInfo = lastStatusCode ? ` (HTTP ${lastStatusCode})` : "";
          logger.info(
            `${operationName} failed with non-retryable error: ${lastError.message}${statusInfo}. Not retrying.`,
          );
        } else {
          logger.error(
            `${operationName} failed after ${maxRetries + 1} attempts. Final error: ${lastError.message}`,
          );
        }
        break;
      }
    }
  }

  throw lastError!;
}

export interface HameApiResponse {
  code: string;
  msg: string;
  token?: string;
  data:
    | Array<{
        devid: string;
        name: string;
        sn: string | null;
        mac: string;
        type: string;
        access: string;
        bluetooth_name: string;
      }>
    | string;
}

export interface HameDeviceListResponse {
  code: number;
  msg: string;
  data: Array<{
    devid: string;
    name: string;
    mac: string;
    type: string;
    version: string;
    salt: string; // '<salt>,<salt>'
  }>;
}

/**
 * What the cloud knows about a device's own MQTT session, from
 * `/ems/api/v1/getDeviceMqttStatus`. It answers the question the relay has
 * whenever a device never replies: is anyone connected on the other side?
 *
 * The encoding of these fields is undocumented, so nothing here is interpreted
 * beyond an unambiguous yes/no — see {@link readOnlineFlag}.
 */
export interface DeviceMqttStatus {
  mqtt?: unknown;
  ms?: unknown;
  datetime?: unknown;
  salt?: string;
}

interface HameDeviceMqttStatusResponse {
  code: number;
  msg: string;
  data?: DeviceMqttStatus;
}

/**
 * `true`/`false` only for values that say so plainly, `undefined` for anything
 * else. A status we cannot read must not be reported as "offline": that would
 * turn an unrecognised encoding into a false accusation about the device.
 */
export function readOnlineFlag(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    return value === 0 ? false : undefined;
  }
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "1" || v === "true" || v === "online" || v === "connected") {
      return true;
    }
    if (v === "0" || v === "false" || v === "offline" || v === "disconnected") {
      return false;
    }
  }
  return undefined;
}

export interface DeviceInfo {
  devid: string;
  name: string;
  mac: string;
  type: string;
  version: string;
  salt?: string; // Optional salt field from device list
  cloud_mqtt?: DeviceMqttStatus; // Best-effort, from getDeviceMqttStatus
}

export class HameApi {
  constructor(private readonly baseUrl = "https://eu.hamedata.com") {}

  private get headers() {
    return {
      "User-Agent": "Dart/2.19 (dart:io)",
    } as Record<string, string>;
  }

  async fetchDeviceToken(
    mailbox: string,
    password: string,
  ): Promise<HameApiResponse> {
    const hashedPassword = createHash("md5").update(password).digest("hex");
    const url = new URL("/app/Solar/v2_get_device.php", this.baseUrl);
    url.searchParams.append("mailbox", mailbox);
    url.searchParams.append("pwd", hashedPassword);

    logger.info(`Fetching device token for ${mailbox}...`);

    return await withRetry(async () => {
      const resp = await fetch(url.toString(), { headers: this.headers });

      // Check HTTP status first - we have the response object here
      if (!resp.ok) {
        throw new HttpError(
          `HTTP ${resp.status}: ${resp.statusText}`,
          resp.status,
        );
      }

      const data = (await resp.json()) as HameApiResponse;

      if (data.code === "4") {
        throw new Error(
          `Incorrect password for ${mailbox}. Please double-check the credentials configured for the add-on and try again. (${data.code} - ${data.msg})`,
        );
      }

      if (data.code !== "2" || !data.token) {
        throw new Error(
          `Unexpected API response code: ${data.code} - ${data.msg}`,
        );
      }

      return data;
    }, `Fetch device token for ${mailbox}`);
  }

  async fetchDeviceList(
    mailbox: string,
    token: string,
  ): Promise<HameDeviceListResponse> {
    const url = new URL(
      "/ems/api/v1/getDeviceList",
      this.baseUrl.replace(/\/$/u, ""),
    );
    url.searchParams.append("mailbox", mailbox);
    url.searchParams.append("token", token);

    logger.info("Fetching device list...");

    return await withRetry(async () => {
      const resp = await fetch(url.toString(), { headers: this.headers });

      // Check HTTP status first - we have the response object here
      if (!resp.ok) {
        throw new HttpError(
          `HTTP ${resp.status}: ${resp.statusText}`,
          resp.status,
        );
      }

      const data = (await resp.json()) as HameDeviceListResponse;

      if (data.code !== 1) {
        throw new Error(
          `Unexpected API response from device list: ${data.code} - ${data.msg}`,
        );
      }

      return data;
    }, "Fetch device list");
  }

  /**
   * What the cloud says about one device's MQTT session. Best-effort: a device
   * list that arrived is worth more than this, so every failure here is a debug
   * line and an undefined result rather than an error.
   */
  async fetchDeviceMqttStatus(
    devid: string,
    token: string,
  ): Promise<DeviceMqttStatus | undefined> {
    const url = new URL(
      "/ems/api/v1/getDeviceMqttStatus",
      this.baseUrl.replace(/\/$/u, ""),
    );
    url.searchParams.append("devid", devid);
    url.searchParams.append("token", token);

    try {
      const resp = await fetch(url.toString(), { headers: this.headers });
      if (!resp.ok) {
        logger.debug(
          `Cloud MQTT status for ${devid}: HTTP ${resp.status} ${resp.statusText}`,
        );
        return undefined;
      }

      const body = (await resp.json()) as HameDeviceMqttStatusResponse;
      if (body.code !== 1 || !body.data) {
        logger.debug(
          `Cloud MQTT status for ${devid}: ${body.code} - ${body.msg}`,
        );
        return undefined;
      }

      return body.data;
    } catch (error) {
      logger.debug(
        `Cloud MQTT status for ${devid} unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  async fetchDevices(mailbox: string, password: string): Promise<DeviceInfo[]> {
    return await withRetry(
      async () => {
        const tokenResp = await this.fetchDeviceToken(mailbox, password);
        const list = await this.fetchDeviceList(mailbox, tokenResp.token!);
        logger.info(
          `Successfully fetched ${list.data.length} devices from Hame API`,
        );
        // Sequential rather than in parallel: this is a startup diagnostic, and
        // a device list is allowed to be long.
        const devices: DeviceInfo[] = [];
        for (const device of list.data) {
          const cloud_mqtt = await this.fetchDeviceMqttStatus(
            device.devid,
            tokenResp.token!,
          );
          devices.push(cloud_mqtt ? { ...device, cloud_mqtt } : device);
        }
        return devices;
      },
      "Fetch devices from Hame API",
      { maxRetries: 2 }, // Fewer retries for the overall operation since individual calls already retry
    );
  }
}
