// SPDX-License-Identifier: MIT
import { randomUUID, createHash } from "node:crypto";
import { generateUniqueAPIKey, hashAPIKey } from "@calcom/features/api-keys-legacy/api-keys/lib/apiKeys";
import { PermissionCheckService } from "@calcom/features/community-enterprise/authorization/PermissionCheckService";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { Prisma, PrismaClient } from "@calcom/prisma/client";
import { checkedApiKeyPrefix, normalizeApiKeyInput, rawApiKey, type ApiKeyInput } from "./ApiKeyInput";

const denied = () => new ErrorWithCode(ErrorCode.Forbidden, "API key operation is not permitted");
const keyFields = { id: true, userId: true, teamId: true, note: true, appId: true, expiresAt: true } as const;

async function atomic<T>(client: PrismaClient, action: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.$transaction(action, { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 });
    } catch (error) {
      if (attempt < 2 && typeof error === "object" && error !== null && "code" in error && error.code === "P2034") continue;
      throw error;
    }
  }
}

async function authority(tx: Prisma.TransactionClient, userId: number, teamId: number | null) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw denied();
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, locked: true } });
  if (!user || user.id !== userId || user.locked !== false) throw denied();
  if (teamId === null) return null;
  // A legacy key acts as its owner; do not turn a narrowly scoped custom role
  // into an unrestricted credential merely by allowing it to administer keys.
  const membership = await tx.membership.findFirst({
    where: { userId, teamId, accepted: true, customRoleId: null, role: { in: ["ADMIN", "OWNER"] } },
    select: { id: true },
  });
  if (!membership || !await new PermissionCheckService(tx).checkPermission({
    userId, teamId, permission: "apiKey.manage", fallbackRoles: ["ADMIN", "OWNER"],
  })) throw denied();
  const team = await tx.team.findUnique({ where: { id: teamId }, select: { id: true, parentId: true, isOrganization: true } });
  if (!team) throw denied();
  return team.isOrganization ? team.id : team.parentId;
}

function checkedInput(input: ApiKeyInput) {
  try { return normalizeApiKeyInput(input, Date.now()); }
  catch { throw new ErrorWithCode(ErrorCode.BadRequest, "Invalid API key metadata or expiration"); }
}

async function issue(
  tx: Prisma.TransactionClient, userId: number, input: ReturnType<typeof checkedInput>,
  organizationId: number | null, previousId: string | null
) {
  const [hashedKey, secret] = generateUniqueAPIKey();
  const id = randomUUID();
  await tx.apiKey.create({ data: { id, userId, ...input, hashedKey }, select: { id: true } });
  if (organizationId !== null) {
    const operationId = randomUUID();
    const details = { keyId: id, previousKeyId: previousId, teamId: input.teamId,
      expiresAt: input.expiresAt?.toISOString() ?? null };
    await tx.enterpriseAuditEvent.create({ data: {
      id: randomUUID(), operationId,
      operationHash: createHash("sha256").update(JSON.stringify({ userId, organizationId, details })).digest("hex"),
      actorUserId: userId, organizationId, entityId: null,
      action: previousId === null ? "api_key.created" : "api_key.rotated", details,
    }, select: { id: true } });
  }
  return secret;
}

export async function createApiKey(client: PrismaClient, userId: number, input: ApiKeyInput, prefix = "cal_") {
  const checkedPrefix = checkedApiKeyPrefix(prefix);
  const secret = await atomic(client, async (tx) => {
    const data = checkedInput(input);
    return issue(tx, userId, data, await authority(tx, userId, data.teamId), null);
  });
  return `${checkedPrefix}${secret}`;
}

export async function rotateApiKey(
  client: PrismaClient, userId: number, currentKey: string,
  lifetime: Pick<ApiKeyInput, "expiresAt" | "neverExpires">, prefix = "cal_"
) {
  let hashedKey: string;
  try { hashedKey = hashAPIKey(rawApiKey(currentKey, prefix)); }
  catch { throw denied(); }
  const secret = await atomic(client, async (tx) => {
    const existing = await tx.apiKey.findUnique({ where: { hashedKey }, select: keyFields });
    const now = Date.now();
    if (!existing || existing.userId !== userId ||
        (existing.expiresAt !== null && (!Number.isFinite(existing.expiresAt.getTime()) || existing.expiresAt.getTime() <= now))) throw denied();
    // Rotation preserves its principal and scope; input cannot replace owner,
    // team, application binding, note, ID, or persisted key material.
    const input = checkedInput({ expiresAt: lifetime?.expiresAt, neverExpires: lifetime?.neverExpires,
      note: existing.note, appId: existing.appId, teamId: existing.teamId ?? undefined });
    const organizationId = await authority(tx, userId, input.teamId);
    const consumed = await tx.apiKey.deleteMany({ where: { id: existing.id, userId, hashedKey } });
    if (consumed.count !== 1) throw denied();
    return issue(tx, userId, input, organizationId, existing.id);
  });
  return `${prefix}${secret}`;
}
