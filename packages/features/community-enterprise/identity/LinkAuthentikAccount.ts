// SPDX-License-Identifier: MIT
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@calcom/prisma";
import { type AuthentikConfig, authentikAccountId } from "./AuthentikConfig";

type LinkDatabase = Pick<PrismaClient, "account" | "user">;
export interface LinkAuthentikInput {
  userId: number;
  expectedUserUuid: string;
  subject: string;
}

// Invoke inside an operator-controlled transaction. This is not a public signup
// endpoint. The UUID prevents an accidentally reused numeric ID from being linked.
export async function linkAuthentikAccount(
  database: LinkDatabase,
  config: Pick<AuthentikConfig, "issuer">,
  input: LinkAuthentikInput,
  apply = false
) {
  if (!Number.isSafeInteger(input.userId) || input.userId <= 0 || !input.expectedUserUuid) {
    throw new Error("An explicit user ID and expected UUID are required");
  }
  const accountId = authentikAccountId(config.issuer, input.subject);
  const user = await database.user.findUnique({
    where: { id: input.userId },
    select: { id: true, uuid: true, locked: true },
  });
  if (!user || user.uuid !== input.expectedUserUuid || user.locked !== false) {
    throw new Error("The reviewed target user does not match an active account");
  }
  const where = { provider_providerAccountId: { provider: "authentik", providerAccountId: accountId } };
  const existing = await database.account.findUnique({
    where,
    select: { id: true, userId: true, type: true },
  });
  if (existing && (existing.userId !== user.id || existing.type !== "oauth")) {
    throw new Error("This Authentik identity is already bound to another account");
  }
  if (existing)
    return { status: "already_linked" as const, accountId, bindingId: existing.id, userId: user.id };
  if (!apply) return { status: "would_link" as const, accountId, userId: user.id };
  const linked = await database.account.create({
    data: {
      id: randomUUID(),
      type: "oauth",
      provider: "authentik",
      providerAccountId: accountId,
      userId: user.id,
    },
    select: { id: true },
  });
  return { status: "linked" as const, accountId, bindingId: linked.id, userId: user.id };
}
