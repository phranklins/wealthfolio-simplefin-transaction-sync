import type { ReactNode } from "react";
import { Icons } from "@wealthfolio/ui";
import { useBankSyncAddon } from "../contexts/BankSyncAddonProvider";

/**
 * PageHeader component renders a header section for a page, including a title, optional icon, subtitle, back button, and action buttons.
 * It also includes a privacy toggle button to show or hide sensitive information in the addon.
 */

interface PageHeaderProps {
  title: string;
  icon?: ReactNode;
  subtitle?: string;
  onBack?: () => void;
  actions?: ReactNode;
}

export function PageHeader({ title, icon, subtitle, onBack, actions }: PageHeaderProps) {
  const { privacyMode, togglePrivacy } = useBankSyncAddon();

  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Go back"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0 -ml-1"
          >
            <Icons.ChevronLeft className="h-5 w-5" />
          </button>
        )}
        {icon && (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0">
            {icon}
          </div>
        )}
        <div>
          {subtitle && (
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              {subtitle}
            </p>
          )}
          <h1 className="text-xl font-semibold leading-tight">{title}</h1>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <button
          type="button"
          onClick={togglePrivacy}
          aria-label={privacyMode ? "Show amounts" : "Hide amounts"}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          {privacyMode ? <Icons.EyeOff className="h-4 w-4" /> : <Icons.Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
