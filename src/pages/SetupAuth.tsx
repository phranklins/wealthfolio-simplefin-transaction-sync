import { useState, type FormEvent } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Textarea,
  Alert,
  AlertDescription,
  Icons,
} from "@wealthfolio/ui";
import {
  claimAccessUrl,
  saveCredentials,
  deleteConfig,
  clearResponseCache,
  getErrorMessage,
  SIMPLEFIN_CREATE_URL,
} from "../lib";
import { useBankSyncAddon } from "../contexts/BankSyncAddonProvider";
import { PageHeader } from "../components";

async function openExternal(url: string): Promise<void> {
  // Tauri v2 opener plugin — available in Wealthfolio's webview
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tauri = (window as any).__TAURI_INTERNALS__;
    if (tauri?.invoke) {
      await tauri.invoke("plugin:opener|open_url", { url });
      return;
    }
  } catch {
    // fall through to clipboard
  }
  await navigator.clipboard.writeText(url);
}

export function SetupAuth() {
  const { ctx, refresh } = useBankSyncAddon();
  const [token, setToken] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const accessUrl = await claimAccessUrl(token);
      await saveCredentials(ctx.api.secrets, accessUrl);
      await deleteConfig(ctx.api.secrets);
      clearResponseCache();
      refresh(true);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to connect. Check your token and try again."));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleOpenUrl() {
    try {
      await openExternal(SIMPLEFIN_CREATE_URL);
      // If invoke fails silently and falls to clipboard, show "copied"
    } catch {
      await navigator.clipboard.writeText(SIMPLEFIN_CREATE_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="p-6 max-w-lg mx-auto">
      <PageHeader
        icon={<Icons.Link className="h-5 w-5 text-primary" />}
        title="Connect SimpleFin Bridge"
      />

      <Card>
        <CardHeader>
          <CardTitle>Setup Token</CardTitle>
          <CardDescription className="space-y-2 pt-1">
            <span className="block">
              Visit{" "}
              <button
                type="button"
                onClick={handleOpenUrl}
                className="font-medium text-foreground underline underline-offset-2 hover:text-primary inline-flex items-center gap-0.5"
              >
                bridge.simplefin.org
                <Icons.ExternalLink className="h-3 w-3 ml-0.5" />
              </button>
              {copied && <span className="ml-2 text-xs text-muted-foreground">(URL copied!)</span>}{" "}
              to get a setup token, then paste it below.
            </span>
            <span className="block">
              The token is single-use. Once exchanged, your access credential is stored securely in
              Wealthfolio's encrypted system keyring — never in plain text.
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Textarea
              placeholder="Paste your SimpleFin setup token here..."
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                if (error) setError(null);
              }}
              rows={4}
              className="font-mono text-sm"
              disabled={isLoading}
            />
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={!token.trim() || isLoading} className="w-full">
              {isLoading ? "Connecting..." : "Connect SimpleFin"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
