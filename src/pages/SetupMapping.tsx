import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Alert,
  AlertDescription,
  Badge,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Icons,
  PrivacyAmount,
} from "@wealthfolio/ui";
import type { Account } from "@wealthfolio/addon-sdk";
import {
  fetchAccounts,
  getCachedResponse,
  saveConfig,
  getErrorMessage,
  stringSimilarity,
  SKIP_SENTINEL,
  CREATE_NEW_SENTINEL,
} from "../lib";
import { useBankSyncAddon } from "../contexts/BankSyncAddonProvider";
import { SfErrorsAlert, PageHeader } from "../components";
import type { SimpleFinAccount, AccountMapping } from "../types";
import { DEFAULT_CONFIG } from "../types";

type NewAccountForm = { name: string; accountType: "CASH" | "SECURITIES"; currency: string };

export function SetupMapping() {
  const { ctx, accessUrl, config, refresh, reconfiguring, setReconfiguring } = useBankSyncAddon();
  const [sfAccounts, setSfAccounts] = useState<SimpleFinAccount[]>([]);
  const [wfAccounts, setWfAccounts] = useState<Account[]>([]);
  const [wfBalances, setWfBalances] = useState<Map<string, number>>(new Map());
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [newAccountForms, setNewAccountForms] = useState<Record<string, NewAccountForm>>({});
  const [sfErrors, setSfErrors] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      try {
        const cached = getCachedResponse();
        const [sfResponse, wfAccs] = await Promise.all([
          cached ? Promise.resolve(cached.data) : fetchAccounts(accessUrl!),
          ctx.api.accounts.getAll(),
        ]);
        setSfAccounts(sfResponse.accounts);
        const active = wfAccs.filter((a) => a.isActive);
        setWfAccounts(active);
        const realErrors = (sfResponse.errlist ?? []).map((e) => e.message).filter(Boolean);
        if (realErrors.length > 0) setSfErrors(realErrors);
        if (config?.mappings.length) {
          const existing: Record<string, string> = {};
          for (const m of config.mappings) {
            existing[m.simpleFinAccountId] = m.wealthfolioAccountId;
          }
          setSelections(existing);
        }
        // Fetch holdings balances for all accounts in parallel after the main load
        Promise.all(
          active.map((wf) =>
            ctx.api.portfolio
              .getHoldings(wf.id)
              .then((h) => {
                const relevant = wf.accountType === "SECURITIES" ? h : h.filter((x) => x.holdingType === "cash");
                return relevant.reduce((s, x) => s + x.marketValue.local, 0);
              })
              .catch(() => 0)
              .then((bal) => [wf.id, bal] as const),
          ),
        ).then((entries) => setWfBalances(new Map(entries)));
      } catch (err) {
        setError(getErrorMessage(err, "Failed to load accounts."));
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [accessUrl, ctx, config]);

  function handleSelectChange(sfId: string, value: string) {
    if (value === CREATE_NEW_SENTINEL) {
      const sf = sfAccounts.find((a) => a.id === sfId)!;
      setSelections((prev) => ({ ...prev, [sfId]: CREATE_NEW_SENTINEL }));
      setNewAccountForms((prev) => ({
        ...prev,
        [sfId]: { name: sf.name, accountType: "CASH", currency: sf.currency },
      }));
    } else {
      setSelections((prev) => ({ ...prev, [sfId]: value }));
      setNewAccountForms((prev) => {
        const next = { ...prev };
        delete next[sfId];
        return next;
      });
    }
  }

  function currencyMismatch(sfAccountId: string, wfAccountId: string): boolean {
    const sf = sfAccounts.find((a) => a.id === sfAccountId);
    const wf = wfAccounts.find((a) => a.id === wfAccountId);
    if (!sf || !wf) return false;
    return sf.currency !== wf.currency;
  }

  function handleGuess() {
    const guessed: Record<string, string> = {};
    const claimed = new Set(
      Object.values(selections).filter((v) => v && v !== SKIP_SENTINEL && v !== CREATE_NEW_SENTINEL),
    );

    for (const sf of sfAccounts) {
      if (selections[sf.id]) continue; // don't overwrite existing choices
      const sfBalance = parseFloat(sf.balance) || 0;
      let bestScore = 0;
      let bestWfId: string | null = null;

      for (const wf of wfAccounts) {
        if (wf.currency !== sf.currency) continue;
        if (claimed.has(wf.id)) continue;

        const nameSim = stringSimilarity(sf.name, wf.name);

        const wfBal = wfBalances.get(wf.id);
        let balScore = 0;
        if (wfBal !== undefined) {
          const maxAbs = Math.max(Math.abs(sfBalance), Math.abs(wfBal), 1);
          const pct = Math.abs(sfBalance - wfBal) / maxAbs;
          balScore = pct < 0.02 ? 1 : pct < 0.1 ? 0.5 : pct < 0.25 ? 0.2 : 0;
        }

        const score = wfBal !== undefined ? nameSim * 0.6 + balScore * 0.4 : nameSim;
        if (score > bestScore) {
          bestScore = score;
          bestWfId = wf.id;
        }
      }

      if (bestScore >= 0.4 && bestWfId) {
        guessed[sf.id] = bestWfId;
        claimed.add(bestWfId);
      }
    }

    if (Object.keys(guessed).length > 0) {
      setSelections((prev) => ({ ...prev, ...guessed }));
    }
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const resolvedWfAccounts = [...wfAccounts];
      const newMappings: AccountMapping[] = [];

      for (const [sfId, selection] of Object.entries(selections)) {
        if (!selection || selection === SKIP_SENTINEL) continue;

        const sf = sfAccounts.find((a) => a.id === sfId)!;

        if (selection === CREATE_NEW_SENTINEL) {
          const form = newAccountForms[sfId];
          if (!form) continue;
          const newAccount = await ctx.api.accounts.create({
            name: form.name,
            accountType: form.accountType,
            trackingMode: "TRANSACTIONS",
            currency: form.currency,
            isDefault: false,
            isActive: true,
          });
          resolvedWfAccounts.push(newAccount);
          newMappings.push({
            simpleFinAccountId: sf.id,
            simpleFinAccountName: sf.name,
            simpleFinCurrency: sf.currency,
            wealthfolioAccountId: newAccount.id,
            wealthfolioAccountName: newAccount.name,
            wealthfolioCurrency: newAccount.currency,
          });
        } else {
          const wf = resolvedWfAccounts.find((a) => a.id === selection)!;
          newMappings.push({
            simpleFinAccountId: sf.id,
            simpleFinAccountName: sf.name,
            simpleFinCurrency: sf.currency,
            wealthfolioAccountId: wf.id,
            wealthfolioAccountName: wf.name,
            wealthfolioCurrency: wf.currency,
          });
        }
      }

      await saveConfig(ctx.api.secrets, {
        ...(config ?? DEFAULT_CONFIG),
        mappings: newMappings,
      });
      refresh(true);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save mappings."));
    } finally {
      setIsSaving(false);
    }
  }

  const hasMappings = Object.entries(selections).some(
    ([, v]) => v && v !== SKIP_SENTINEL,
  );

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <PageHeader
        icon={<Icons.ArrowLeftRight className="h-5 w-5 text-primary" />}
        title="Map Accounts"
        onBack={reconfiguring ? () => setReconfiguring(false) : undefined}
        actions={
          wfAccounts.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleGuess}>
              <Icons.Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Guess
            </Button>
          )
        }
      />
      <p className="text-sm text-muted-foreground mb-6 -mt-4">
        Connect each SimpleFin account to a Wealthfolio account, or create a new one.
      </p>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
          <Icons.Spinner className="h-4 w-4 animate-spin" />
          <span>Loading accounts...</span>
        </div>
      )}

      {!isLoading && <SfErrorsAlert errors={sfErrors} />}

      {!isLoading && error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>
            <p className="font-medium">Error</p>
            <p className="text-sm mt-1">{error}</p>
            {error.includes("402") && (
              <p className="text-sm mt-2 opacity-80">
                A 402 usually means no bank accounts are connected to your SimpleFin Bridge yet. Log
                in at bridge.simplefin.org to link your accounts, then come back.
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && <div className="space-y-3 mb-6">
        {sfAccounts.map((sf) => {
          const selection = selections[sf.id] ?? "";
          const form = newAccountForms[sf.id];
          const isCreating = selection === CREATE_NEW_SENTINEL;
          const mismatch =
            selection && selection !== SKIP_SENTINEL && selection !== CREATE_NEW_SENTINEL
              ? currencyMismatch(sf.id, selection)
              : false;
          const claimedByOthers = new Set(
            Object.entries(selections)
              .filter(([sfId, v]) => sfId !== sf.id && !!v && v !== SKIP_SENTINEL && v !== CREATE_NEW_SENTINEL)
              .map(([, wfId]) => wfId),
          );

          return (
            <Card key={sf.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">{sf.name}</CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      {sf.org?.name ?? "SimpleFin"} · {sf.currency}
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="font-mono text-xs">
                    <PrivacyAmount value={parseFloat(sf.balance) || 0} currency={sf.currency} />
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <Select
                  value={selection}
                  onValueChange={(val) => handleSelectChange(sf.id, val)}
                >
                  <SelectTrigger className="[&>span]:line-clamp-none [&>span]:flex-1 [&>span]:min-w-0">
                    <SelectValue placeholder="Select or skip..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SKIP_SENTINEL}>
                      <span className="flex items-center gap-1.5">
                        <Icons.XCircle className="h-3.5 w-3.5" />
                        Skip this account
                      </span>
                    </SelectItem>
                    <SelectItem value={CREATE_NEW_SENTINEL}>
                      <span className="flex items-center gap-1.5 text-primary">
                        <Icons.PlusCircle className="h-3.5 w-3.5" />
                        Create new account…
                      </span>
                    </SelectItem>
                    {wfAccounts.length > 0 && <SelectSeparator />}
                    {wfAccounts.map((wf) => (
                      <SelectItem key={wf.id} value={wf.id} disabled={claimedByOthers.has(wf.id)}>
                        <span className="flex items-center gap-3">
                          <span>{wf.name}</span>
                          {wfBalances.has(wf.id) && (
                            <span className="font-mono text-xs text-muted-foreground">
                              <PrivacyAmount value={wfBalances.get(wf.id)!} currency={wf.currency} />
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {isCreating && form && (
                  <div className="space-y-3 pt-3 border-t">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Account name</Label>
                      <Input
                        value={form.name}
                        onChange={(e) =>
                          setNewAccountForms((prev) => ({
                            ...prev,
                            [sf.id]: { ...form, name: e.target.value },
                          }))
                        }
                        placeholder="Account name"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Account type</Label>
                      <Select
                        value={form.accountType}
                        onValueChange={(val) =>
                          setNewAccountForms((prev) => ({
                            ...prev,
                            [sf.id]: { ...form, accountType: val as "CASH" | "SECURITIES" },
                          }))
                        }
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CASH">Spending account</SelectItem>
                          <SelectItem value="SECURITIES">Investment account</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Currency:</span>
                      <Badge variant="outline" className="font-mono">{sf.currency}</Badge>
                      <span>(inherited from SimpleFin)</span>
                    </div>
                  </div>
                )}

                {mismatch && (
                  <p className="text-xs text-yellow-600 dark:text-yellow-400">
                    Currency mismatch: SimpleFin reports {sf.currency} but this Wealthfolio account
                    uses {wfAccounts.find((a) => a.id === selection)?.currency}. Wealthfolio will
                    convert using its exchange rates.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>}

      {!isLoading && <Button onClick={handleSave} disabled={!hasMappings || isSaving} className="w-full">
        {isSaving ? "Saving..." : "Save"}
      </Button>}
    </div>
  );
}
