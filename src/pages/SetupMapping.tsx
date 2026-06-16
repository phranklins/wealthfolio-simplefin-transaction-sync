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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Icons,
} from "@wealthfolio/ui";
import type { Account } from "@wealthfolio/addon-sdk";
import {
  fetchAccounts,
  saveConfig,
  deleteCredentials,
  deleteConfig,
  clearResponseCache,
  getErrorMessage,
  CREATE_CASH_SENTINEL,
  CREATE_SECURITIES_SENTINEL,
} from "../lib";
import { useBankSyncAddon } from "../contexts/BankSyncAddonProvider";
import { SfErrorsAlert, PageHeader, PrivacyAmount } from "../components";
import type { SimpleFinAccount, AccountMapping } from "../types";
import { DEFAULT_CONFIG } from "../types";

export function SetupMapping() {
  const { ctx, accessUrl, config, refresh } = useBankSyncAddon();
  const [sfAccounts, setSfAccounts] = useState<SimpleFinAccount[]>([]);
  const [wfAccounts, setWfAccounts] = useState<Account[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState<Set<string>>(new Set());
  const [sfErrors, setSfErrors] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      try {
        const [sfResponse, wfAccs] = await Promise.all([
          fetchAccounts(accessUrl!),
          ctx.api.accounts.getAll(),
        ]);
        setSfAccounts(sfResponse.accounts);
        setWfAccounts(wfAccs.filter((a) => a.isActive));
        if (sfResponse.errlist?.length > 0) {
          setSfErrors(sfResponse.errlist.map((e) => e.message));
        }
        if (config?.mappings.length) {
          const existing: Record<string, string> = {};
          for (const m of config.mappings) {
            existing[m.simpleFinAccountId] = m.wealthfolioAccountId;
          }
          setMappings(existing);
        }
      } catch (err) {
        setError(getErrorMessage(err, "Failed to load accounts."));
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [accessUrl, ctx, config]);

  async function handleSelectChange(sfId: string, value: string) {
    if (value !== CREATE_CASH_SENTINEL && value !== CREATE_SECURITIES_SENTINEL) {
      setMappings((prev) => ({ ...prev, [sfId]: value }));
      return;
    }

    const isSecurities = value === CREATE_SECURITIES_SENTINEL;
    const sf = sfAccounts.find((a) => a.id === sfId)!;
    setCreating((prev) => new Set(prev).add(sfId));
    try {
      const newAccount = await ctx.api.accounts.create({
        name: sf.name,
        accountType: isSecurities ? "SECURITIES" : "CASH",
        trackingMode: "TRANSACTIONS",
        currency: sf.currency,
        isDefault: false,
        isActive: true,
      });
      setWfAccounts((prev) => [...prev, newAccount]);
      setMappings((prev) => ({ ...prev, [sfId]: newAccount.id }));
    } catch (err) {
      setError(getErrorMessage(err, "Failed to create account."));
    } finally {
      setCreating((prev) => {
        const next = new Set(prev);
        next.delete(sfId);
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

  async function handleSave() {
    setIsSaving(true);
    try {
      const newMappings: AccountMapping[] = Object.entries(mappings)
        .filter(([, wfId]) => wfId)
        .map(([sfId, wfId]) => {
          const sf = sfAccounts.find((a) => a.id === sfId)!;
          const wf = wfAccounts.find((a) => a.id === wfId)!;
          return {
            simpleFinAccountId: sf.id,
            simpleFinAccountName: sf.name,
            simpleFinCurrency: sf.currency,
            wealthfolioAccountId: wf.id,
            wealthfolioAccountName: wf.name,
            wealthfolioCurrency: wf.currency,
          };
        });

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

  if (isLoading) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <p className="text-muted-foreground">Loading accounts...</p>
      </div>
    );
  }

  const hasMappings = Object.values(mappings).some(Boolean);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <PageHeader
        icon={<Icons.ArrowLeftRight className="h-5 w-5 text-primary" />}
        title="Map Accounts"
        onBack={async () => {
          await deleteCredentials(ctx.api.secrets);
          await deleteConfig(ctx.api.secrets);
          clearResponseCache();
          refresh(true);
        }}
      />
      <p className="text-sm text-muted-foreground mb-6 -mt-4">
        Connect each SimpleFin account to a Wealthfolio account, or create a new one automatically.
      </p>

      <SfErrorsAlert errors={sfErrors} />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>
            <p className="font-medium">Could not load SimpleFin accounts</p>
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

      <div className="space-y-3 mb-6">
        {sfAccounts.map((sf) => {
          const selectedWfId = mappings[sf.id];
          const mismatch = selectedWfId ? currencyMismatch(sf.id, selectedWfId) : false;
          const isCreating = creating.has(sf.id);
          const claimedByOthers = new Set(
            Object.entries(mappings)
              .filter(([sfId, wfId]) => sfId !== sf.id && !!wfId)
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
                    <PrivacyAmount value={sf.balance} currency={sf.currency} />
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Wealthfolio Account</p>
                <Select
                  value={selectedWfId ?? ""}
                  onValueChange={(val) => handleSelectChange(sf.id, val)}
                  disabled={isCreating}
                >
                  <SelectTrigger>
                    {isCreating ? (
                      <span className="text-muted-foreground">Creating account...</span>
                    ) : (
                      <SelectValue placeholder="Skip this account" />
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    {wfAccounts.map((wf) => (
                      <SelectItem key={wf.id} value={wf.id} disabled={claimedByOthers.has(wf.id)}>
                        {wf.name} ({wf.currency})
                      </SelectItem>
                    ))}
                    <SelectItem value={CREATE_CASH_SENTINEL}>
                      <span className="flex items-center gap-1.5 text-primary">
                        <Icons.PlusCircle className="h-3.5 w-3.5" />
                        <span>
                          <span className="block">Create "{sf.name}" as Spending Account</span>
                          <span className="block text-xs text-muted-foreground font-normal">
                            Checking, savings, credit cards
                          </span>
                        </span>
                      </span>
                    </SelectItem>
                    <SelectItem value={CREATE_SECURITIES_SENTINEL}>
                      <span className="flex items-center gap-1.5 text-primary">
                        <Icons.PlusCircle className="h-3.5 w-3.5" />
                        <span>
                          <span className="block">Create "{sf.name}" as Investment Account</span>
                          <span className="block text-xs text-muted-foreground font-normal">
                            Brokerage, 401k, IRA
                          </span>
                        </span>
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>

                {mismatch && (
                  <p className="text-xs text-yellow-600 dark:text-yellow-400">
                    Currency mismatch: SimpleFin reports {sf.currency} but this Wealthfolio account
                    uses {wfAccounts.find((a) => a.id === selectedWfId)?.currency}. Wealthfolio will
                    convert using its exchange rates.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Button onClick={handleSave} disabled={!hasMappings || isSaving} className="w-full">
        {isSaving ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}
