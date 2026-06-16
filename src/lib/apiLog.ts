const LOG_KEY = "bank-sync:api-log";
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

export interface ApiLogEntry {
  timestamp: number; // Unix ms
  syncDays: number;
}

export interface ApiStats {
  total: number;
  today: number;
  thisWeek: number;
  thisMonth: number;
  avgPerDay: number; // average over last 30 days that had at least one call
  busiestHour: number | null; // 0–23, null if no data
}

export function getApiLog(): ApiLogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ApiLogEntry[];
  } catch {
    return [];
  }
}

export function appendApiLog(entry: ApiLogEntry): void {
  try {
    const log = getApiLog();
    log.push(entry);
    const cutoff = Date.now() - MAX_AGE_MS;
    const trimmed = log.filter((e) => e.timestamp >= cutoff);
    localStorage.setItem(LOG_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage unavailable — fail silently
  }
}

export function getApiStats(log: ApiLogEntry[]): ApiStats {
  const now = Date.now();
  const todayStr = new Date().toISOString().slice(0, 10);
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;

  const today = log.filter(
    (e) => new Date(e.timestamp).toISOString().slice(0, 10) === todayStr,
  ).length;
  const thisWeek = log.filter((e) => e.timestamp >= weekAgo).length;
  const thisMonth = log.filter((e) => e.timestamp >= monthAgo).length;

  // Average calls per day over days that had at least one call in the last 30 days
  const last30 = log.filter((e) => e.timestamp >= monthAgo);
  const daySet = new Set(last30.map((e) => new Date(e.timestamp).toISOString().slice(0, 10)));
  const avgPerDay = daySet.size > 0 ? Math.round((last30.length / daySet.size) * 10) / 10 : 0;

  // Busiest hour (0–23) across all log entries
  const hourCounts = new Array<number>(24).fill(0);
  for (const e of log) {
    hourCounts[new Date(e.timestamp).getHours()]++;
  }
  const maxCount = Math.max(...hourCounts);
  const busiestHour = log.length > 0 ? hourCounts.indexOf(maxCount) : null;

  return { total: log.length, today, thisWeek, thisMonth, avgPerDay, busiestHour };
}
