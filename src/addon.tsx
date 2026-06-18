import React from "react";
import type { AddonContext } from "@wealthfolio/addon-sdk";
import { Icons } from "@wealthfolio/ui";
import { BankSyncAddonProvider, useBankSyncAddon } from "./contexts/BankSyncAddonProvider";
import { SetupAuth, SetupMapping, SyncPage } from "./pages";

function AddonRouter() {
  const { accessUrl, config, isLoading } = useBankSyncAddon();

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!accessUrl) return <SetupAuth />;
  if (!config?.mappings.length || config?.isReconfiguring) return <SetupMapping />;
  return <SyncPage />;
}

export default function enable(ctx: AddonContext) {
  const sidebarItem = ctx.sidebar.addItem({
    id: "bank-sync",
    label: "Bank Sync",
    icon: <Icons.Refresh className="h-5 w-5" />,
    route: "/addon/bank-sync",
    order: 100,
  });

  const Wrapper = () => (
    <BankSyncAddonProvider ctx={ctx}>
      <AddonRouter />
    </BankSyncAddonProvider>
  );

  ctx.router.add({
    path: "/addon/bank-sync",
    component: React.lazy(() => Promise.resolve({ default: Wrapper })),
  });

  return {
    disable() {
      sidebarItem.remove();
    },
  };
}
