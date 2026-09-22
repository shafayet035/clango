const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RANDOM_BYTES = 10;
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

let lastTime = -1;
let lastRandom: Uint8Array | undefined;

function randomBytes(): Uint8Array {
  const bytes = new Uint8Array(RANDOM_BYTES);
  crypto.getRandomValues(bytes);
  return bytes;
}

function increment(bytes: Uint8Array): boolean {
  for (let i = bytes.length - 1; i >= 0; i--) {
    const value = bytes[i] ?? 0;
    if (value < 0xff) {
      bytes[i] = value + 1;
      return true;
    }
    bytes[i] = 0;
  }
  return false;
}

function encode(bytes: Uint8Array, time: number): string {
  const out: string[] = new Array<string>(26).fill("0");
  let remaining = time;
  for (let i = 9; i >= 0; i--) {
    out[i] = ENCODING.charAt(remaining % 32);
    remaining = Math.floor(remaining / 32);
  }

  let accumulator = 0;
  let bits = 0;
  let index = 10;
  for (let i = 0; i < bytes.length; i++) {
    accumulator = (accumulator << 8) | (bytes[i] ?? 0);
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out[index++] = ENCODING.charAt((accumulator >>> bits) & 31);
    }
  }
  return out.join("");
}

/**
 * Generates a ULID: a 26-character, lexicographically sortable identifier composed of a 48-bit
 * millisecond timestamp and 80 bits of randomness.
 *
 * Within a single isolate, successive calls are monotonic even when the clock stalls or moves
 * backwards, so IDs stay sortable by creation order.
 *
 * @param now - Overrides the timestamp in epoch milliseconds. Intended for tests.
 */
export function newUlid(now: number = Date.now()): string {
  let time = now;
  let random: Uint8Array;

  if (lastRandom !== undefined && time <= lastTime) {
    time = lastTime;
    random = lastRandom;
    if (!increment(random)) {
      time = lastTime + 1;
      random = randomBytes();
    }
  } else {
    random = randomBytes();
  }

  lastTime = time;
  lastRandom = random;
  return encode(random, time);
}

/** Returns `true` when `value` is a syntactically valid ULID. */
export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value);
}
