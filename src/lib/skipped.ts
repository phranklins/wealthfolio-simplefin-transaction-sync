const STORAGE_KEY = "bank-sync:skipped-transactions";

export function getSkippedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

export function addSkippedId(id: string): void {
  addSkippedIds([id]);
}

export function addSkippedIds(newIds: string[]): void {
  const ids = getSkippedIds();
  for (const id of newIds) ids.add(id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

export function removeSkippedId(id: string): void {
  const ids = getSkippedIds();
  ids.delete(id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

export function clearSkippedIds(): void {
  localStorage.removeItem(STORAGE_KEY);
}
