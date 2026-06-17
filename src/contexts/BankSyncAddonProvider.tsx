import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import type { AddonContext } from "@wealthfolio/addon-sdk";
import { loadCredentials, loadConfig } from "../lib";
import type { AddonConfig } from "../types";

interface AddonState {
  ctx: AddonContext;
  accessUrl: string | null;
  config: AddonConfig | null;
  isLoading: boolean;
  reconfiguring: boolean;
  setReconfiguring: (v: boolean) => void;
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
  const [reconfiguring, setReconfiguring] = useState(false);

  const refresh = useCallback(
    async (showLoading = false) => {
      if (showLoading) setIsLoading(true);
      setReconfiguring(false);
      try {
        const [url, cfg] = await Promise.all([
          loadCredentials(ctx.api.secrets),
          loadConfig(ctx.api.secrets),
        ]);
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
    <Ctx.Provider
      value={{
        ctx,
        accessUrl,
        config,
        isLoading,
        reconfiguring,
        setReconfiguring,
        refresh,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useBankSyncAddon(): AddonState {
  const value = useContext(Ctx);
  if (!value) throw new Error("useBankSyncAddon must be used inside BankSyncAddonProvider");
  return value;
}
