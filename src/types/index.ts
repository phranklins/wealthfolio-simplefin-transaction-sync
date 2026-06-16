import type { ActivityType } from "@wealthfolio/addon-sdk";
import type { StaleThresholdHours, SyncDays } from "../lib/constants";

// SimpleFin API types
export interface SimpleFinTransaction {
  id: string;
  posted: number;
  amount: string;
  description: string;
  pending?: boolean;
  transacted_at?: number;
  payee?: string;
  memo?: string;
}

export interface SimpleFinAccount {
  id: string;
  name: string;
  currency: string;
  balance: string;
  "balance-date": number;
  transactions: SimpleFinTransaction[];
  org?: { name?: string };
}

export interface SimpleFinError {
  id?: string;
  message: string;
  transactionId?: string;
}

export interface SimpleFinResponse {
  accounts: SimpleFinAccount[];
  errlist: SimpleFinError[];
}

// Account mapping between SimpleFin and Wealthfolio
export interface AccountMapping {
  simpleFinAccountId: string;
  simpleFinAccountName: string;
  simpleFinCurrency: string;
  wealthfolioAccountId: string;
  wealthfolioAccountName: string;
  wealthfolioCurrency: string;
}

export type { StaleThresholdHours, SyncDays };

export interface AddonConfig {
  mappings: AccountMapping[];
  staleThresholdHours: StaleThresholdHours;
  syncDays: SyncDays;
  lastFetchTimestamp: number | null;
}

export const DEFAULT_CONFIG: AddonConfig = {
  mappings: [],
  staleThresholdHours: 48,
  syncDays: 90,
  lastFetchTimestamp: null,
};

// Fuzzy match types
export type MatchConfidence = "high" | "low" | "new";

export interface TransactionMatch {
  simpleFinTransaction: SimpleFinTransaction;
  simpleFinAccountId: string;
  wealthfolioAccountId: string;
  currency: string;
  confidence: MatchConfidence;
  score: number;
  matchedActivityId?: string;
  // Set during review for investment transactions
  resolvedActivityType?: ActivityType;
  resolvedSymbol?: string;
}

// Secrets storage keys
export const SECRETS_KEY_CREDENTIALS = "credentials";
export const SECRETS_KEY_CONFIG = "config";
