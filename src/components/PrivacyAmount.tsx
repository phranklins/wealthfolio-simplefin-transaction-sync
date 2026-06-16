import { useBankSyncAddon } from "../contexts/BankSyncAddonProvider";

interface PrivacyAmountProps {
  value: number | string;
  currency: string;
  abs?: boolean;
  className?: string;
}

export function PrivacyAmount({ value, currency, abs = false, className }: PrivacyAmountProps) {
  const { privacyMode } = useBankSyncAddon();
  if (privacyMode) return <span className={className}>••••••</span>;
  const num = typeof value === "string" ? parseFloat(value) : value;
  const display = (abs ? Math.abs(num) : num).toLocaleString("en-US", {
    style: "currency",
    currency,
  });
  return <span className={className}>{display}</span>;
}
