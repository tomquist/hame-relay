import { createHash } from "crypto";
import fetch from "node-fetch";
import { logger } from "./logger.js";

/**
 * Custom error class that includes HTTP status code information
 */
class HttpError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'HttpError';
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
  maxDelayMs: 10000,
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
    const code = (error as any).code;
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
      if (error instanceof HttpError) {
        lastStatusCode = error.statusCode;
      } else {
        lastStatusCode = undefined;
      }

      if (
        attempt <= maxRetries &&
        shouldRetryError(lastError, lastStatusCode)
      ) {
        const delay = Math.min(
          baseDelayMs * Math.pow(backoffMultiplier, attempt - 1),
          maxDelayMs,
        );

        const statusInfo = lastStatusCode ? ` (HTTP ${lastStatusCode})` : "";
        logger.warn(
          `${operationName} failed on attempt ${attempt}/${maxRetries + 1}: ${lastError.message}${statusInfo}. Retrying in ${delay}ms...`,
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
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

export interface DeviceInfo {
  devid: string;
  name: string;
  mac: string;
  type: string;
  version: string;
  salt?: string; // Optional salt field from device list
}

export class HameApi {
  constructor(private readonly baseUrl: string = "https://eu.hamedata.com") {}

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

    return withRetry(async () => {
      const resp = await fetch(url.toString(), { headers: this.headers });

      // Check HTTP status first - we have the response object here
      if (!resp.ok) {
        throw new HttpError(`HTTP ${resp.status}: ${resp.statusText}`, resp.status);
      }

      const data = (await resp.json()) as HameApiResponse;

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
      this.baseUrl.replace(/\/$/, ""),
    );
    url.searchParams.append("mailbox", mailbox);
    url.searchParams.append("token", token);

    logger.info("Fetching device list...");

    return withRetry(async () => {
      const resp = await fetch(url.toString(), { headers: this.headers });

      // Check HTTP status first - we have the response object here
      if (!resp.ok) {
        throw new HttpError(`HTTP ${resp.status}: ${resp.statusText}`, resp.status);
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

  async fetchDevices(mailbox: string, password: string): Promise<DeviceInfo[]> {
    return withRetry(
      async () => {
        const tokenResp = await this.fetchDeviceToken(mailbox, password);
        const list = await this.fetchDeviceList(mailbox, tokenResp.token!);
        logger.info(
          `Successfully fetched ${list.data.length} devices from Hame API`,
        );
        return list.data;
      },
      "Fetch devices from Hame API",
      { maxRetries: 2 }, // Fewer retries for the overall operation since individual calls already retry
    );
  }
}
