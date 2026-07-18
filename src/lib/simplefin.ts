import type { SimpleFinResponse } from "../types";

function parseAccessUrl(accessUrl: string): { baseUrl: string; authHeader: string } {
  const url = new URL(accessUrl);
  if (url.protocol !== "https:") {
    throw new Error("Refusing to use a non-HTTPS SimpleFin access URL.");
  }
  const username = url.username;
  const password = url.password;
  url.username = "";
  url.password = "";
  const baseUrl = url.toString().replace(/\/$/, "");
  const authHeader = "Basic " + btoa(`${username}:${password}`);
  return { baseUrl, authHeader };
}

export async function claimAccessUrl(setupToken: string): Promise<string> {
  let claimUrl: string;
  try {
    claimUrl = atob(setupToken.trim());
  } catch {
    throw new Error("Invalid setup token — could not decode.");
  }
  let parsedClaim: URL;
  try {
    parsedClaim = new URL(claimUrl);
  } catch {
    throw new Error("Setup token did not decode to a valid URL.");
  }
  // The claim URL comes from user-pasted (base64) input; only POST credentials over HTTPS.
  if (parsedClaim.protocol !== "https:") {
    throw new Error("Refusing to claim over a non-HTTPS URL.");
  }

  const response = await fetch(claimUrl, {
    method: "POST",
    headers: { "Content-Length": "0" },
  });
  if (!response.ok) {
    throw new Error(`Failed to claim access URL: ${response.status} ${response.statusText}`);
  }
  const accessUrl = (await response.text()).trim();

  // The returned access URL is stored and reused with Basic auth on every sync — reject
  // anything that isn't HTTPS so credentials can never be sent in the clear.
  let parsedAccess: URL;
  try {
    parsedAccess = new URL(accessUrl);
  } catch {
    throw new Error("SimpleFin returned an invalid access URL.");
  }
  if (parsedAccess.protocol !== "https:") {
    throw new Error("SimpleFin returned a non-HTTPS access URL.");
  }
  return accessUrl;
}

export async function fetchAccounts(
  accessUrl: string,
  startDate?: Date,
  endDate?: Date,
): Promise<SimpleFinResponse> {
  const { baseUrl, authHeader } = parseAccessUrl(accessUrl);

  const params = new URLSearchParams({ version: "2" });
  if (startDate) params.set("start-date", String(Math.floor(startDate.getTime() / 1000)));
  if (endDate) params.set("end-date", String(Math.floor(endDate.getTime() / 1000)));

  const url = `${baseUrl}/accounts?${params.toString()}`;

  const response = await fetch(url, {
    headers: { Authorization: authHeader },
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      /* ignore */
    }
    throw new Error(`SimpleFin returned ${response.status}${detail ? `: ${detail.trim()}` : ""}`);
  }

  const data = (await response.json()) as SimpleFinResponse;
  // Normalize: errlist is optional in some SimpleFin environments (e.g. dev sandbox)
  data.errlist = data.errlist ?? [];
  return data;
}
