// Pure, no imports — testable without mocking anything and safe to import from
// both the client bundle (app/page.tsx) and, if ever needed, a server route.
//
// cyrb53: small, fast, non-cryptographic 53-bit string hash. Deliberately not
// crypto.subtle.digest — that's async and requires a secure context, and this
// needs to run synchronously on every render of the pay screen.
export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// Combines a per-attempt nonce with a hash of the payload that is about to go
// to Stripe. Same nonce + same payload ⇒ same key (safe retry / double-submit
// collapse). Same nonce + different payload ⇒ different key (Stripe would
// otherwise 400 on a reused key with different params). Fixed-order array,
// not an object, so key insertion order can never change the hash.
//
// Output always matches the server's /^[A-Za-z0-9_-]{16,255}$/
// (app/api/create-payment-intent/route.ts): `nonce` is either
// crypto.randomUUID() (36 chars, [A-Za-z0-9-]) or a 32-char hex fallback
// (both from app/page.tsx's newNonce), `_` and the base36 hash are both in the
// allowed set, and the shortest possible output (32-char nonce + "_" + a
// single base36 digit) is still well over the 16-char minimum.
export function idempotencyKey(nonce: string, parts: unknown[]): string {
  const hash = cyrb53(JSON.stringify(parts)).toString(36);
  return `${nonce}_${hash}`;
}
