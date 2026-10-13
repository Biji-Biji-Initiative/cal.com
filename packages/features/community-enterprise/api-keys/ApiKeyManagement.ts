// SPDX-License-Identifier: MIT
import { createHash, randomUUID } from "node:crypto";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { Prisma, PrismaClient } from "@calcom/prisma/client";
import { atomicApiKeyOperation, requireApiKeyAuthority } from "./ApiKeyLifecycle";

// Metadata responses never carry credential hashes or relation payloads.
const metadata = {
  id: true,
  userId: true,
  teamId: true,
  appId: true,
  note: true,
  createdAt: true,
  expiresAt: true,
  lastUsedAt: true,
} as const;
const denied = () => new ErrorWithCode(ErrorCode.Forbidden, "API key operation is not permitted");
const invalid = () => new ErrorWithCode(ErrorCode.BadRequest, "Invalid API key metadata or expiration");

export interface EditApiKeyInput {
  id: string;
  note?: string | null;
  expiresAt?: Date;
}
export interface FindApiKeyInput {
  teamId?: number;
  appId?: string;
}

function checkedId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0 || id.length > 128) throw invalid();
}

function checkedEdit(input: EditApiKeyInput) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !["id", "note", "expiresAt"].includes(key))
  )
    throw invalid();
  checkedId(input.id);
  if (
    input.note !== undefined &&
    input.note !== null &&
    (typeof input.note !== "string" || input.note.length > 10000)
  )
    throw invalid();
  const data: { note?: string | null; expiresAt?: Date } = {};
  if (input.note !== undefined) data.note = input.note;
  if (input.expiresAt !== undefined) {
    if (!(input.expiresAt instanceof Date) || !Number.isFinite(input.expiresAt.getTime())) throw invalid();
    data.expiresAt = new Date(input.expiresAt.getTime());
  }
  return { id: input.id, data };
}

async function ownedKey(tx: Prisma.TransactionClient, userId: number, id: string) {
  await requireApiKeyAuthority(tx, userId, null);
  const key = await tx.apiKey.findUnique({ where: { id }, select: metadata });
  if (!key || key.userId !== userId) throw denied();
  return key;
}

async function organizationScope(tx: Prisma.TransactionClient, teamId: number | null) {
  if (teamId === null) return null;
  const scope = await tx.team.findUnique({
    where: { id: teamId },
    select: { id: true, isOrganization: true, parentId: true },
  });
  if (!scope) throw denied();
  if (scope.isOrganization) {
    if (scope.parentId !== null) throw denied();
    return scope.id;
  }
  if (scope.parentId === null) return null;
  const parent = await tx.team.findUnique({
    where: { id: scope.parentId },
    select: { id: true, isOrganization: true, parentId: true },
  });
  if (!parent?.isOrganization || parent.parentId !== null) throw denied();
  return parent.id;
}

async function audit(
  tx: Prisma.TransactionClient,
  userId: number,
  organizationId: number | null,
  action: string,
  details: Prisma.InputJsonObject
) {
  if (organizationId === null) return;
  await tx.enterpriseAuditEvent.create({
    data: {
      id: randomUUID(),
      operationId: randomUUID(),
      actorUserId: userId,
      organizationId,
      entityId: null,
      action,
      details,
      operationHash: createHash("sha256")
        .update(JSON.stringify({ userId, organizationId, action, details }))
        .digest("hex"),
    },
    select: { id: true },
  });
}

export async function editApiKey(client: PrismaClient, userId: number, input: EditApiKeyInput) {
  const { id, data } = checkedEdit(input);
  return atomicApiKeyOperation(client, async (tx) => {
    const key = await ownedKey(tx, userId, id);
    if (data.expiresAt !== undefined) {
      const now = Date.now();
      // Metadata editing cannot resurrect expired credentials or bypass issuance
      // authority. An owner can always revoke their own key after demotion.
      if (data.expiresAt.getTime() <= now || (key.expiresAt !== null && key.expiresAt.getTime() <= now))
        throw invalid();
      await requireApiKeyAuthority(tx, userId, key.teamId);
    }
    const noteChanged = data.note !== undefined && data.note !== key.note;
    const expiryChanged =
      data.expiresAt !== undefined && data.expiresAt.getTime() !== key.expiresAt?.getTime();
    if (!noteChanged && !expiryChanged) return key;
    const organizationId = await organizationScope(tx, key.teamId);
    const updated = await tx.apiKey.updateMany({ where: { id, userId }, data });
    if (updated.count !== 1) throw denied();
    await audit(tx, userId, organizationId, "api_key.updated", {
      keyId: id,
      teamId: key.teamId,
      noteChanged,
      expiryChanged,
      previousExpiresAt: key.expiresAt?.toISOString() ?? null,
      expiresAt: (data.expiresAt ?? key.expiresAt)?.toISOString() ?? null,
    });
    const result = await tx.apiKey.findUnique({ where: { id }, select: metadata });
    if (!result || result.userId !== userId) throw denied();
    return result;
  });
}

export async function revokeApiKey(client: PrismaClient, userId: number, id: string) {
  checkedId(id);
  return atomicApiKeyOperation(client, async (tx) => {
    const key = await ownedKey(tx, userId, id);
    const organizationId = await organizationScope(tx, key.teamId);
    const deleted = await tx.apiKey.deleteMany({ where: { id, userId } });
    if (deleted.count !== 1) throw denied();
    // Preserve legacy Zapier deauthorization, but never leave its webhooks live
    // when key deletion commits, or remove another user's hooks.
    const removed =
      key.appId === "zapier"
        ? await tx.webhook.deleteMany({ where: { userId, appId: "zapier" } })
        : { count: 0 };
    await audit(tx, userId, organizationId, "api_key.revoked", {
      keyId: id,
      teamId: key.teamId,
      removedWebhooks: removed.count,
    });
    return { id };
  });
}

export async function listApiKeyMetadata(client: PrismaClient, userId: number, input?: FindApiKeyInput) {
  if (input !== undefined) {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => !["teamId", "appId"].includes(key)) ||
      (input.teamId !== undefined && (!Number.isSafeInteger(input.teamId) || input.teamId <= 0)) ||
      (input.appId !== undefined && (typeof input.appId !== "string" || input.appId.length > 255))
    )
      throw invalid();
  }
  return atomicApiKeyOperation(client, async (tx) => {
    await requireApiKeyAuthority(tx, userId, input?.teamId ?? null);
    const keys = await tx.apiKey.findMany({
      where: {
        userId,
        ...(input ?? {}),
        ...(input === undefined ? { OR: [{ appId: { not: "zapier" } }, { appId: null }] } : {}),
      },
      select: metadata,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    return input === undefined ? keys.filter((key) => !key.note?.startsWith("Cal.ai Phone API Key")) : keys;
  });
}
