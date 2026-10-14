import type { Request } from 'express';
import { execFileSync } from 'node:child_process';
import { config } from './config';

let cached: { token: string; exp: number } | null = null;

/** OAuth M2M token for the app's service principal (cached until shortly before expiry). */
async function servicePrincipalToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const res = await fetch(`https://${config.host}/oidc/v1/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials&scope=all-apis',
  });
  if (!res.ok) throw new Error(`OAuth token request failed (${res.status})`);
  const j: any = await res.json();
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cached.token;
}

let cliCached: { token: string; exp: number } | null = null;
/** Local-dev only: OAuth token from the Databricks CLI profile (never persisted by this app). */
export function cliProfileToken(): string | undefined {
  if (!config.profile || config.clientId) return undefined;
  if (cliCached && cliCached.exp > Date.now()) return cliCached.token;
  const out = execFileSync('databricks', ['auth', 'token', '--profile', config.profile, '-o', 'json'], { encoding: 'utf8' });
  const j = JSON.parse(out);
  cliCached = { token: j.access_token, exp: Date.now() + 10 * 60_000 };
  return cliCached.token;
}

/** Token forwarded by Databricks Apps when the user is signed in (on-behalf-of-user). */
export const userToken = (req?: Request): string | undefined =>
  config.useObo ? (req?.headers['x-forwarded-access-token'] as string | undefined) : undefined;

/** Bearer token for REST calls (Genie): OBO user token → SP OAuth → PAT. */
export async function bearerToken(req?: Request): Promise<string> {
  const u = userToken(req);
  if (u) return u;
  if (config.clientId && config.clientSecret) return servicePrincipalToken();
  if (config.token) return config.token;
  const cli = cliProfileToken();
  if (cli) return cli;
  throw new Error('No Databricks credentials configured (set DATABRICKS_CLIENT_ID/SECRET or DATABRICKS_TOKEN)');
}
