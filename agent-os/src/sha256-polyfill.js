/**
 * Web Crypto shims for AgentOS mc-core in the browser worker.
 *
 * mc-core needs:
 *   crypto.subtle.digest("SHA-256", bytes)  — hash kernel / loom / catalog
 *   crypto.randomUUID()                    — tool / session ids
 *
 * Never replace globalThis.crypto wholesale: that drops native methods
 * (randomUUID, etc.) and is what caused "crypto.randomUUID is not a function"
 * after the first subtle polyfill attempt.
 */

/** @param {Uint8Array} message */
function sha256Bytes(message) {
  // FIPS 180-4 SHA-256 (compact public-domain-style impl).
  const K = new Uint32Array([
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
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const len = message.length;
  const bitLen = len * 8;
  const withPad = ((len + 9 + 63) & ~63) >>> 0;
  const buf = new Uint8Array(withPad);
  buf.set(message);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  dv.setUint32(withPad - 8, hi, false);
  dv.setUint32(withPad - 4, lo, false);

  const w = new Uint32Array(64);
  for (let i = 0; i < withPad; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i], false);
  return out;
}

function randomUUIDPolyfill() {
  const bytes = new Uint8Array(16);
  const g = globalThis.crypto;
  if (g && typeof g.getRandomValues === "function") {
    g.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = (Math.random() * 256) | 0;
  }
  // RFC 4122 version 4
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function defineOn(obj, key, value) {
  try {
    Object.defineProperty(obj, key, {
      value,
      configurable: true,
      enumerable: true,
      writable: true,
    });
    return true;
  } catch {
    try {
      obj[key] = value;
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Ensure crypto.subtle.digest (SHA-256) and crypto.randomUUID exist.
 * Idempotent. Does not replace the Crypto object.
 * @returns {{ subtle: boolean, randomUUID: boolean }}
 */
export function ensureWebCrypto() {
  const c = globalThis.crypto;
  if (!c) {
    // Extremely hostile env: install a minimal object once.
    const minimal = {
      getRandomValues(arr) {
        for (let i = 0; i < arr.length; i++) arr[i] = (Math.random() * 256) | 0;
        return arr;
      },
      randomUUID: randomUUIDPolyfill,
      subtle: {
        async digest(algorithm, data) {
          return digestImpl(algorithm, data);
        },
      },
    };
    globalThis.crypto = /** @type {Crypto} */ (minimal);
    return { subtle: true, randomUUID: true };
  }

  let subtlePatched = false;
  let uuidPatched = false;

  if (!(c.subtle && typeof c.subtle.digest === "function")) {
    const subtle = {
      async digest(algorithm, data) {
        return digestImpl(algorithm, data);
      },
    };
    // Prefer adding .subtle only — never rebuild crypto (that drops randomUUID).
    if (!defineOn(c, "subtle", subtle)) {
      console.warn(
        "[cad-runtime] could not install crypto.subtle polyfill; open http://127.0.0.1 (secure origin)",
      );
    } else {
      subtlePatched = true;
    }
  }

  if (typeof c.randomUUID !== "function") {
    if (!defineOn(c, "randomUUID", randomUUIDPolyfill)) {
      console.warn("[cad-runtime] could not install crypto.randomUUID polyfill");
    } else {
      uuidPatched = true;
    }
  }

  return { subtle: subtlePatched, randomUUID: uuidPatched };
}

/** @deprecated use ensureWebCrypto */
export function ensureCryptoSubtleDigest() {
  return ensureWebCrypto().subtle;
}

/**
 * @param {AlgorithmIdentifier} algorithm
 * @param {BufferSource} data
 */
async function digestImpl(algorithm, data) {
  const name =
    typeof algorithm === "string"
      ? algorithm
      : algorithm && /** @type {any} */ (algorithm).name;
  if (String(name).toUpperCase().replace(/-/g, "") !== "SHA256") {
    throw new Error(`webcrypto-polyfill: only SHA-256 supported, got ${name}`);
  }
  let bytes;
  if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else if (ArrayBuffer.isView(data)) {
    bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } else {
    throw new TypeError("webcrypto-polyfill: expected BufferSource");
  }
  return sha256Bytes(bytes).buffer;
}
