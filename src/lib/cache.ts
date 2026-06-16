import type { SimpleFinResponse } from "../types";

const CACHE_KEY = "bank-sync:response-cache";
export const CACHE_TTL_MS = 60 * 60 * 1000;

interface CachedResponse {
  data: SimpleFinResponse;
  timestamp: number;
}

export function getCachedResponse(): CachedResponse | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedResponse;
  } catch {
    return null;
  }
}

export function setCachedResponse(data: SimpleFinResponse): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
  } catch {
    // localStorage may be unavailable in some Tauri configs — fail silently
  }
}

export function clearResponseCache(): void {
  localStorage.removeItem(CACHE_KEY);
}
