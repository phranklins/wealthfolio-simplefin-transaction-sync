import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@wealthfolio/ui";
import type { ApiLogEntry } from "../lib";

export function PopoverApiLog({ log, total }: { log: ApiLogEntry[]; total: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="underline decoration-dotted hover:text-foreground transition-colors">
          {total} total calls logged
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <div className="p-3 border-b">
          <p className="text-sm font-medium">API Call History</p>
          <p className="text-xs text-muted-foreground mt-0.5">Last 365 days · newest first</p>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {open &&
            [...log].reverse().map((entry, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-3 py-2 border-b last:border-0 text-xs"
              >
                <span className="text-muted-foreground font-mono">
                  {new Date(entry.timestamp).toLocaleString()}
                </span>
                <span className="text-muted-foreground shrink-0 ml-2">
                  {entry.syncDays}d window
                </span>
              </div>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
