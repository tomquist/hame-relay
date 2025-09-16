import { logger } from "./logger.js";

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
    // data string, not the number of bytes after UTF-8 encoding. This mirrors
    // the behavior of the original implementation.
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
    const hexParts: string[] = [];
    for (const byte of bytes) {
      // Convert each byte to a two-digit hex string and collect it.
      const hex = byte.toString(16).padStart(2, "0");
      hexParts.push(hex);
    }
    return hexParts.join("");
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
   * SHA-256 round constants (K). These are the first 32 bits of the
   * fractional parts of the cube roots of the first 64 prime numbers.
   * @private
   */
  static #k = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  /**
   * Helper for 32-bit unsigned addition. In JS, bitwise operations yield
   * signed 32-bit integers, so we use `>>> 0` to convert to unsigned.
   * @private
   */
  static #add32(a: number, b: number): number {
    return (a + b) >>> 0;
  }

  /**
   * Helper for 32-bit right rotation.
   * @private
   */
  static #rotr(x: number, n: number): number {
    return ((x >>> n) | (x << (32 - n))) >>> 0;
  }

  /**
   * Encodes the input string. This is the main public method.
   * @param input The string to encode.
   * @returns The encoded 48-character string.
   */
  static e(input: string): string {
    // 1. Convert input string to a list of bytes using UTF-8.
    const bytes = new TextEncoder().encode(input);

    // 2. Initialize hash state with the standard SHA-256 initial values.
    const hashState = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
      0x1f83d9ab, 0x5be0cd19,
    ]);

    // 3. Pad the data to a multiple of 64 bytes for processing.
    const paddedMessage = this.#padData(bytes);

    // 4. Process the message in 64-byte (512-bit) chunks.
    for (let i = 0; i < paddedMessage.length; i += 64) {
      const chunk = paddedMessage.subarray(i, i + 64);
      this.#processChunk(hashState, chunk);
    }

    // 5. Produce the final hash bytes with a custom truncation and reordering.
    const finalHashBytes = new Uint8Array(24);
    for (let i = 0; i < 24; i++) {
      const word = hashState[i % 8];
      const byteIndexInWord = Math.floor(i / 8);
      const shift = byteIndexInWord * 8;
      finalHashBytes[i] = (word >> shift) & 0xff;
    }

    // 6. Convert the resulting 24 bytes into the final string format.
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

  /**
   * Processes a single 64-byte chunk of data, updating the hash state.
   * This function implements the core SHA-256 compression algorithm.
   * @private
   */
  static #processChunk(hashState: Uint32Array, chunk: Uint8Array): void {
    const w = new Uint32Array(64);

    // 1. Prepare the message schedule (W).
    const chunkData = new DataView(chunk.buffer, chunk.byteOffset);
    for (let i = 0; i < 16; i++) {
      w[i] = chunkData.getUint32(i * 4, false); // false for big-endian
    }

    for (let i = 16; i < 64; i++) {
      const s0 =
        this.#rotr(w[i - 15], 7) ^
        this.#rotr(w[i - 15], 18) ^
        (w[i - 15] >>> 3);
      const s1 =
        this.#rotr(w[i - 2], 17) ^ this.#rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = this.#add32(this.#add32(this.#add32(w[i - 16], s0), w[i - 7]), s1);
    }

    // 2. Initialize working variables with the current hash state.
    let a = hashState[0],
      b = hashState[1],
      c = hashState[2],
      d = hashState[3],
      e = hashState[4],
      f = hashState[5],
      g = hashState[6],
      h = hashState[7];

    // 3. Main compression loop.
    for (let i = 0; i < 64; i++) {
      const s1 = this.#rotr(e, 6) ^ this.#rotr(e, 11) ^ this.#rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = this.#add32(
        this.#add32(this.#add32(this.#add32(h, s1), ch), this.#k[i]),
        w[i],
      );
      const s0 = this.#rotr(a, 2) ^ this.#rotr(a, 13) ^ this.#rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = this.#add32(s0, maj);

      h = g;
      g = f;
      f = e;
      e = this.#add32(d, temp1);
      d = c;
      c = b;
      b = a;
      a = this.#add32(temp1, temp2);
    }

    // 4. Update the hash state with the new values.
    hashState[0] = this.#add32(hashState[0], a);
    hashState[1] = this.#add32(hashState[1], b);
    hashState[2] = this.#add32(hashState[2], c);
    hashState[3] = this.#add32(hashState[3], d);
    hashState[4] = this.#add32(hashState[4], e);
    hashState[5] = this.#add32(hashState[5], f);
    hashState[6] = this.#add32(hashState[6], g);
    hashState[7] = this.#add32(hashState[7], h);
  }

  /**
   * Pads the input data according to the SHA-256 standard.
   * @private
   */
  static #padData(data: Uint8Array): Uint8Array {
    const originalLengthInBytes = data.length;
    const originalLengthInBits = originalLengthInBytes * 8;

    const paddingLength = (56 - ((originalLengthInBytes + 1) % 64) + 64) % 64;
    const totalLength = originalLengthInBytes + 1 + paddingLength + 8;
    const paddedData = new Uint8Array(totalLength);

    paddedData.set(data);
    paddedData[originalLengthInBytes] = 0x80;

    // Append the original message length as a 64-bit big-endian integer.
    // Use DataView to avoid issues with large numbers in JavaScript.
    const lengthData = new DataView(new ArrayBuffer(8));
    const highBits = Math.floor(originalLengthInBits / 0x100000000);
    const lowBits = originalLengthInBits % 0x100000000;

    lengthData.setUint32(0, highBits, false); // Big Endian
    lengthData.setUint32(4, lowBits, false); // Big Endian

    paddedData.set(new Uint8Array(lengthData.buffer), totalLength - 8);

    return paddedData;
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
    return Array.from(str)
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * Converts a byte array (like Uint8Array) into a hexadecimal string.
   * @param bytes The byte array.
   * @returns The hexadecimal representation.
   */
  static _bytesToHex(bytes: Uint8Array): string {
    // This could also be Buffer.from(bytes).toString('hex') in Node.js
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * Converts a hexadecimal string into a Uint8Array.
   * @param hex The hex string.
   * @returns The resulting byte array.
   */
  static _hexToBytes(hex: string): Uint8Array {
    const bytes: number[] = [];
    for (let i = 0; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.substring(i, i + 2), 16));
    }
    return new Uint8Array(bytes);
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
    // result[p[i]] = data[i]
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
