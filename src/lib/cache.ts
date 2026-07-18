import type { HostAPI } from "@wealthfolio/addon-sdk";
import type { SimpleFinResponse } from "../types";

type SecretsAPI = HostAPI["secrets"];

const CACHE_KEY = "bank-sync:response-cache";
// AES-GCM key (base64) for the response cache, kept in Wealthfolio's encrypted keyring.
const CACHE_SECRET_KEY = "cache-encryption-key";

interface CachedResponse {
  data: SimpleFinResponse;
  timestamp: number;
}

// On-disk shape written to localStorage — only ciphertext, never plaintext balances/transactions.
interface EncryptedBlob {
  v: 2;
  iv: string; // base64
  ct: string; // base64
  timestamp: number;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// The cache holds account balances and full transaction history, so it is encrypted at
// rest: the key lives in the OS keyring (via secrets) and only ciphertext hits localStorage.
async function getOrCreateKey(secrets: SecretsAPI): Promise<CryptoKey> {
  let b64 = await secrets.get(CACHE_SECRET_KEY);
  if (!b64) {
    b64 = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
    await secrets.set(CACHE_SECRET_KEY, b64);
  }
  return crypto.subtle.importKey("raw", base64ToBytes(b64), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function getCachedResponse(secrets: SecretsAPI): Promise<CachedResponse | null> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EncryptedBlob>;
    // Legacy plaintext cache from older versions — discard it (no longer trusted at rest).
    if (parsed.v !== 2 || !parsed.iv || !parsed.ct) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    const key = await getOrCreateKey(secrets);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(parsed.iv) },
      key,
      base64ToBytes(parsed.ct),
    );
    const data = JSON.parse(new TextDecoder().decode(plaintext)) as SimpleFinResponse;
    return { data, timestamp: parsed.timestamp ?? 0 };
  } catch {
    return null;
  }
}

export async function setCachedResponse(
  secrets: SecretsAPI,
  data: SimpleFinResponse,
): Promise<void> {
  try {
    const key = await getOrCreateKey(secrets);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(data));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    const blob: EncryptedBlob = {
      v: 2,
      iv: bytesToBase64(iv),
      ct: bytesToBase64(new Uint8Array(ct)),
      timestamp: Date.now(),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(blob));
  } catch {
    // localStorage or WebCrypto unavailable — cache is best-effort, fail silently.
  }
}

// Removes cached financial data. Pass `secrets` to also delete the encryption key from the
// keyring (used when fully disconnecting the addon).
export async function clearResponseCache(secrets?: SecretsAPI): Promise<void> {
  localStorage.removeItem(CACHE_KEY);
  if (secrets) {
    try {
      await secrets.delete(CACHE_SECRET_KEY);
    } catch {
      /* ignore */
    }
  }
}
