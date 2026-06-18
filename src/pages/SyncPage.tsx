import { useState, useMemo, useEffect, useRef, Fragment, type ReactNode } from "react";
import {
  Card,
  CardContent,
  Button,
  Badge,
  Alert,
  AlertDescription,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Icons,
  PrivacyAmount,
  useBalancePrivacy,
} from "@wealthfolio/ui";
import type {
  Account,
  ActivityDetails,
  ActivityType,
  ActivityImport,
} from "@wealthfolio/addon-sdk";
import {
  fetchAccounts,
  matchTransactions,
  saveConfig,
  getCachedResponse,
  setCachedResponse,
  clearResponseCache,
  CACHE_TTL_MS,
  getApiLog,
  appendApiLog,
  getApiStats,
  getSkippedIds,
  addSkippedId,
  addSkippedIds,
  removeSkippedId,
  clearSkippedIds,
  getErrorMessage,
  SYNC_DAYS_OPTIONS,
  STALE_THRESHOLD_OPTIONS,
  guessActivityType,
  guessSymbol,
  CASH_TYPES,
  INVESTMENT_TYPES,
  PAGE_SIZE,
} from "../lib";
import type { ApiLogEntry, ApiStats } from "../lib";
import { useBankSyncAddon } from "../contexts/BankSyncAddonProvider";
import type {
  TransactionMatch,
  SimpleFinAccount,
  SimpleFinResponse,
  SyncDays,
  StaleThresholdHours,
  AccountMapping,
} from "../types";
import { formatDistanceToNow } from "../lib/date";
import { ConfettiBurst, PopoverApiLog, PageHeader, SfErrorsAlert } from "../components";

const ACTIVITY_ICONS: Record<string, ReactNode> = {
  BUY: <Icons.TrendingUp className="h-3.5 w-3.5" />,
  SELL: <Icons.TrendingDown className="h-3.5 w-3.5" />,
  DEPOSIT: <Icons.Download className="h-3.5 w-3.5" />,
  WITHDRAWAL: <Icons.ArrowUp className="h-3.5 w-3.5" />,
  DIVIDEND: <Icons.DollarSign className="h-3.5 w-3.5" />,
  INTEREST: <Icons.Percent className="h-3.5 w-3.5" />,
  FEE: <Icons.Receipt className="h-3.5 w-3.5" />,
  TAX: <Icons.FileText className="h-3.5 w-3.5" />,
  TRANSFER_IN: <Icons.ArrowLeftRight className="h-3.5 w-3.5" />,
  TRANSFER_OUT: <Icons.ArrowLeftRight className="h-3.5 w-3.5" />,
};

type Step = "idle" | "fetching" | "reviewing" | "confirming" | "importing" | "done";

function buildComment(sfTx: { description: string; payee?: string; memo?: string }): string {
  const seen = new Set<string>();
  const labeled: { label: string; value: string }[] = [
    { label: "Description", value: sfTx.description },
    { label: "Payee", value: sfTx.payee ?? "" },
    { label: "Memo", value: sfTx.memo ?? "" },
  ];
  return labeled
    .filter(({ value }) => !!value && !seen.has(value) && !!seen.add(value))
    .map(({ label, value }) => `${label}: ${value}`)
    .join("\n");
}

function txKey(m: TransactionMatch) {
  return `${m.simpleFinAccountId}:${m.simpleFinTransaction.id}`;
}

function toImportBase(match: TransactionMatch) {
  const sfTx = match.simpleFinTransaction;
  const amount = Math.abs(parseFloat(sfTx.amount));
  const isCash = CASH_TYPES.includes(match.resolvedActivityType!);
  return { sfTx, amount, isCash, dateIso: new Date(sfTx.posted * 1000).toISOString() };
}

function buildReconcileActivity(
  accountId: string,
  diff: number,
  absAmt: number,
  currency: string,
  dateIso: string,
  balanceDate: number,
): ActivityImport {
  return {
    accountId,
    activityType: (diff > 0 ? "DEPOSIT" : "WITHDRAWAL") as ActivityType,
    date: dateIso,
    symbol: `$CASH-${currency}`,
    quantity: 1,
    unitPrice: absAmt,
    amount: absAmt,
    currency,
    fee: 0,
    isDraft: false,
    isValid: true,
    comment: `Balance reconciliation — SimpleFin reported ${currency} ${absAmt.toFixed(2)} on ${new Date(balanceDate * 1000).toLocaleDateString()}`,
  };
}



