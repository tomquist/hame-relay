import { logger } from "./logger.js";
import { createHash } from "crypto";

class StreamUtil {
  /**
   * Encrypts or decrypts data using a stream cipher based on the provided key.
   * The result is a hex-encoded string.
   *
   * @param data The data string to process.
   * @param key The key to use for the cipher.
   * @returns The processed data as a hex string.
   */
  static e(data: string, key: string): string {
    if (typeof data !== "string" || typeof key !== "string") {
      throw new TypeError("Data and key must be strings.");
    }
    if (key.length === 0) {
      throw new Error("Key cannot be empty");
    }

    // Note: The key stream length is determined by the number of characters in the
    // data string, not the number of bytes after UTF-8 encoding.
    const keyStream = StreamUtil.#generateKeyStream(key, data.length);
    const dataBytes = new TextEncoder().encode(data);
    const resultBytes: number[] = [];

    for (let i = 0; i < dataBytes.length; i++) {
      // XOR each byte of data with a byte from the key stream. The key stream
      // is repeated (using modulo) if it's shorter than the data bytes.
      const keyByte = keyStream[i % keyStream.length];
      resultBytes.push(dataBytes[i] ^ keyByte);
    }

    return StreamUtil.#bytesToHex(resultBytes);
  }

  /**
   * Converts an array of bytes (numbers) into a hexadecimal string representation.
   * @private
   * @param bytes The array of bytes to convert.
   * @returns The resulting hexadecimal string.
   */
  static #bytesToHex(bytes: number[]): string {
    return Buffer.from(bytes).toString("hex");
  }

  /**
   * Generates a pseudo-random key stream of a given length from a key string.
   * @private
   * @param key The key string to use as the seed for the generator.
   * @param length The desired length of the key stream.
   * @returns The generated key stream as an array of bytes.
   */
  static #generateKeyStream(key: string, length: number): number[] {
    const keyBytes = new TextEncoder().encode(key);
    let seed = 0;

    // Calculate a seed value from the key using a common string hashing algorithm.
    for (let i = 0; i < keyBytes.length; i++) {
      // JavaScript's % operator behaves correctly here as the dividend is always positive.
      seed = (seed * 31 + keyBytes[i]) % 2147483647;
    }

    const keyStream: number[] = [];
    let state = seed;

    // Generate the key stream using a Linear Congruential Generator (LCG).
    for (let i = 0; i < length; i++) {
      state = (state * 1664525 + 1013904223) % 4294967296;

      // The bitwise operations in JS operate on 32-bit signed integers.
      // Since `state` is always positive, `>>` (sign-propagating right shift)
      // has the same effect as an unsigned right shift.
      const byte = (state ^ (state >> 16)) & 0xff;
      keyStream.push(byte);
    }
    return keyStream;
  }
}

/**
 * A utility class for encoding strings using a SHA-256-based algorithm.
 *
 * The process involves:
 * 1. Hashing an input string using the SHA-256 algorithm.
 * 2. Truncating and rearranging the resulting 32-byte hash into 24 bytes.
 * 3. Applying a custom Base62-like encoding to the 24-byte result to
 * produce a 48-character string.
 */
class CodeUtil {
  /**
   * Encodes the input string. This is the main public method.
   * @param input The string to encode.
   * @returns The encoded 48-character string.
   */
  static e(input: string): string {
    // 1. Use Node.js crypto module to compute SHA-256 hash
    const hash = createHash("sha256");
    hash.update(input, "utf8");
    const hashBuffer = hash.digest();

    // 2. Convert the Buffer to Uint32Array
    const hashState = new Uint32Array(8);
    for (let i = 0; i < 8; i++) {
      // Read 4 bytes as big-endian uint32
      hashState[i] = hashBuffer.readUInt32BE(i * 4);
    }

    // 3. Produce the final hash bytes with a custom truncation and reordering
    const finalHashBytes = new Uint8Array(24);
    for (let i = 0; i < 24; i++) {
      const word = hashState[i % 8];
      const byteIndexInWord = Math.floor(i / 8);
      const shift = byteIndexInWord * 8;
      finalHashBytes[i] = (word >> shift) & 0xff;
    }

    // 4. Convert the resulting 24 bytes into the final string format.
    return this.#bytesToCustomEncoding(finalHashBytes);
  }

