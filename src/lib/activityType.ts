import type { ActivityType } from '@wealthfolio/addon-sdk';
import type { SimpleFinTransaction } from '../types';

const SYMBOL_SKIP_WORDS = new Set([
  // Common English words that appear in brokerage descriptions
  'ACH', 'ADR', 'AND', 'CASH', 'COM', 'DIV', 'EFT', 'ETF', 'FBO', 'FEE', 'FOR',
  'FROM', 'INC', 'INTO', 'IRA', 'LLC', 'LTD', 'NET', 'NEW', 'NRA', 'OLD', 'PRIOR',
  'REF', 'SEC', 'TAX', 'THE', 'USA', 'YEAR', 'YOU',
]);

export function guessSymbol(sfTx: SimpleFinTransaction, isSecurities: boolean, currency: string): string {
  if (!isSecurities) return `$CASH-${currency}`;

  const raw = [sfTx.description, sfTx.payee ?? '', sfTx.memo ?? ''].join(' ');

  // Ticker in parentheses is the most reliable signal: "(AAPL)" "(FXAIX)"
  // Note: Fidelity appends "(Cash)" — our [A-Z]{1,6} requires all-caps so it won't match.
  const parenMatch = raw.match(/\(([A-Z]{1,6})\)/);
  if (parenMatch) return parenMatch[1];

  // After action keywords: "BOUGHT AAPL", "SOLD MSFT", "DIVIDEND FXAIX"
  const afterKw = raw.match(
    /\b(?:BOUGHT|SOLD|REINVEST(?:MENT)?|DIVIDEND|INTEREST|RECEIVED|OF)\s+([A-Z]{1,6})\b/,
  );
  if (afterKw && !SYMBOL_SKIP_WORDS.has(afterKw[1])) return afterKw[1];

  // First standalone ticker-like word (2–6 uppercase chars not in skip list)
  const words = raw.match(/\b[A-Z]{2,6}\b/g) ?? [];
  for (const w of words) {
    if (!SYMBOL_SKIP_WORDS.has(w)) return w;
  }

  return `$CASH-${currency}`;
}

/**
 * Heuristic activity-type guess based on transaction description/payee/memo.
 * isSecurities enables investment-specific patterns (BUY, SELL, DIVIDEND, etc.)
 * that would produce false positives on cash accounts (e.g. "Best Buy" → BUY).
 */
export function guessActivityType(sfTx: SimpleFinTransaction, isSecurities: boolean): ActivityType {
  const text = [sfTx.description, sfTx.payee ?? '', sfTx.memo ?? '']
    .join(' ')
    .toLowerCase();
  const isPositive = parseFloat(sfTx.amount) > 0;

  if (isSecurities) {
    // Purchase / reinvestment
    if (/\b(bought|reinvest(ment)?|purchased|acquired)\b/.test(text)) return 'BUY' as ActivityType;
    // Sale / redemption
    if (/\b(sold|sale|redemption|redeemed)\b/.test(text)) return 'SELL' as ActivityType;
    // Dividend
    if (/\bdividend\b/.test(text)) return 'DIVIDEND' as ActivityType;
    // Interest / yield
    if (/\b(interest|yield)\b/.test(text)) return 'INTEREST' as ActivityType;
    // Tax withholding
    if (/\b(tax|withhold(ing)?|nra)\b/.test(text)) return 'TAX' as ActivityType;
    // Fee / commission
    if (/\b(fee|commission|advisory|expense|surcharge)\b/.test(text)) return 'FEE' as ActivityType;
    // Contribution (e.g. "CASH CONTRIBUTION PRIOR YEAR") — money into the account
    if (/\bcontribut(ion|ed)?\b/.test(text)) return (isPositive ? 'DEPOSIT' : 'TRANSFER_IN') as ActivityType;
    // Transfer / journal
    if (/\b(transfer|journal(ed)?|wire|distribut(ion|ed))\b/.test(text)) {
      return (isPositive ? 'TRANSFER_IN' : 'TRANSFER_OUT') as ActivityType;
    }
  }

  // Cash-account patterns (also the securities fallthrough)
  if (/\binterest\b/.test(text)) return 'INTEREST' as ActivityType;
  if (/\b(fee|charge|penalty)\b/.test(text)) return 'FEE' as ActivityType;
  if (/\b(transfer|wire)\b/.test(text)) {
    return (isPositive ? 'TRANSFER_IN' : 'TRANSFER_OUT') as ActivityType;
  }

  return (isPositive ? 'DEPOSIT' : 'WITHDRAWAL') as ActivityType;
}
