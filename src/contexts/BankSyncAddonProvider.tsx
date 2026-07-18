import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import type { AddonContext } from "@wealthfolio/addon-sdk";
import { loadCredentials, loadConfig, ensureBasicAuth } from "../lib";
import type { AddonConfig } from "../types";

interface AddonState {
  ctx: AddonContext;
  accessUrl: string | null;
  config: AddonConfig | null;
  isLoading: boolean;
  refresh: (showLoading?: boolean) => Promise<void>;
}

const Ctx = createContext<AddonState | null>(null);

export function BankSyncAddonProvider({
  ctx,
  children,
}: {
  ctx: AddonContext;
  children: ReactNode;
}) {
  const [accessUrl, setAccessUrl] = useState<string | null>(null);
  const [config, setConfig] = useState<AddonConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(
    async (showLoading = false) => {
      if (showLoading) setIsLoading(true);
      try {
        const [url, cfg] = await Promise.all([
          loadCredentials(ctx.api.secrets),
          loadConfig(ctx.api.secrets),
        ]);
        // Backfill the broker's Basic-auth secret for installs that connected
        // before it existed (best-effort; never block loading on it).
        if (url) {
          try {
            await ensureBasicAuth(ctx.api.secrets, url);
          } catch {
            /* ignore */
          }
        }
        setAccessUrl(url);
        setConfig(cfg);
      } finally {
        if (showLoading) setIsLoading(false);
      }
    },
    [ctx],
  );

  useEffect(() => {
    refresh(true);
  }, [refresh]);

  return (
    <Ctx.Provider value={{ ctx, accessUrl, config, isLoading, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useBankSyncAddon(): AddonState {
  const value = useContext(Ctx);
  if (!value) throw new Error("useBankSyncAddon must be used inside BankSyncAddonProvider");
  return value;
}
