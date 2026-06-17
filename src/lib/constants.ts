import type { ActivityType } from "@wealthfolio/addon-sdk";

// Matching thresholds
export const HIGH_CONFIDENCE = 80;
export const LOW_CONFIDENCE = 40;

// SimpleFin
export const SIMPLEFIN_CREATE_URL = "https://bridge.simplefin.org/simplefin/create";

// SetupMapping sentinels
export const SKIP_SENTINEL = "__skip__";
export const CREATE_NEW_SENTINEL = "__create_new__";

// SyncPage
export const PAGE_SIZE = 50;

export const CASH_TYPES: ActivityType[] = [
  "DEPOSIT",
  "WITHDRAWAL",
  "INTEREST",
  "FEE",
  "TRANSFER_IN",
  "TRANSFER_OUT",
] as ActivityType[];

export const INVESTMENT_TYPES: ActivityType[] = [
  "BUY",
  "SELL",
  "DIVIDEND",
  "INTEREST",
  "DEPOSIT",
  "WITHDRAWAL",
  "FEE",
  "TAX",
  "TRANSFER_IN",
  "TRANSFER_OUT",
] as ActivityType[];

export type StaleThresholdHours = 24 | 48 | 72 | 120 | 168 | 360 | 720;
export type SyncDays = 30 | 60 | 90;

export const SYNC_DAYS_OPTIONS: { value: SyncDays; label: string }[] = [
  { value: 30, label: "30 days" },
  { value: 60, label: "60 days" },
  { value: 90, label: "90 days" },
];

export const STALE_THRESHOLD_OPTIONS: { value: StaleThresholdHours; label: string }[] = [
  { value: 24, label: "Daily" },
  { value: 48, label: "Every 2 days" },
  { value: 72, label: "Every 3 days" },
  { value: 120, label: "Every 5 days" },
  { value: 168, label: "Weekly" },
  { value: 360, label: "Every 15 days" },
  { value: 720, label: "Every 30 days" },
];
