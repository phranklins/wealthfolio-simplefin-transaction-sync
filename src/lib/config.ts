import type { HostAPI } from "@wealthfolio/addon-sdk";

type SecretsAPI = HostAPI["secrets"];
import { SECRETS_KEY_CREDENTIALS, SECRETS_KEY_CONFIG, DEFAULT_CONFIG } from "../types";
import type { AddonConfig } from "../types";

export async function loadCredentials(secrets: SecretsAPI): Promise<string | null> {
  return secrets.get(SECRETS_KEY_CREDENTIALS);
}

export async function saveCredentials(secrets: SecretsAPI, accessUrl: string): Promise<void> {
  await secrets.set(SECRETS_KEY_CREDENTIALS, accessUrl);
}

export async function deleteCredentials(secrets: SecretsAPI): Promise<void> {
  await secrets.delete(SECRETS_KEY_CREDENTIALS);
}

export async function deleteConfig(secrets: SecretsAPI): Promise<void> {
  await secrets.delete(SECRETS_KEY_CONFIG);
}

export async function loadConfig(secrets: SecretsAPI): Promise<AddonConfig> {
  const raw = await secrets.get(SECRETS_KEY_CONFIG);
  if (!raw) return { ...DEFAULT_CONFIG };
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) } as AddonConfig;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(secrets: SecretsAPI, config: AddonConfig): Promise<void> {
  await secrets.set(SECRETS_KEY_CONFIG, JSON.stringify(config));
}
