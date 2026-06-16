import type { ActivityDetails } from "@wealthfolio/addon-sdk";
import type {
  SimpleFinTransaction,
  TransactionMatch,
  MatchConfidence,
  AccountMapping,
} from "../types";
import { HIGH_CONFIDENCE, LOW_CONFIDENCE } from "./constants";

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Rough Dice coefficient for fuzzy string similarity (0–1)
function stringSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;

  const bigrams = new Map<string, number>();
  for (let i = 0; i < na.length - 1; i++) {
    const bg = na.slice(i, i + 2);
    bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1);
  }

  let intersections = 0;
  for (let i = 0; i < nb.length - 1; i++) {
    const bg = nb.slice(i, i + 2);
    const count = bigrams.get(bg) ?? 0;
    if (count > 0) {
      intersections++;
      bigrams.set(bg, count - 1);
    }
  }

  return (2 * intersections) / (na.length + nb.length - 2);
}

function effectiveAmount(activity: ActivityDetails): number {
  return activity.quantity * activity.unitPrice;
}

function scoreMatch(
  sfAmount: number,
  sfDate: Date,
  sfDescription: string,
  activity: ActivityDetails,
): number {
  let score = 0;

  // Amount match (50 pts) — compare absolute values; sign is handled by activity type
  const wfAmount = Math.abs(effectiveAmount(activity));
  if (Math.abs(sfAmount - wfAmount) < 0.005) score += 50;
  else return 0; // Wrong amount can never be the same transaction

  // Date match
  const wfDate = new Date(activity.date);
  const daysDiff = Math.abs(sfDate.getTime() - wfDate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysDiff <= 1) score += 30;
  else if (daysDiff <= 3) score += 15;

  // Description fuzzy match against comment (20 pts)
  if (activity.comment) {
    const similarity = stringSimilarity(sfDescription, activity.comment);
    if (similarity >= 0.7) score += 20;
  }

  return score;
}

function confidence(score: number): MatchConfidence {
  if (score >= HIGH_CONFIDENCE) return "high";
  if (score >= LOW_CONFIDENCE) return "low";
  return "new";
}

export function matchTransactions(
  sfTransactions: SimpleFinTransaction[],
  wfActivities: ActivityDetails[],
  mapping: AccountMapping,
): TransactionMatch[] {
  const accountActivities = wfActivities.filter(
    (a) => a.accountId === mapping.wealthfolioAccountId,
  );

  return sfTransactions.map((sfTx) => {
    const sfAmount = Math.abs(parseFloat(sfTx.amount));
    const sfDate = new Date(sfTx.posted * 1000);
    let bestScore = 0;
    let bestActivityId: string | undefined;

    for (const activity of accountActivities) {
      const score = scoreMatch(sfAmount, sfDate, sfTx.description, activity);
      if (score > bestScore) {
        bestScore = score;
        bestActivityId = activity.id;
      }
    }

    const conf = confidence(bestScore);

    return {
      simpleFinTransaction: sfTx,
      simpleFinAccountId: mapping.simpleFinAccountId,
      wealthfolioAccountId: mapping.wealthfolioAccountId,
      currency: mapping.simpleFinCurrency,
      confidence: conf,
      score: bestScore,
      matchedActivityId: conf !== "new" ? bestActivityId : undefined,
    };
  });
}
