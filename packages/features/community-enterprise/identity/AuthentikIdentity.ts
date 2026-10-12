// SPDX-License-Identifier: MIT

import type { PrismaClient } from "@calcom/prisma";
import type { Account, Profile } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { type AuthentikConfig, authentikAccountId } from "./AuthentikConfig";

type Database = Pick<PrismaClient, "account" | "profile">;
interface Binding {
  version: 1;
  issuer: string;
  accountId: string;
  bindingId: string;
  userId: number;
}

function parseBinding(value: unknown): Binding {
  if (!value || typeof value !== "object") throw new Error("Invalid Authentik session binding");
  const binding = value as Partial<Binding>;
  if (
    binding.version !== 1 ||
    typeof binding.issuer !== "string" ||
    typeof binding.accountId !== "string" ||
    !/^[a-f0-9]{64}$/.test(binding.accountId) ||
    typeof binding.bindingId !== "string" ||
    binding.bindingId.length === 0 ||
    !Number.isSafeInteger(binding.userId) ||
    Number(binding.userId) <= 0
  ) {
    throw new Error("Invalid Authentik session binding");
  }
  return binding as Binding;
}

const userSelect = {
  id: true,
  uuid: true,
  locked: true,
  email: true,
  name: true,
  username: true,
  avatarUrl: true,
  role: true,
  locale: true,
  movedToProfileId: true,
  teams: {
    where: { accepted: true },
    select: {
      teamId: true,
      role: true,
      customRoleId: true,
      team: { select: { id: true, isOrganization: true, parentId: true } },
    },
  },
} as const;

export async function readAuthentikAccount(database: Database, accountId: string) {
  if (!/^[a-f0-9]{64}$/.test(accountId)) return null;
  const account = await database.account.findUnique({
    where: { provider_providerAccountId: { provider: "authentik", providerAccountId: accountId } },
    select: { id: true, userId: true, type: true, user: { select: userSelect } },
  });
  if (
    !account?.user ||
    account.type !== "oauth" ||
    account.user.locked !== false ||
    account.user.id !== account.userId
  )
    return null;
  return { ...account, user: account.user };
}

// Pre-linked accounts only. The first usable slice does not silently create,
// merge, promote or mutate users because an IdP happens to return their email.
export async function authorizeAuthentikSignIn(
  database: Database,
  config: AuthentikConfig | null,
  input: { account: Account | null; profile?: Profile; user: { id: number | string } }
): Promise<boolean> {
  if (!config || input.account?.provider !== "authentik" || input.account.type !== "oauth") return false;
  const subject = input.profile?.sub;
  const issuer = (input.profile as (Profile & { iss?: unknown }) | undefined)?.iss;
  if (typeof subject !== "string" || (issuer !== config.issuer && issuer !== `${config.issuer}/`))
    return false;
  const accountId = authentikAccountId(config.issuer, subject);
  if (input.account.providerAccountId !== accountId) return false;
  const stored = await readAuthentikAccount(database, accountId);
  return stored !== null && String(stored.userId) === String(input.user.id);
}

export async function refreshAuthentikToken(
  database: Database,
  config: Pick<AuthentikConfig, "issuer"> | null,
  input: { token: JWT; account?: Account | null; user?: { id: number | string }; requestedUpId?: unknown },
  webappUrl: string
): Promise<JWT> {
  if (!config) throw new Error("Authentik login is disabled");
  const { token, account } = input;
  let binding: Binding;
  if (account?.provider === "authentik") {
    if (account.type !== "oauth" || !input.user) throw new Error("Invalid Authentik login");
    const stored = await readAuthentikAccount(database, account.providerAccountId);
    if (!stored || String(stored.userId) !== String(input.user.id))
      throw new Error("Authentik account is not linked");
    binding = {
      version: 1,
      issuer: config.issuer,
      accountId: account.providerAccountId,
      bindingId: stored.id,
      userId: stored.userId,
    };
  } else {
    binding = parseBinding(token.authentik);
    if (binding.issuer !== config.issuer || token.sub !== String(binding.userId)) {
      throw new Error("Authentik session identity mismatch");
    }
  }
  const stored = await readAuthentikAccount(database, binding.accountId);
  if (!stored || stored.id !== binding.bindingId || stored.userId !== binding.userId) {
    throw new Error("Authentik session is no longer authorized");
  }
  const user = stored.user;
  const requested = input.requestedUpId ?? token.upId;
  if (requested !== undefined && typeof requested !== "string") throw new Error("Invalid profile selection");
  let profileId: number | null = null;
  let upId = `usr-${user.id}`;
  let org: JWT["org"];
  let orgAwareUsername = user.username;
  const needsOrganizationProfile = requested ? requested !== upId : user.movedToProfileId !== null;
  if (needsOrganizationProfile) {
    let selector: { id: number } | { uid: string };
    if (!requested && user.movedToProfileId) selector = { id: user.movedToProfileId };
    else if (typeof requested === "string" && requested.startsWith("prof-") && requested.length > 5)
      selector = { uid: requested.slice(5) };
    else if (
      typeof requested === "string" &&
      /^[1-9][0-9]*$/.test(requested) &&
      Number.isSafeInteger(Number(requested))
    )
      selector = { id: Number(requested) };
    else throw new Error("Invalid profile selection");
    const profile = await database.profile.findFirst({
      where: { ...selector, userId: user.id },
      select: {
        id: true,
        uid: true,
        username: true,
        organizationId: true,
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
            isOrganization: true,
            parentId: true,
            isPlatform: true,
          },
        },
      },
    });
    const membership = user.teams.find((member) => member.teamId === profile?.organizationId);
    if (
      !profile ||
      !membership ||
      !profile.organization.isOrganization ||
      profile.organization.parentId !== null
    ) {
      throw new Error("Profile is not an active membership of this user");
    }
    profileId = profile.id;
    upId = `prof-${profile.uid}`;
    orgAwareUsername = profile.username;
    org = {
      id: profile.organization.id,
      name: profile.organization.name,
      slug: profile.organization.slug ?? "",
      logoUrl: profile.organization.logoUrl,
      fullDomain: webappUrl,
      domainSuffix: "",
      role: membership.customRoleId === null ? membership.role : "MEMBER",
    };
  }
  // Construct authoritative fields last; never persist caller-supplied role,
  // identity, email or an old impersonation claim from a session update.
  const result: JWT = {
    sub: String(user.id),
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    avatarUrl: user.avatarUrl,
    role: user.role,
    locale: user.locale ?? undefined,
    upId,
    profileId,
    org,
    orgAwareUsername,
    belongsToActiveTeam: user.teams.some(
      (member) =>
        member.team.parentId === null ||
        user.teams.some((parent) => parent.teamId === member.team.parentId && parent.team.isOrganization)
    ),
    authentik: binding,
  };
  // Preserve only native token timing fields, not other provider or user data.
  for (const key of ["iat", "exp", "jti"] as const) {
    if (token[key] !== undefined) Object.assign(result, { [key]: token[key] });
  }
  return result;
}