  /**
   * Converts the final hash bytes to a custom string encoding.
   * For each byte, it generates two characters and appends them to a string.
   * @private
   */
  static #bytesToCustomEncoding(bytes: Uint8Array): string {
    const charset =
      "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    const buffer: string[] = [];

    for (const byte of bytes) {
      buffer.push(charset[byte % 62]);
      buffer.push(charset[(byte * 31) % 62]);
    }

    return buffer.join("");
  }
}

/**
 * A utility class for hexadecimal conversions and data scrambling operations.
 */
class HexUtil {
  /**
   * Main function that scrambles and unscrambles content based on a MAC key.
   * @param content The input string to transform.
   * @param mac The string to use as a key for the transformation.
   * @returns The transformed string in hexadecimal format.
   */
  static textForRand(content: string, mac: string): string {
    if (!content || !mac) return "";

    const hexContent = this.strToHex(content);
    if (hexContent.length < 2) return "";

    // N is the core value, derived from the last byte of hexContent.
    const N = ((parseInt(hexContent.slice(-2), 16) % 5) + 5) % 5;

    let processedBytes = this._hexToBytes(hexContent);
    const macBytes = this._hexToBytes(this.strToHex(mac));

    // --- The Scramble/Permutation Phase ---
    // The combined effect of the initial scramble and the inlined loop
    // is to perform the same scramble operation N times (1 initial + N-1 in the loop).
    for (let i = 0; i < N * 2; i++) {
      processedBytes = this.scramble(processedBytes, macBytes);
    }

    // --- The Unscramble Phase ---
    // The final loop unscrambles the result max(1, N) times.
    const unscrambleCount = Math.max(1, N);
    for (let i = 0; i < unscrambleCount; i++) {
      processedBytes = this.unscramble(processedBytes, macBytes);
    }

    return this._bytesToHex(processedBytes);
  }

  /**
   * Converts a string into a hexadecimal string.
   * e.g., "Hi" -> "4869"
   * @param str The input string.
   * @returns The hexadecimal representation.
   */
  static strToHex(str: string): string {
    return Buffer.from(str, "utf8").toString("hex");
  }

  /**
   * Converts a byte array (like Uint8Array) into a hexadecimal string.
   * @param bytes The byte array.
   * @returns The hexadecimal representation.
   */
  static _bytesToHex(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString("hex");
  }

  /**
   * Converts a hexadecimal string into a Uint8Array.
   * @param hex The hex string.
   * @returns The resulting byte array.
   */
  static _hexToBytes(hex: string): Uint8Array {
    return new Uint8Array(Buffer.from(hex, "hex"));
  }

  /**
   * Scrambles data using a key-derived permutation table.
   * @param data The data to scramble.
   * @param key The key to use for scrambling.
   * @returns The scrambled data.
   */
  static scramble(data: Uint8Array, key: Uint8Array): Uint8Array {
    if (data.length === 0) {
      return new Uint8Array();
    }
    const p = this._buildPermutation(key, data.length);
    // Reorders the data according to the permutation table.
    // result[i] = data[p[i]]
    const result = p.map((index) => data[index]);
    return new Uint8Array(result);
  }

  /**
   * Unscrambles data that was processed by the scramble function.
   * @param data The data to unscramble.
   * @param key The key used during scrambling.
   * @returns The original, unscrambled data.
   */
  static unscramble(data: Uint8Array, key: Uint8Array): Uint8Array {
    if (data.length === 0) {
      return new Uint8Array();
    }
    const p = this._buildPermutation(key, data.length);
    const result = new Uint8Array(data.length);
    // Reverses the permutation by placing data back in its original position.
    for (let i = 0; i < data.length; i++) {
      result[p[i]] = data[i];
    }
    return result;
  }

  /**
   * Creates a permutation array based on a key (similar to RC4 KSA).
   * @param key The key to seed the permutation.
   * @param size The size of the permutation array.
   * @returns The generated permutation array.
   */
  static _buildPermutation(key: Uint8Array, size: number): number[] {
    const p = Array.from({ length: size }, (_, i) => i);
    if (size <= 1) {
      return p;
    }

    let j = 0;
    const keyLen = key.length;
    for (let i = 0; i < size; i++) {
      j = (j + p[i] + key[i % keyLen]) % size;
      // Swap p[i] and p[j]
      [p[i], p[j]] = [p[j], p[i]];
    }
    return p;
  }
}

