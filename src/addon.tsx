import React from "react";
import type { AddonContext } from "@wealthfolio/addon-sdk";
import { Icons } from "@wealthfolio/ui";
import { BankSyncAddonProvider, useBankSyncAddon } from "./contexts/BankSyncAddonProvider";
import { SetupAuth, SetupMapping, SyncPage } from "./pages";

function AddonRoot({ ctx }: { ctx: AddonContext }) {
  return (
    <BankSyncAddonProvider ctx={ctx}>
      <AddonRouter />
    </BankSyncAddonProvider>
  );
}

function AddonRouter() {
  const { accessUrl, config, isLoading, reconfiguring } = useBankSyncAddon();

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!accessUrl) return <SetupAuth />;
  if (!config?.mappings.length || reconfiguring) return <SetupMapping />;
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

  const Wrapper = () => <AddonRoot ctx={ctx} />;
  ctx.router.add({
    path: "/addon/bank-sync",
    component: React.lazy(() => Promise.resolve({ default: Wrapper })),
  });

  ctx.onDisable(() => {
    try {
      sidebarItem.remove();
    } catch (err) {
      ctx.api.logger.error(`Failed to remove sidebar item: ${err}`);
    }
  });
}