export function SyncPage() {
  const { ctx, accessUrl, config, refresh } = useBankSyncAddon();
  const { isBalanceHidden } = useBalancePrivacy();

  const [step, setStep] = useState<Step>("idle");
  const [sfErrors, setSfErrors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [highMatches, setHighMatches] = useState<TransactionMatch[]>([]);
  const [pendingMatches, setPendingMatches] = useState<TransactionMatch[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [importResults, setImportResults] = useState<{ imported: number; errors: number } | null>(
    null,
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [skippedIds, setSkippedIds] = useState<Set<string>>(() => getSkippedIds());
  const [permanentlySkippedMatches, setPermanentlySkippedMatches] = useState<TransactionMatch[]>(
    [],
  );
  const [descriptionOverrides, setDescriptionOverrides] = useState<Record<string, string>>({});
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [cacheTimestamp, setCacheTimestamp] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);
  const [accountTypeMap, setAccountTypeMap] = useState<Map<string, boolean>>(new Map());

  // Which SimpleFin account is currently being synced (null = idle)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  // Wealthfolio accounts loaded on mount for stale-mapping detection
  const [wfAccountMap, setWfAccountMap] = useState<Map<string, Account>>(new Map());
  const [wfAccountsLoaded, setWfAccountsLoaded] = useState(false);
  const [idleActivities, setIdleActivities] = useState<ActivityDetails[]>([]);
  const [wfCashBalances, setWfCashBalances] = useState<Map<string, number>>(new Map());
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);

  const [balanceDiscrepancy, setBalanceDiscrepancy] = useState<{
    sfBalance: number;
    wfBalance: number;
    diff: number;
    balanceDate: number;
    currency: string;
  } | null>(null);

  // Pending quick-reconcile confirmation (idle page card button)
  const [reconcileConfirm, setReconcileConfirm] = useState<{
    mapping: AccountMapping;
    sfBalance: number;
    wfBalance: number;
    balanceDate: number;
  } | null>(null);

  const [apiLog, setApiLog] = useState<ApiLogEntry[]>(() => getApiLog());
  const apiStats: ApiStats = useMemo(() => getApiStats(apiLog), [apiLog]);

  // Count skipped IDs scoped to the currently selected account
  const accountSkippedCount = useMemo(
    () =>
      selectedAccountId
        ? [...skippedIds].filter((id) => id.startsWith(`${selectedAccountId}:`)).length
        : 0,
    [skippedIds, selectedAccountId],
  );

  const [localSettings, setLocalSettings] = useState({
    staleThresholdHours: (config?.staleThresholdHours ?? 48) as StaleThresholdHours,
    syncDays: (config?.syncDays ?? 90) as SyncDays,
  });

  useEffect(() => {
    if (config) {
      setLocalSettings({
        staleThresholdHours: config.staleThresholdHours,
        syncDays: config.syncDays,
      });
    }
  }, [config]);

  // Load WF accounts and activities on mount
  useEffect(() => {
    ctx.api.accounts
      .getAll()
      .then((accounts) => {
        setWfAccountMap(new Map(accounts.map((a) => [a.id, a])));
        setWfAccountsLoaded(true);
      })
      .catch(() => {
        setWfAccountsLoaded(true);
      });
    (ctx.api.activities.getAll() as Promise<ActivityDetails[]>)
      .then(setIdleActivities)
      .catch(() => {});
  }, [ctx]);

  // Load cash balances for each mapped account (holdings-based, since Account has no balance field)
  useEffect(() => {
    if (!wfAccountsLoaded || !config?.mappings.length) return;
    Promise.all(
      config.mappings.map(async (m) => {
        const cash = await ctx.api.portfolio
          .getHoldings(m.wealthfolioAccountId)
          .then((h) =>
            h.filter((x) => x.holdingType === "cash").reduce((s, x) => s + x.marketValue.local, 0),
          )
          .catch(() => NaN);
        return [m.wealthfolioAccountId, cash] as const;
      }),
    ).then((entries) => setWfCashBalances(new Map(entries)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wfAccountsLoaded]);

  const staleMs = (config?.staleThresholdHours ?? 48) * 60 * 60 * 1000;
  const lastFetch = cacheTimestamp ?? config?.lastFetchTimestamp ?? null;
  const isStale = !lastFetch || Date.now() - lastFetch > staleMs;
  const selectedMapping = config?.mappings.find((m) => m.simpleFinAccountId === selectedAccountId);

  const cachedAccountMap = useMemo(() => {
    const cached = getCachedResponse();
    if (!cached) return new Map<string, SimpleFinAccount>();
    return new Map<string, SimpleFinAccount>(cached.data.accounts.map((a) => [a.id, a]));
  }, [cacheTimestamp]);

  const unmappedSfAccounts = useMemo(() => {
    const mappedIds = new Set(config?.mappings.map((m) => m.simpleFinAccountId) ?? []);
    return [...cachedAccountMap.values()].filter((a) => !mappedIds.has(a.id));
  }, [cachedAccountMap, config]);

  // Per-account idle stats: skipped / matched (has WF activity) / unmatched (new)
  const idleAccountStats = useMemo(() => {
    if (!config?.mappings.length) return new Map<string, { skipped: number; matched: number; unmatched: number }>();
    return new Map(
      config.mappings.map((mapping) => {
        const sfAccount = cachedAccountMap.get(mapping.simpleFinAccountId);
        const settled = (sfAccount?.transactions ?? []).filter((tx) => !tx.pending);
        const matches = idleActivities.length
          ? matchTransactions(settled, idleActivities, mapping)
          : [];
        const skipped = settled.filter((tx) => skippedIds.has(`${mapping.simpleFinAccountId}:${tx.id}`)).length;
        const matched = matches.filter((m) => m.confidence !== "new" && !skippedIds.has(`${mapping.simpleFinAccountId}:${m.simpleFinTransaction.id}`)).length;
        const unmatched = matches.filter((m) => m.confidence === "new" && !skippedIds.has(`${mapping.simpleFinAccountId}:${m.simpleFinTransaction.id}`)).length;
        return [mapping.simpleFinAccountId, { skipped, matched, unmatched }] as const;
      }),
    );
  }, [config, cachedAccountMap, idleActivities, skippedIds]);

  const showInvestmentCols = useMemo(
    () => Array.from(accountTypeMap.values()).some(Boolean),
    [accountTypeMap],
  );

  // ── Sync ─────────────────────────────────────────────────────────────────

  function handleAccountManage(sfAccountId: string) {
    setSelectedAccountId(sfAccountId);
    doSync(false, sfAccountId);
  }

  function handleGlobalSync() {
    setConfirmOpen(true);
  }

  async function fetchOrUseCache(force: boolean): Promise<SimpleFinResponse> {
    const cached = getCachedResponse();
    if (!force && cached) {
      setCacheTimestamp(cached.timestamp);
      return cached.data;
    }
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (config!.syncDays ?? 90));
    const sfResponse = await fetchAccounts(accessUrl!, start, end);
    const fetchedAt = Date.now();
    setCachedResponse(sfResponse);
    setCacheTimestamp(fetchedAt);
    appendApiLog({ timestamp: fetchedAt, syncDays: config!.syncDays ?? 90 });
    setApiLog(getApiLog());
    await saveConfig(ctx.api.secrets, { ...config!, lastFetchTimestamp: fetchedAt });
    refresh();
    return sfResponse;
  }

  async function doGlobalFetch(forceFresh: boolean) {
    if (!accessUrl || !config) return;
    setIsSyncing(true);
    setError(null);
    setSfErrors([]);
    try {
      const sfResponse = await fetchOrUseCache(forceFresh);
      const realErrors = (sfResponse.errlist ?? []).map((e) => e.message).filter(Boolean);
      if (realErrors.length > 0) setSfErrors(realErrors);
    } catch (err) {
      setError(getErrorMessage(err, "Sync failed."));
    } finally {
      setIsSyncing(false);
    }
  }

  function resetToIdle() {
    setStep("idle");
    setSelectedAccountId(null);
    setImportResults(null);
    setError(null);
    setSfErrors([]);
    setPendingCount(0);
    setDescriptionOverrides({});
    setExpandedRows(new Set());
    setPermanentlySkippedMatches([]);
    setBalanceDiscrepancy(null);
  }

  async function getWfCashBalance(wfAccountId: string): Promise<number> {
    const holdings = await ctx.api.portfolio.getHoldings(wfAccountId).catch(() => []);
    return holdings
      .filter((h) => h.holdingType === "cash")
      .reduce((s, h) => s + h.marketValue.local, 0);
  }

  async function doSync(force: boolean, sfAccountId?: string) {
    const accountId = sfAccountId ?? selectedAccountId;
    if (!accessUrl || !config || !accountId) return;

    const mappingToSync = config.mappings.find((m) => m.simpleFinAccountId === accountId);
    if (!mappingToSync) return;

    setStep("fetching");
    setError(null);
    setSfErrors([]);
    setImportResults(null);
    setDismissed(new Set());

    try {
      const [wfActivities, wfAccounts] = await Promise.all([
        ctx.api.activities.getAll() as Promise<ActivityDetails[]>,
        ctx.api.accounts.getAll(),
      ]);

      // Refresh WF account map with live data
      const freshWfMap = new Map(wfAccounts.map((a) => [a.id, a]));
      setWfAccountMap(freshWfMap);

      const wfAccount = freshWfMap.get(mappingToSync.wealthfolioAccountId);
      const isSecurities = wfAccount?.accountType === "SECURITIES";
      setAccountTypeMap(new Map([[accountId, isSecurities]]));

      const sfResponse = await fetchOrUseCache(force);

      const realErrors = (sfResponse.errlist ?? []).map((e) => e.message).filter(Boolean);
      if (realErrors.length > 0) setSfErrors(realErrors);

      const sfAccount = sfResponse.accounts.find((a) => a.id === mappingToSync.simpleFinAccountId);
      if (!sfAccount) {
        setError(`No data returned for "${mappingToSync.simpleFinAccountName}" from SimpleFin.`);
        setStep("idle");
        return;
      }

      // Filter out pending and zero-amount transactions — they can't be meaningfully imported
      const settled = sfAccount.transactions.filter(
        (tx) => !tx.pending && parseFloat(tx.amount) !== 0,
      );
      setPendingCount(sfAccount.transactions.length - settled.length);

      const allMatches = matchTransactions(settled, wfActivities, mappingToSync);

      const currentSkipped = getSkippedIds();
      setSkippedIds(currentSkipped);

      setHighMatches(allMatches.filter((m) => m.confidence === "high"));
      const enrichMatch = (m: TransactionMatch) => ({
        ...m,
        resolvedActivityType:
          m.resolvedActivityType ?? guessActivityType(m.simpleFinTransaction, isSecurities),
        resolvedSymbol:
          m.resolvedSymbol ?? guessSymbol(m.simpleFinTransaction, isSecurities, m.currency),
      });
      setPermanentlySkippedMatches(
        allMatches
          .filter((m) => m.confidence !== "high" && currentSkipped.has(txKey(m)))
          .map(enrichMatch),
      );
      const pending = allMatches
        .filter((m) => m.confidence !== "high" && !currentSkipped.has(txKey(m)))
        .map(enrichMatch);
      setPendingMatches(pending);
      setVisibleCount(PAGE_SIZE);

      // Nothing actionable to review — skip straight to done and check balance
      if (pending.length === 0) {
        setImportResults({ imported: 0, errors: 0 });
        if (!isSecurities) {
          const sfBalance = parseFloat(sfAccount.balance);
          const sfBalanceDate = sfAccount["balance-date"] ?? Math.floor(Date.now() / 1000);
          if (!isNaN(sfBalance)) {
            const wfCash = await getWfCashBalance(mappingToSync.wealthfolioAccountId);
            const diff = sfBalance - wfCash;
            if (Math.abs(diff) > 0.005) {
              setBalanceDiscrepancy({
                sfBalance,
                wfBalance: wfCash,
                diff,
                balanceDate: sfBalanceDate,
                currency: mappingToSync.simpleFinCurrency,
              });
            }
          }
        }
        setStep("done");
        return;
      }

      setStep("reviewing");
    } catch (err) {
      setError(getErrorMessage(err, "Sync failed."));
      setStep("idle");
    }
  }

  // ── Import ────────────────────────────────────────────────────────────────

  async function doImport() {
    const toImport = pendingMatches.filter(
      (m) => !dismissed.has(txKey(m)) && m.resolvedActivityType,
    );
    setStep("importing");

    let imported = 0;
    let errors = 0;

    // Get WF balance BEFORE import — portfolio may not reflect newly imported
    // transactions immediately, so we compute expected post-import balance manually
    const isCashAccount = !!(selectedAccountId && !accountTypeMap.get(selectedAccountId));
    let preImportWfCash = NaN;
    if (isCashAccount && selectedMapping) {
      preImportWfCash = await getWfCashBalance(selectedMapping.wealthfolioAccountId);
    }

    // Net delta of transactions being imported (SimpleFin amounts carry correct sign)
    const netImportedDelta = toImport.reduce(
      (sum, m) => sum + parseFloat(m.simpleFinTransaction.amount),
      0,
    );

    if (toImport.length === 0) {
      // Nothing to import — skip straight to balance check and done
      setImportResults({ imported: 0, errors: 0 });
      setPendingMatches([]);
      setDismissed(new Set());
    } else {
      const activities: ActivityImport[] = toImport.map((match) => {
        const { sfTx, amount, isCash, dateIso } = toImportBase(match);
        return {
          accountId: match.wealthfolioAccountId,
          activityType: match.resolvedActivityType!,
          date: dateIso,
          symbol: match.resolvedSymbol ?? (isCash ? `$CASH-${match.currency}` : ""),
          quantity: 1,
          unitPrice: amount,
          amount,
          currency: match.currency,
          fee: 0,
          isDraft: false,
          comment: descriptionOverrides[txKey(match)] ?? buildComment(sfTx),
          isValid: true,
        };
      });

      // checkImport requires a single accountId — validate each account's batch separately
      const byAccount = new Map<string, ActivityImport[]>();
      for (const a of activities) {
        if (!byAccount.has(a.accountId)) byAccount.set(a.accountId, []);
        byAccount.get(a.accountId)!.push(a);
      }

      try {
        const allValid: ActivityImport[] = [];
        for (const [accountId, acctActivities] of byAccount) {
          const checked = await ctx.api.activities.checkImport(accountId, acctActivities);
          allValid.push(...checked.filter((a) => a.isValid));
          errors += checked.filter((a) => !a.isValid).length;
        }
        if (allValid.length > 0) await ctx.api.activities.import(allValid);
        imported = allValid.length;
      } catch {
        try {
          const result = await ctx.api.activities.saveMany({
            creates: toImport.map((match) => {
              const { sfTx, amount, dateIso } = toImportBase(match);
              return {
                accountId: match.wealthfolioAccountId,
                activityType: match.resolvedActivityType!,
                activityDate: dateIso,
                quantity: 1,
                unitPrice: amount,
                amount,
                currency: match.currency,
                fee: 0,
                isDraft: false,
                comment: descriptionOverrides[txKey(match)] ?? buildComment(sfTx),
                ...(match.resolvedSymbol ? { assetId: match.resolvedSymbol } : {}),
              };
            }),
          });
          imported = result.created.length;
          errors = result.errors.length;
        } catch (fallbackErr) {
          setError(fallbackErr instanceof Error ? fallbackErr.message : "Import failed.");
          setStep("confirming");
          return;
        }
      }

      setImportResults({ imported, errors });
      setPendingMatches([]);
      setDismissed(new Set());
    } // end else (toImport.length > 0)

    // Balance reconciliation check (cash accounts only)
    // Use pre-import balance + net delta to avoid depending on async portfolio recalculation
    if (isCashAccount && selectedMapping && !isNaN(preImportWfCash)) {
      const expectedWfBalance = preImportWfCash + netImportedDelta;
      // Update idle-page card immediately so it reflects the post-import balance
      setWfCashBalances(
        (prev) => new Map([...prev, [selectedMapping.wealthfolioAccountId, expectedWfBalance]]),
      );
      const sfAccount = cachedAccountMap.get(selectedAccountId!);
      const sfBalance = parseFloat(sfAccount?.balance ?? "NaN");
      const sfBalanceDate = sfAccount?.["balance-date"] ?? Math.floor(Date.now() / 1000);
      if (!isNaN(sfBalance)) {
        const diff = sfBalance - expectedWfBalance;
        if (Math.abs(diff) > 0.005) {
          setBalanceDiscrepancy({
            sfBalance,
            wfBalance: expectedWfBalance,
            diff,
            balanceDate: sfBalanceDate,
            currency: selectedMapping.simpleFinCurrency,
          });
        }
      }
    }

    setStep("done");
  }

  async function doReconcile() {
    if (!balanceDiscrepancy || !selectedMapping) return;
    const { diff, balanceDate, currency, sfBalance } = balanceDiscrepancy;
    const absAmt = Math.abs(diff);
    const dateIso = new Date(balanceDate * 1000).toISOString().slice(0, 10);
    await ctx.api.activities.import([
      buildReconcileActivity(
        selectedMapping.wealthfolioAccountId,
        diff,
        absAmt,
        currency,
        dateIso,
        balanceDate,
      ),
    ]);
    setBalanceDiscrepancy(null);
    setWfCashBalances(
      (prev) => new Map([...prev, [selectedMapping.wealthfolioAccountId, sfBalance]]),
    );
  }

  async function doQuickReconcile(
    mapping: AccountMapping,
    sfBalance: number,
    wfBalance: number,
    balanceDate: number,
  ) {
    setReconcilingId(mapping.simpleFinAccountId);
    try {
      const diff = sfBalance - wfBalance;
      const absAmt = Math.abs(diff);
      const currency = mapping.simpleFinCurrency;
      const dateIso = new Date(balanceDate * 1000).toISOString().slice(0, 10);
      await ctx.api.activities.import([
        buildReconcileActivity(
          mapping.wealthfolioAccountId,
          diff,
          absAmt,
          currency,
          dateIso,
          balanceDate,
        ),
      ]);
      setWfCashBalances((prev) => new Map([...prev, [mapping.wealthfolioAccountId, sfBalance]]));
    } finally {
      setReconcilingId(null);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function startSettingsLongPress() {
    didLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      setDebugOpen(true);
    }, 700);
  }
  function cancelSettingsLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }

  function setMatchType(key: string, type: ActivityType) {
    setPendingMatches((prev) =>
      prev.map((m) => (txKey(m) === key ? { ...m, resolvedActivityType: type } : m)),
    );
  }

  function setMatchSymbol(key: string, symbol: string) {
    setPendingMatches((prev) =>
      prev.map((m) => (txKey(m) === key ? { ...m, resolvedSymbol: symbol } : m)),
    );
  }

  const { visible, skipped } = useMemo(() => {
    const visible: TransactionMatch[] = [];
    const skipped: TransactionMatch[] = [];
    for (const m of pendingMatches) {
      (dismissed.has(txKey(m)) ? skipped : visible).push(m);
    }
    return { visible, skipped };
  }, [pendingMatches, dismissed]);

  const readyItems = useMemo(() => visible.filter((m) => m.resolvedActivityType), [visible]);

  // Paginated visible matches (single account — no grouping needed in review table)
  const visibleSlice = useMemo(() => visible.slice(0, visibleCount), [visible, visibleCount]);

  // Activity type breakdown for confirming step
  const typeSummary = useMemo(
    () =>
      readyItems.reduce<Record<string, number>>((acc, m) => {
        const t = m.resolvedActivityType!;
        acc[t] = (acc[t] ?? 0) + 1;
        return acc;
      }, {}),
    [readyItems],
  );

  // ── Settings save ─────────────────────────────────────────────────────────

  async function handleSaveSettings() {
    if (!config) return;
    const syncDaysChanged = localSettings.syncDays !== config.syncDays;
    await saveConfig(ctx.api.secrets, { ...config, ...localSettings });
    if (syncDaysChanged) clearResponseCache();
    setSettingsExpanded(false);
    refresh();
  }

  async function handleReconfigureAccounts() {
    if (!config) return;
    await saveConfig(ctx.api.secrets, { ...config, isReconfiguring: true });
    refresh();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const isWide = step === "reviewing";

  return (
    <div
      className={`p-6 mx-auto ${isWide ? "max-w-5xl" : "max-w-3xl"}`}
      style={{ paddingBottom: "calc(1.5rem + var(--mobile-nav-ui-height, 0px) + max(var(--mobile-nav-gap, 0px), env(safe-area-inset-bottom, 0px)))" }}
    >
      {/* Reconciliation confirmation */}
      <AlertDialog
        open={!!reconcileConfirm}
        onOpenChange={(open) => {
          if (!open) setReconcileConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create reconciliation entry?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              {reconcileConfirm &&
                (() => {
                  const { mapping, sfBalance, wfBalance, balanceDate } = reconcileConfirm;
                  const diff = sfBalance - wfBalance;
                  const absAmt = Math.abs(diff);
                  const currency = mapping.simpleFinCurrency;
                  const type = diff > 0 ? "Deposit" : "Withdrawal";
                  return (
                    <>
                      <span className="block">
                        This will create a <strong>{type}</strong> of{" "}
                        <strong>
                          <PrivacyAmount value={absAmt} currency={currency} />
                        </strong>{" "}
                        in <strong>{mapping.wealthfolioAccountName}</strong> dated{" "}
                        <strong>{new Date(balanceDate * 1000).toLocaleDateString()}</strong>.
                      </span>
                      <span className="block text-xs">
                        SimpleFin balance: <PrivacyAmount value={sfBalance} currency={currency} />
                        {" · "}
                        Wealthfolio balance: <PrivacyAmount value={wfBalance} currency={currency} />
                      </span>
                    </>
                  );
                })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!reconcileConfirm) return;
                const { mapping, sfBalance, wfBalance, balanceDate } = reconcileConfirm;
                setReconcileConfirm(null);
                setBalanceDiscrepancy(null);
                doQuickReconcile(mapping, sfBalance, wfBalance, balanceDate);
              }}
            >
              Create Entry
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rate-limit confirmation */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fetch fresh data from SimpleFin?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                SimpleFin allows <strong>up to 24 requests per day</strong>, shared across all apps
                using the same connection (e.g. Actual Budget).
              </span>
              {lastFetch ? (
                <span className="block">
                  Last fetched <strong>{formatDistanceToNow(lastFetch)} ago</strong>.
                </span>
              ) : (
                <span className="block">No data has been fetched yet.</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {lastFetch && (
              <AlertDialogCancel
                onClick={() => {
                  doGlobalFetch(false);
                }}
              >
                Continue using cached data
              </AlertDialogCancel>
            )}
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                doGlobalFetch(true);
              }}
            >
              Fetch fresh data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Debug dialog — triggered by long-pressing the Settings button */}
      <AlertDialog open={debugOpen} onOpenChange={setDebugOpen}>
        <AlertDialogContent className="max-w-3xl flex flex-col" style={{ maxHeight: "80vh" }}>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Icons.FileJson className="h-4 w-4" />
              Debug Data
            </AlertDialogTitle>
            <AlertDialogDescription>
              Raw API response, config, and call history
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex-1 overflow-auto min-h-0">
            <pre className="text-xs font-mono bg-muted rounded-md p-4 whitespace-pre-wrap break-all">
              {JSON.stringify(
                {
                  accessUrl: accessUrl?.replace(/\/\/[^@]+@/, "//***@") ?? null,
                  config,
                  cache: getCachedResponse(),
                  apiLog: getApiLog(),
                },
                null,
                2,
              )}
            </pre>
          </div>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setDebugOpen(false)}>Close</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PageHeader
        icon={step === "idle" ? <Icons.Refresh className="h-5 w-5 text-primary" /> : undefined}
        title={step === "idle" ? "Bank Sync" : (selectedMapping?.simpleFinAccountName ?? "Syncing")}
        subtitle={
          step === "fetching"
            ? "Syncing…"
            : step === "reviewing"
              ? "Review"
              : step === "confirming"
                ? "Confirm Import"
                : step === "importing"
                  ? "Importing…"
                  : step === "done"
                    ? "Import Complete"
                    : undefined
        }
        onBack={
          step === "fetching"
            ? resetToIdle
            : step === "reviewing"
              ? resetToIdle
              : step === "confirming"
                ? () => setStep("reviewing")
                : step === "done"
                  ? resetToIdle
                  : undefined
        }
        actions={
          step === "reviewing" ? (
            <Button onClick={() => setStep("confirming")}>Confirm Import</Button>
          ) : undefined
        }
      />

      {/* Alerts */}
      <SfErrorsAlert errors={sfErrors} />
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ── Step: idle ── */}
      {step === "idle" && !error && (
        <div className="space-y-4">
          {/* Account cards — mapped accounts + unlinked SimpleFin accounts */}
          <div
            className={`grid gap-3 ${(config?.mappings.length ?? 0) + unmappedSfAccounts.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
          >
            {config?.mappings.map((mapping) => {
              const cachedSf = cachedAccountMap.get(mapping.simpleFinAccountId);
              const wfAccount = wfAccountMap.get(mapping.wealthfolioAccountId);
              const wfMissing = wfAccountsLoaded && !wfAccount;
              const isSecuritiesCard = wfAccount?.accountType === "SECURITIES";

              const sfBalance = cachedSf ? parseFloat(cachedSf.balance) : NaN;
              const wfBalance = wfCashBalances.get(mapping.wealthfolioAccountId) ?? NaN;
              const balanceDiff =
                !isNaN(sfBalance) && !isNaN(wfBalance) ? sfBalance - wfBalance : NaN;
              const hasMismatch =
                !isSecuritiesCard && !isNaN(balanceDiff) && Math.abs(balanceDiff) > 0.005;

              const fmtSfIsNeg = cachedSf ? parseFloat(cachedSf.balance) < 0 : false;
              const fmtWfIsNeg = !isNaN(wfBalance) ? wfBalance < 0 : false;

              const stats = idleAccountStats.get(mapping.simpleFinAccountId);
              const hasAttentionNeeded = !!stats && (stats.unmatched > 0 || stats.skipped > 0);

              const cardStyle: React.CSSProperties | undefined = wfMissing
                ? { borderColor: "var(--destructive)", backgroundColor: "color-mix(in srgb, var(--destructive) 5%, transparent)" }
                : hasAttentionNeeded
                  ? { borderColor: "var(--warning)", backgroundColor: "color-mix(in srgb, var(--warning) 5%, transparent)" }
                  : hasMismatch
                    ? { borderColor: "color-mix(in srgb, var(--warning) 50%, transparent)", backgroundColor: "color-mix(in srgb, var(--warning) 5%, transparent)" }
                    : undefined;

              return (
                <Card
                  key={mapping.simpleFinAccountId}
                  style={cardStyle}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">
                          {mapping.simpleFinAccountName}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {cachedSf?.org?.name ?? "SimpleFin"} · {mapping.simpleFinCurrency}
                        </p>
                      </div>
                      {wfMissing ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0 border-destructive text-destructive text-xs h-7"
                          onClick={handleReconfigureAccounts}
                        >
                          Reconfigure
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0 h-7 text-xs"
                          onClick={() => handleAccountManage(mapping.simpleFinAccountId)}
                          disabled={isSyncing}
                        >
                          Manage
                        </Button>
                      )}
                    </div>

                    {wfMissing ? (
                      <p className="text-xs text-destructive">
                        The linked Wealthfolio account was deleted. Click Reconfigure to re-map this
                        account.
                      </p>
                    ) : (
                      <>
                        {/* Balance row */}
                        {hasMismatch ? (
                          <>
                            <div className="flex items-end gap-4 mb-1">
                              <div>
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">
                                  SimpleFin
                                </p>
                                <p
                                  className={`text-xl font-bold font-mono ${fmtSfIsNeg ? "text-red-500" : ""}`}
                                >
                                  {cachedSf ? (
                                    <PrivacyAmount
                                      value={Math.abs(parseFloat(cachedSf.balance))}
                                      currency={mapping.simpleFinCurrency}
                                    />
                                  ) : (
                                    "—"
                                  )}
                                </p>
                              </div>
                              <div>
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">
                                  Wealthfolio
                                </p>
                                <p
                                  className={`text-xl font-bold font-mono ${fmtWfIsNeg ? "text-red-500" : ""}`}
                                >
                                  {!isNaN(wfBalance) ? (
                                    <PrivacyAmount
                                      value={Math.abs(wfBalance)}
                                      currency={mapping.simpleFinCurrency}
                                    />
                                  ) : (
                                    "—"
                                  )}
                                </p>
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full h-7 text-xs mt-2"
                              disabled={reconcilingId === mapping.simpleFinAccountId}
                              onClick={() =>
                                setReconcileConfirm({
                                  mapping,
                                  sfBalance,
                                  wfBalance,
                                  balanceDate:
                                    cachedSf?.["balance-date"] ?? Math.floor(Date.now() / 1000),
                                })
                              }
                            >
                              {reconcilingId === mapping.simpleFinAccountId ? (
                                <Icons.Spinner className="h-3 w-3 animate-spin" />
                              ) : (
                                <>
                                  <Icons.ArrowLeftRight className="h-3 w-3 mr-1" />
                                  Reconcile {!isBalanceHidden && (balanceDiff > 0 ? "+" : "")}
                                  <PrivacyAmount
                                    value={Math.abs(balanceDiff)}
                                    currency={mapping.simpleFinCurrency}
                                  />
                                </>
                              )}
                            </Button>
                          </>
                        ) : (
                          <div className="flex items-center gap-2 mb-1">
                            <p
                              className={`text-xl font-bold font-mono ${fmtSfIsNeg ? "text-red-500" : ""}`}
                            >
                              {cachedSf ? (
                                <PrivacyAmount
                                  value={Math.abs(parseFloat(cachedSf.balance))}
                                  currency={mapping.simpleFinCurrency}
                                />
                              ) : (
                                "—"
                              )}
                            </p>
                            {!isNaN(wfBalance) && !isNaN(sfBalance) && (
                              <Icons.CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                            )}
                          </div>
                        )}

                        {cachedSf && stats && (
                            <div className="mt-3 pt-2 border-t">
                              <div className="grid grid-cols-3 divide-x">
                                <div className="flex flex-col items-center gap-0.5 py-1">
                                  <span className={`text-sm font-bold tabular-nums ${stats.unmatched > 0 ? "text-amber-500 dark:text-amber-400" : "text-muted-foreground"}`}>
                                    {stats.unmatched}
                                  </span>
                                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">New</span>
                                </div>
                                <div className="flex flex-col items-center gap-0.5 py-1">
                                  <span className="text-sm font-bold tabular-nums text-green-500 dark:text-green-400">
                                    {stats.matched}
                                  </span>
                                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Matched</span>
                                </div>
                                <div className="flex flex-col items-center gap-0.5 py-1">
                                  <span className={`text-sm font-bold tabular-nums ${stats.skipped > 0 ? "text-amber-500 dark:text-amber-400" : "text-muted-foreground"}`}>
                                    {stats.skipped}
                                  </span>
                                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Skipped</span>
                                </div>
                              </div>
                              {isStale && lastFetch && (
                                <p className="text-[10px] text-yellow-600 dark:text-yellow-400 text-center pt-1">
                                  Data may be stale
                                </p>
                              )}
                            </div>
                          )}
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}

            {/* Unlinked SimpleFin accounts — in cache but not yet mapped */}
            {unmappedSfAccounts.map((sfAccount) => {
              const isNeg = parseFloat(sfAccount.balance) < 0;
              return (
                <Card key={sfAccount.id} className="border-dashed">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{sfAccount.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {sfAccount.org?.name ?? "SimpleFin"} · {sfAccount.currency}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 h-7 text-xs"
                        onClick={handleReconfigureAccounts}
                      >
                        Link Account
                      </Button>
                    </div>
                    <p className={`text-xl font-bold font-mono ${isNeg ? "text-red-500" : ""}`}>
                      <PrivacyAmount value={Math.abs(parseFloat(sfAccount.balance))} currency={sfAccount.currency} />
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">Not linked to Wealthfolio</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Global sync button */}
          <Button
            variant="outline"
            className="w-full"
            onClick={handleGlobalSync}
            disabled={isSyncing}
          >
            {isSyncing ? (
              <>
                <Icons.Spinner className="h-4 w-4 mr-2 animate-spin" />
                Fetching...
              </>
            ) : (
              <>
                <Icons.Refresh className="h-4 w-4 mr-2" />
                Sync All Account Data
              </>
            )}
          </Button>

          {/* Settings — expandable section */}
          <Collapsible open={settingsExpanded} onOpenChange={setSettingsExpanded}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-between text-sm text-muted-foreground px-3 h-9"
                onMouseDown={startSettingsLongPress}
                onMouseUp={cancelSettingsLongPress}
                onMouseLeave={cancelSettingsLongPress}
                onTouchStart={(e) => {
                  e.preventDefault();
                  startSettingsLongPress();
                }}
                onTouchEnd={cancelSettingsLongPress}
                onClick={(e) => {
                  if (didLongPress.current) {
                    e.stopPropagation();
                    didLongPress.current = false;
                  }
                }}
              >
                <span className="flex items-center gap-2">
                  <Icons.Settings className="h-4 w-4" />
                  Settings
                  <span className="text-xs">
                    · {localSettings.syncDays} day window
                    {lastFetch
                      ? ` · Last fetched ${formatDistanceToNow(lastFetch)} ago`
                      : " · Never fetched"}
                  </span>
                </span>
                <Icons.ChevronDown
                  className={`h-4 w-4 transition-transform ${settingsExpanded ? "rotate-180" : ""}`}
                />
              </Button>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <Card className="mt-2">
                <CardContent className="p-5 space-y-6">
                  {/* SimpleFin Connection */}
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      SimpleFin Connection
                    </p>

                    {/* Last fetch */}
                    <div className="flex items-baseline justify-between gap-4 text-sm">
                      <span className="text-muted-foreground shrink-0">Last fetched</span>
                      <span className="text-right">
                        {lastFetch
                          ? `${new Date(lastFetch).toLocaleString()} (${formatDistanceToNow(lastFetch)} ago)`
                          : "Never"}
                      </span>
                    </div>

                    {/* API call stats grid */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-md border bg-muted/30 p-3">
                        <p className="text-xs text-muted-foreground">Today</p>
                        <p
                          className={`text-xl font-bold mt-0.5 ${apiStats.today >= 20 ? "text-yellow-600 dark:text-yellow-400" : ""}`}
                        >
                          {apiStats.today}
                          <span className="text-xs font-normal text-muted-foreground ml-1">
                            / 24
                          </span>
                        </p>
                      </div>
                      <div className="rounded-md border bg-muted/30 p-3">
                        <p className="text-xs text-muted-foreground">This week</p>
                        <p className="text-xl font-bold mt-0.5">{apiStats.thisWeek}</p>
                      </div>
                      <div className="rounded-md border bg-muted/30 p-3">
                        <p className="text-xs text-muted-foreground">This month</p>
                        <p className="text-xl font-bold mt-0.5">{apiStats.thisMonth}</p>
                      </div>
                      <div className="rounded-md border bg-muted/30 p-3">
                        <p className="text-xs text-muted-foreground">Avg / active day</p>
                        <p className="text-xl font-bold mt-0.5">
                          {apiStats.avgPerDay > 0 ? apiStats.avgPerDay : "—"}
                        </p>
                      </div>
                    </div>

                    {/* Busiest hour + total */}
                    {apiLog.length > 0 && (
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {apiStats.busiestHour !== null && (
                            <>
                              Most active:{" "}
                              {apiStats.busiestHour === 0
                                ? "12 AM"
                                : apiStats.busiestHour < 12
                                  ? `${apiStats.busiestHour} AM`
                                  : apiStats.busiestHour === 12
                                    ? "12 PM"
                                    : `${apiStats.busiestHour - 12} PM`}
                            </>
                          )}
                        </span>
                        <PopoverApiLog log={apiLog} total={apiStats.total} />
                      </div>
                    )}

                    <p className="text-xs text-muted-foreground leading-relaxed">
                      SimpleFin allows <strong>24 requests per day</strong>, shared across all apps
                      using this connection (e.g. Actual Budget, Monarch). The daily count resets at
                      midnight.
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      <strong>Pending transactions</strong> are automatically excluded from the
                      review table — they have no settled amount yet and can't be imported. They'll
                      appear on your next sync once the bank posts them.
                    </p>
                  </div>

                  <Separator />

                  {/* Sync Window */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Sync Window
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      When syncing, SimpleFin sends all transactions posted within this window. Use{" "}
                      <strong>30 days</strong> if you sync often and just want recent activity. Use{" "}
                      <strong>90 days</strong> if you sync infrequently or want to catch older
                      transactions you may have missed. Changing this clears the local cache when
                      you save.
                    </p>
                    <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
                      {SYNC_DAYS_OPTIONS.map((opt) => (
                        <Button
                          key={opt.value}
                          variant={localSettings.syncDays === opt.value ? "default" : "ghost"}
                          size="sm"
                          className="h-7 text-xs px-3"
                          onClick={() => setLocalSettings((s) => ({ ...s, syncDays: opt.value }))}
                        >
                          {opt.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <Separator />

                  {/* Data Freshness Warning */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Data Freshness Warning
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Show a "stale" indicator on account cards when data hasn't been refreshed
                      within this period.
                    </p>
                    <Select
                      value={String(localSettings.staleThresholdHours)}
                      onValueChange={(v) =>
                        setLocalSettings((s) => ({
                          ...s,
                          staleThresholdHours: Number(v) as StaleThresholdHours,
                        }))
                      }
                    >
                      <SelectTrigger className="h-8 text-sm w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STALE_THRESHOLD_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={String(o.value)}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Separator />

                  {/* Account Mapping */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Account Mapping
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Change which Wealthfolio accounts your SimpleFin accounts sync into, or
                      connect new accounts.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={handleReconfigureAccounts}
                    >
                      <Icons.ArrowLeftRight className="h-4 w-4 mr-2" />
                      Reconfigure Accounts
                    </Button>
                  </div>

                  <Separator />

                  {/* Skipped Transactions */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Skipped Transactions
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {accountSkippedCount > 0
                        ? `${accountSkippedCount} transaction${accountSkippedCount !== 1 ? "s" : ""} permanently skipped for this account. Reset to make them appear in the review table again.`
                        : "No transactions have been permanently skipped for this account yet."}
                    </p>
                    {accountSkippedCount > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          clearSkippedIds();
                          setSkippedIds(new Set());
                        }}
                      >
                        <Icons.Undo className="h-4 w-4 mr-2" />
                        Reset Skipped Transactions
                      </Button>
                    )}
                  </div>

                  <Separator />

                  <Button className="w-full" onClick={handleSaveSettings}>
                    Save Settings
                  </Button>
                </CardContent>
              </Card>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      {/* ── Step: fetching ── */}
      {step === "fetching" && (
        <Card>
          <CardContent className="p-0 divide-y">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-3 w-4 rounded" />
                <Skeleton className="h-3 w-20 rounded" />
                <Skeleton className="h-3 w-36 rounded" />
                <Skeleton className="h-6 w-28 rounded ml-auto" />
                <Skeleton className="h-3 w-16 rounded" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Step: reviewing ── */}
      {step === "reviewing" && (
        <div className="space-y-3">
          {/* Stats bar */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {visible.length} to review
              {skipped.length > 0 && ` · ${skipped.length} skipped this session`}
              {highMatches.length > 0 && ` · ${highMatches.length} already imported`}
              {accountSkippedCount > 0 && ` · ${accountSkippedCount} permanently skipped`}
              {pendingCount > 0 && (
                <span
                  className="ml-2 text-yellow-600 dark:text-yellow-400"
                  title="Pending transactions are excluded — they'll appear once the bank settles them."
                >
                  · {pendingCount} pending excluded
                </span>
              )}
            </span>
            {visible.length > 0 && (
              <button
                className="text-xs hover:text-foreground"
                onClick={() => {
                  const ids = pendingMatches.map(txKey);
                  addSkippedIds(ids);
                  setSkippedIds((prev) => new Set([...prev, ...ids]));
                  setDismissed(new Set(ids));
                }}
              >
                Skip all
              </button>
            )}
          </div>

          {visible.length > 0 ? (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table
                  className={`w-full text-xs ${showInvestmentCols ? "min-w-[900px]" : "min-w-[640px]"}`}
                >
                  <thead className="sticky top-0 bg-background z-10">
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-3 py-2 text-muted-foreground font-medium w-8">
                        #
                      </th>
                      <th className="text-left px-3 py-2 text-muted-foreground font-medium whitespace-nowrap">
                        date
                      </th>
                      <th className="text-left px-3 py-2 text-muted-foreground font-medium">
                        description
                      </th>
                      {showInvestmentCols && (
                        <>
                          <th className="text-left px-3 py-2 text-muted-foreground font-medium">
                            symbol
                          </th>
                          <th className="text-left px-3 py-2 text-muted-foreground font-medium">
                            qty
                          </th>
                        </>
                      )}
                      <th className="text-left px-3 py-2 text-muted-foreground font-medium w-44">
                        activity type
                      </th>
                      {showInvestmentCols && (
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium">
                          unit price
                        </th>
                      )}
                      <th className="text-right px-3 py-2 text-muted-foreground font-medium">
                        amount
                      </th>
                      <th className="px-3 py-2 w-6" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSlice.map((m, i) => {
                      const sfTx = m.simpleFinTransaction;
                      const amount = parseFloat(sfTx.amount);
                      const absAmt = Math.abs(amount);
                      const isNeg = amount < 0;
                      const isSecurities = accountTypeMap.get(m.simpleFinAccountId) ?? false;
                      const symbol = m.resolvedSymbol ?? `$CASH-${m.currency}`;
                      const typeOpts = isSecurities ? INVESTMENT_TYPES : CASH_TYPES;
                      const currentType =
                        m.resolvedActivityType ?? guessActivityType(sfTx, isSecurities);

                      const key = txKey(m);
                      const isExpanded = expandedRows.has(key);
                      const colCount = 6 + (showInvestmentCols ? 3 : 0);

                      return (
                        <Fragment key={key}>
                          <tr className="border-b hover:bg-muted/20 group">
                            <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                            <td className="px-3 py-2 font-mono whitespace-nowrap">
                              {new Date(sfTx.posted * 1000).toISOString().slice(0, 10)}
                            </td>
                            <td className="px-3 py-2 max-w-[240px]">
                              <textarea
                                rows={buildComment(sfTx).split("\n").length}
                                className="w-full bg-transparent font-medium text-xs outline-none border-b border-transparent hover:border-muted-foreground/40 focus:border-primary transition-colors resize-none leading-relaxed"
                                value={descriptionOverrides[txKey(m)] ?? buildComment(sfTx)}
                                title={buildComment(sfTx)}
                                onChange={(e) =>
                                  setDescriptionOverrides((prev) => ({
                                    ...prev,
                                    [txKey(m)]: e.target.value,
                                  }))
                                }
                              />
                            </td>
                            {showInvestmentCols && (
                              <>
                                <td className="px-3 py-2 font-mono w-28">
                                  <input
                                    type="text"
                                    className="w-full bg-transparent font-mono text-xs text-primary outline-none border-b border-transparent hover:border-muted-foreground/40 focus:border-primary transition-colors uppercase placeholder:normal-case placeholder:text-muted-foreground/50"
                                    value={symbol}
                                    placeholder="TICKER"
                                    onChange={(e) =>
                                      setMatchSymbol(key, e.target.value.toUpperCase())
                                    }
                                  />
                                </td>
                                <td className="px-3 py-2 font-mono text-muted-foreground">1</td>
                              </>
                            )}
                            <td className="px-3 py-2 w-44">
                              <Select
                                value={currentType}
                                onValueChange={(val) => setMatchType(txKey(m), val as ActivityType)}
                              >
                                <SelectTrigger className="h-7 text-xs w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {typeOpts.map((t) => (
                                    <SelectItem key={t} value={t} className="text-xs">
                                      <span className="flex items-center gap-1.5">
                                        {ACTIVITY_ICONS[t] ?? (
                                          <Icons.FileText className="h-3.5 w-3.5" />
                                        )}
                                        <span className="capitalize">
                                          {t.toLowerCase().replace(/_/g, " ")}
                                        </span>
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>
                            {showInvestmentCols && (
                              <td className="px-3 py-2 font-mono text-right">
                                {isBalanceHidden ? "••••••" : absAmt.toFixed(2)}
                              </td>
                            )}
                            <td
                              className={`px-3 py-2 font-mono text-right font-medium ${isNeg ? "text-red-500" : "text-green-600"}`}
                            >
                              <PrivacyAmount value={absAmt} currency={m.currency} />
                            </td>
                            <td className="px-3 py-2 relative">
                              <div className="absolute top-2 right-3 flex items-center gap-3">
                                <button
                                  className={`transition-colors ${isExpanded ? "text-primary" : "text-muted-foreground opacity-0 group-hover:opacity-100"} hover:text-foreground`}
                                  title="Show raw data"
                                  onClick={() =>
                                    setExpandedRows((prev) => {
                                      const next = new Set(prev);
                                      next.has(key) ? next.delete(key) : next.add(key);
                                      return next;
                                    })
                                  }
                                >
                                  <Icons.FileJson className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-colors"
                                  title="Skip forever"
                                  onClick={() => {
                                    addSkippedId(key);
                                    setSkippedIds((prev) => new Set([...prev, key]));
                                    setDismissed((prev) => new Set(prev).add(key));
                                  }}
                                >
                                  ✕
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-muted/30 border-b">
                              <td colSpan={colCount} className="px-3 py-2">
                                <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-all leading-relaxed">
                                  {JSON.stringify(sfTx, null, 2)}
                                </pre>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                All transactions reviewed — click "Review Import →" to continue.
              </CardContent>
            </Card>
          )}

          {visible.length > visibleCount && (
            <Button
              variant="outline"
              className="w-full text-sm"
              onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
            >
              Show more ({visible.length - visibleCount} remaining)
            </Button>
          )}

          {/* Permanently skipped collapsible */}
          {permanentlySkippedMatches.length > 0 && (
            <Collapsible>
              <CollapsibleTrigger className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Permanently skipped ({permanentlySkippedMatches.length})
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <Card>
                  <CardContent className="p-0">
                    <table className="w-full text-sm">
                      <tbody>
                        {permanentlySkippedMatches.map((m) => {
                          const sfTx = m.simpleFinTransaction;
                          const isNeg = parseFloat(sfTx.amount) < 0;
                          return (
                            <tr
                              key={txKey(m)}
                              className="border-b last:border-0 opacity-60 hover:opacity-100 group"
                            >
                              <td className="p-3 max-w-[200px]">
                                <p className="truncate">{buildComment(sfTx)}</p>
                              </td>
                              <td className="p-3 text-muted-foreground whitespace-nowrap text-xs">
                                {new Date(sfTx.posted * 1000).toLocaleDateString()}
                              </td>
                              <td
                                className={`p-3 text-right font-medium whitespace-nowrap ${isNeg ? "text-red-500" : "text-green-600"}`}
                              >
                                {!isBalanceHidden && (isNeg ? "-" : "")}
                                <PrivacyAmount value={Math.abs(parseFloat(sfTx.amount))} currency={m.currency} />
                              </td>
                              <td className="p-3 text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() => {
                                    const key = txKey(m);
                                    removeSkippedId(key);
                                    setSkippedIds((prev) => {
                                      const next = new Set(prev);
                                      next.delete(key);
                                      return next;
                                    });
                                    setDismissed((prev) => {
                                      const next = new Set(prev);
                                      next.delete(key);
                                      return next;
                                    });
                                    setPermanentlySkippedMatches((prev) =>
                                      prev.filter((x) => txKey(x) !== key),
                                    );
                                    setPendingMatches((prev) => [m, ...prev]);
                                  }}
                                >
                                  <Icons.Undo className="h-3.5 w-3.5 mr-1" />
                                  Unskip
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Already-imported collapsible */}
          {highMatches.length > 0 && (
            <Collapsible>
              <CollapsibleTrigger className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Already imported ({highMatches.length})
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <Card>
                  <CardContent className="p-0">
                    <table className="w-full text-sm">
                      <tbody>
                        {highMatches.map((m) => {
                          const sfTx = m.simpleFinTransaction;
                          const isNeg = parseFloat(sfTx.amount) < 0;
                          return (
                            <tr key={txKey(m)} className="border-b last:border-0 opacity-60">
                              <td className="p-3 max-w-[200px]">
                                <p className="truncate">
                                  {descriptionOverrides[txKey(m)] ?? buildComment(sfTx)}
                                </p>
                              </td>
                              <td className="p-3 text-muted-foreground whitespace-nowrap text-xs">
                                {new Date(sfTx.posted * 1000).toLocaleDateString()}
                              </td>
                              <td
                                className={`p-3 text-right font-medium whitespace-nowrap ${isNeg ? "text-red-500" : "text-green-600"}`}
                              >
                                {!isBalanceHidden && (isNeg ? "-" : "")}
                                <PrivacyAmount value={Math.abs(parseFloat(sfTx.amount))} currency={m.currency} />
                              </td>
                              <td className="p-3">
                                <Badge variant="outline" className="text-xs">
                                  matched
                                </Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      )}

      {/* ── Step: confirming ── */}
      {(step === "confirming" || step === "importing") && (
        <div className="space-y-6">
          {readyItems.length === 0 && (
            <div className="space-y-3">
              <Alert>
                <AlertDescription>
                  No transactions selected for import — all were skipped. Go back to un-skip any
                  you'd like to import.
                </AlertDescription>
              </Alert>
              <Button
                variant="outline"
                className="w-full"
                onClick={doImport}
                disabled={step === "importing"}
              >
                {step === "importing" ? (
                  <>
                    <Icons.Spinner className="h-4 w-4 mr-2 animate-spin" />
                    Checking...
                  </>
                ) : (
                  <>
                    <Icons.CheckCircle className="h-4 w-4 mr-2" />
                    Continue to Balance Check
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Stats cards */}
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <Icons.Files className="h-5 w-5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="text-2xl font-bold">{pendingMatches.length}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-primary">
              <CardContent className="p-4 flex items-center gap-3">
                <Icons.FileUp className="h-5 w-5 text-primary shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">To Import</p>
                  <p className="text-2xl font-bold text-primary">{readyItems.length}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <Icons.FileX className="h-5 w-5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Skipped</p>
                  <p className="text-2xl font-bold">{pendingMatches.length - readyItems.length}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* By activity type */}
          {Object.keys(typeSummary).length > 0 && (
            <div className="space-y-2">
              <Separator />
              <div className="flex flex-wrap gap-2 pt-2">
                {Object.entries(typeSummary).map(([type, count]) => (
                  <Badge
                    key={type}
                    variant="secondary"
                    className="gap-1.5 px-3 py-1.5 text-sm font-normal"
                  >
                    {ACTIVITY_ICONS[type] ?? <Icons.FileText className="h-3.5 w-3.5" />}
                    <span className="capitalize">{type.toLowerCase().replace(/_/g, " ")}</span>
                    <span className="font-semibold">{count}</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Full-width import button */}
          {readyItems.length > 0 && (
            <Button onClick={doImport} className="w-full" size="lg" disabled={step === "importing"}>
              {step === "importing" ? (
                <>
                  <Icons.Spinner className="h-4 w-4 mr-2 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Icons.FileUp className="h-4 w-4 mr-2" />
                  Import {readyItems.length} {readyItems.length === 1 ? "Activity" : "Activities"}
                </>
              )}
            </Button>
          )}
        </div>
      )}

      {/* ── Step: done ── */}
      {step === "done" && importResults && (
        <div className="py-10 text-center space-y-5 relative">
          {importResults.imported > 0 && <ConfettiBurst />}

          <div
            className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 mx-auto"
            style={{ animation: "check-pop 0.55s cubic-bezier(0.175,0.885,0.32,1.275) forwards" }}
          >
            <Icons.CheckCircle className="h-10 w-10 text-primary" />
          </div>

          <div>
            {importResults.imported > 0 ? (
              <>
                <p className="text-5xl font-bold">{importResults.imported}</p>
                <p className="text-base text-muted-foreground mt-1">
                  transaction{importResults.imported !== 1 ? "s" : ""} imported
                  {selectedMapping && ` into ${selectedMapping.wealthfolioAccountName}`}
                </p>
              </>
            ) : (
              <>
                <p className="text-2xl font-semibold">All caught up</p>
                <p className="text-base text-muted-foreground mt-1">
                  No new transactions to import
                  {selectedMapping && ` for ${selectedMapping.wealthfolioAccountName}`}
                </p>
              </>
            )}
          </div>

          {(importResults.errors > 0 || highMatches.length > 0) && (
            <p className="text-xs text-muted-foreground">
              {importResults.errors > 0 && `${importResults.errors} could not be validated`}
              {importResults.errors > 0 && highMatches.length > 0 && " · "}
              {highMatches.length > 0 && `${highMatches.length} already existed in Wealthfolio`}
            </p>
          )}

          {balanceDiscrepancy && (
            <div className="w-full rounded-lg border bg-muted/30 p-4 space-y-2 text-left">
              <p className="text-sm font-medium flex items-center gap-2">
                <Icons.AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
                Balance mismatch detected
              </p>
              <p className="text-xs text-muted-foreground">
                SimpleFin:{" "}
                <PrivacyAmount
                  value={balanceDiscrepancy.sfBalance}
                  currency={balanceDiscrepancy.currency}
                  className="font-mono font-medium text-foreground"
                />
                {" · "}
                Wealthfolio:{" "}
                <PrivacyAmount
                  value={balanceDiscrepancy.wfBalance}
                  currency={balanceDiscrepancy.currency}
                  className="font-mono font-medium text-foreground"
                />
              </p>
              <p className="text-xs text-muted-foreground">
                Difference:{" "}
                <span
                  className={`font-mono font-medium ${balanceDiscrepancy.diff > 0 ? "text-green-600" : "text-red-500"}`}
                >
                  {!isBalanceHidden && (balanceDiscrepancy.diff > 0 ? "+" : "")}
                  <PrivacyAmount
                    value={balanceDiscrepancy.diff}
                    currency={balanceDiscrepancy.currency}
                  />
                </span>{" "}
                as of {new Date(balanceDiscrepancy.balanceDate * 1000).toLocaleDateString()}
              </p>
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    if (!balanceDiscrepancy || !selectedMapping) return;
                    setReconcileConfirm({
                      mapping: selectedMapping,
                      sfBalance: balanceDiscrepancy.sfBalance,
                      wfBalance: balanceDiscrepancy.wfBalance,
                      balanceDate: balanceDiscrepancy.balanceDate,
                    });
                  }}
                >
                  Create{" "}
                  <PrivacyAmount
                    value={Math.abs(balanceDiscrepancy.diff)}
                    currency={balanceDiscrepancy.currency}
                  />{" "}
                  reconciliation entry
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setBalanceDiscrepancy(null)}>
                  Dismiss
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 w-full mt-2">
            <Button size="lg" className="w-full" onClick={resetToIdle}>
              Done
            </Button>
            {selectedMapping && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  ctx.api.navigation.navigate(
                    `/activities?account=${selectedMapping.wealthfolioAccountId}`,
                  );
                }}
              >
                <Icons.ExternalLink className="h-4 w-4 mr-2" />
                View {selectedMapping.wealthfolioAccountName} Transactions
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
