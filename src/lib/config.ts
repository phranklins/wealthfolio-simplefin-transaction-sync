import type { HostAPI } from "@wealthfolio/addon-sdk";

type SecretsAPI = HostAPI["secrets"];
import {
  SECRETS_KEY_CREDENTIALS,
  SECRETS_KEY_BASIC_AUTH,
  SECRETS_KEY_CONFIG,
  DEFAULT_CONFIG,
} from "../types";
import type { AddonConfig } from "../types";

// The network broker injects Basic auth from a stored secret (base64 "user:pass").
function deriveBasicAuth(accessUrl: string): string {
  const u = new URL(accessUrl);
  return btoa(`${u.username}:${u.password}`);
}

export async function loadCredentials(secrets: SecretsAPI): Promise<string | null> {
  return secrets.get(SECRETS_KEY_CREDENTIALS);
}

export async function saveCredentials(secrets: SecretsAPI, accessUrl: string): Promise<void> {
  await secrets.set(SECRETS_KEY_CREDENTIALS, accessUrl);
  await secrets.set(SECRETS_KEY_BASIC_AUTH, deriveBasicAuth(accessUrl));
}

// Idempotently (re)derive the broker's Basic-auth secret from a stored access URL.
// Covers installs that connected before the basic-auth secret existed.
export async function ensureBasicAuth(secrets: SecretsAPI, accessUrl: string): Promise<void> {
  await secrets.set(SECRETS_KEY_BASIC_AUTH, deriveBasicAuth(accessUrl));
}

export async function deleteCredentials(secrets: SecretsAPI): Promise<void> {
  await secrets.delete(SECRETS_KEY_CREDENTIALS);
  await secrets.delete(SECRETS_KEY_BASIC_AUTH);
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
