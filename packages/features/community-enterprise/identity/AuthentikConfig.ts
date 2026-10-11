// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import AuthentikProvider, { type AuthentikProfile } from "next-auth/providers/authentik";
import type { OAuthConfig } from "next-auth/providers/oauth";

export interface AuthentikConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
}

export function readAuthentikConfig(env: Record<string, string | undefined>): AuthentikConfig | null {
  const enabled = env.CAL_AUTHENTIK_ENABLED;
  if (enabled === undefined || enabled === "false") return null;
  if (enabled !== "true") throw new Error("CAL_AUTHENTIK_ENABLED must be true or false");
  const issuer = env.CAL_AUTHENTIK_ISSUER?.replace(/\/$/, "");
  const clientId = env.CAL_AUTHENTIK_CLIENT_ID;
  const clientSecret = env.CAL_AUTHENTIK_CLIENT_SECRET;
  if (!issuer || !clientId || !clientSecret) throw new Error("Incomplete Authentik configuration");
  const url = new URL(issuer);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && local && env.NODE_ENV !== "production"))
  ) {
    throw new Error("Invalid Authentik issuer URL");
  }
  return { issuer, clientId, clientSecret };
}

export function authentikAccountId(issuer: string, subject: string): string {
  if (typeof subject !== "string" || subject.length === 0 || subject.length > 1024) {
    throw new Error("Invalid Authentik subject");
  }
  // Provider IDs alone are not unique across issuers. This value contains neither
  // a mutable email nor an access token and fits the existing Account key.
  return createHash("sha256")
    .update(JSON.stringify([issuer, subject]))
    .digest("hex");
}

export type AuthentikClaims = AuthentikProfile;

export function createAuthentikProvider(config: AuthentikConfig): OAuthConfig<AuthentikClaims> {
  const mapProfile = (claims: AuthentikClaims) => {
    // NextAuth/openid-client verifies signature, audience and exact discovery
    // issuer first. Authentik deployments publish either trailing-slash form.
    if (claims.iss !== config.issuer && claims.iss !== `${config.issuer}/`) {
      throw new Error("Unexpected Authentik issuer");
    }
    return {
      id: authentikAccountId(config.issuer, claims.sub),
      name: typeof claims.name === "string" ? claims.name : null,
      email: typeof claims.email === "string" ? claims.email : null,
      image: null,
    };
  };
  return AuthentikProvider<AuthentikClaims>({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    issuer: config.issuer,
    idToken: true,
    checks: ["pkce", "state", "nonce"],
    allowDangerousEmailAccountLinking: false,
    // Cal's ambient User type uses a numeric database ID. OAuth profile IDs
    // are necessarily opaque strings until the adapter hydrates that user.
    profile: mapProfile as unknown as OAuthConfig<AuthentikClaims>["profile"],
  });
}
