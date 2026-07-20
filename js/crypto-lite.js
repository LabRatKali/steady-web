/**
 * Mirror of app.steady.sync.CryptoLite — XOR + hex, default key steady.v1.key
 * ApprovalSigner HMAC-SHA256 for parent decisions.
 */
(function (global) {
  const DEFAULT_KEY = "steady.v1.key";

  function utf8Bytes(str) {
    return new TextEncoder().encode(str);
  }

  function xor(bytes, keyBytes) {
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      out[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
    }
    return out;
  }

  function toHex(bytes) {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function fromHex(hex) {
    const clean = String(hex || "").replace(/\s+/g, "");
    if (clean.length % 2 !== 0) throw new Error("bad hex");
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }

  function encode(text, key) {
    const k = utf8Bytes(key || DEFAULT_KEY);
    return toHex(xor(utf8Bytes(text), k));
  }

  function decode(hex, key) {
    const k = utf8Bytes(key || DEFAULT_KEY);
    return new TextDecoder().decode(xor(fromHex(hex), k));
  }

  function decisionPayload(requestId, status, minutes, nonce, expiresAt) {
    return `${requestId}|${status}|${minutes}|${nonce}|${expiresAt}`;
  }

  async function hmacSha256Hex(secret, payload) {
    const key = await crypto.subtle.importKey(
      "raw",
      utf8Bytes(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, utf8Bytes(payload));
    return toHex(new Uint8Array(sig));
  }

  global.SteadyCrypto = {
    encode,
    decode,
    decisionPayload,
    hmacSha256Hex,
    DEFAULT_KEY,
  };
})(window);