class CommonHelper {
  /**
   * @param salt The salt value as a string
   * @param mac The MAC value as a string
   * @param vid The VID value as a string
   * @returns The computed result string
   */
  static cq(salt: string, mac: string, vid: string): string {
    // Compare mac.length with 4
    const len = mac.length;
    if (len < 4) {
      // Call console.log() for printing
      console.log("ACC======mac is too short");
      return "";
    }

    // Main logic path

    // In JS, we use template literals (backticks ``) for string interpolation
    const var1 = `${vid}_${mac.slice(0, -4)}`;
    const sub2 = mac.slice(1, len - 2);
    const var2 = `${sub2}_${vid}`;

    // Print the combined debug string
    // console.log(
    //   `ACC======combineVid===${var1},${var2}=====content====${content}`
    // );

    // Call HexUtil.textForRand(content, var1)
    const h1 = HexUtil.textForRand(salt, var1);

    const tempStr1 = `${vid}${mac}`;

    // Call StreamUtil.e(tempStr1, var2)
    const h2 = StreamUtil.e(tempStr1, var2);

    const tempStr2 = `${h1}${h2}`;

    // Call CodeUtil.e(tempStr2)
    const retVal = CodeUtil.e(tempStr2).slice(0, 24);

    // Print the final debug string
    // console.log(`ACC=======h1===${h1},h2==${h2},ret==${retVal}`);

    // Return the final result
    return retVal;
  }

  /**
   * Checks if a VID (device type) supports a given firmware version
   * @param vid The device type identifier (e.g., 'HMG-50', 'JPLS', etc.)
   * @param firmwareVersion The firmware version to check (e.g., '136.0', '230.0')
   * @returns True if the device supports the firmware version, false otherwise
   */
  static isSupportVid(vid: string, firmwareVersion: string): boolean {
    if (!vid || !firmwareVersion) {
      return false;
    }

    // Parse firmware version to number for comparison
    const version = parseFloat(firmwareVersion);
    if (isNaN(version)) {
      return false;
    }

    // Normalize VID to uppercase for consistent comparison
    const normalizedVid = vid.toUpperCase();

    // Jupiter devices (JPLS, HMM, HMN): Require firmware ≥ 136.0
    if (["JPLS", "HMM", "HMN"].some((v) => normalizedVid.startsWith(v))) {
      return version >= 136.0;
    }

    // HMB/HMA/HMK/HMF: Require firmware ≥ 230.0
    if (["HMB", "HMA", "HMK", "HMF"].some((v) => normalizedVid.startsWith(v))) {
      return version >= 230.0;
    }

    // HMJ: Require firmware ≥ 116.0
    if (normalizedVid.startsWith("HMJ")) {
      return version >= 116.0;
    }

    // HME-2, HME-4, TPM-CN: Require firmware ≥ 122.0
    if (["HME-2", "HME-4", "TPM-CN"].includes(normalizedVid)) {
      return version >= 122.0;
    }

    // HME-3, HME-5: Require firmware ≥ 120.0
    if (["HME-3", "HME-5"].includes(normalizedVid)) {
      return version >= 120.0;
    }

    // HMG: Require firmware ≥ 154.0
    if (normalizedVid.startsWith("HMG")) {
      return version >= 154.0;
    }

    if (normalizedVid.startsWith("HMI")) {
      return version >= 126.0;
    }

    if (normalizedVid.startsWith("VNSE3")) {
      return true;
    }

    return false;
  }

  /**
   * Extracts the first salt value from a comma-separated salt pair
   * @param saltPair The comma-separated salt pair (e.g., "salt1,salt2")
   * @returns The first salt value, or empty string if invalid
   */
  static extractFirstSalt(saltPair: string): string {
    if (!saltPair || typeof saltPair !== "string") {
      return "";
    }

    const parts = saltPair.split(",");
    return parts.length > 0 ? parts[0].trim() : "";
  }
}

export { StreamUtil, CodeUtil, HexUtil, CommonHelper };
