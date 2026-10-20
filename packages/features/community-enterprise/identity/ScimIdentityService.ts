// SPDX-License-Identifier: MIT
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { Prisma, type PrismaClient } from "@calcom/prisma/client";
import { z } from "zod";
import { digest } from "./IdentityLinkPlan";

const id = z.number().int().positive().safe();
const exact = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value.trim() === value && !/[\x00-\x1f\x7f]/.test(value));
const scopeSchema = z
  .object({
    actorUserId: id,
    actorUuid: z.string().uuid(),
    organizationId: id,
    directoryId: exact,
    tenant: exact,
    externalId: exact,
  })
  .strict();
const bindingSchema = scopeSchema
  .extend({
    operationId: z.string().uuid(),
    userId: id,
    expectedUserUuid: z.string().uuid(),
  })
  .strict();
const refused = () =>
  new ErrorWithCode(
    ErrorCode.Forbidden,
    "SCIM identity requires current exact directory, operator and organization membership authority"
  );
const action = "identity.scim.bound";

// Reviewed operator workflow only. A future authenticated adapter must not turn
// a userName/email or caller-supplied tenant into permission to bind an identity.
export class ScimIdentityService {
  constructor(private readonly db: PrismaClient) {}

  bind(input: unknown) {
    return this.run(bindingSchema.parse(input));
  }

  resolve(input: unknown) {
    return this.run(scopeSchema.parse(input));
  }

  private run(request: z.infer<typeof scopeSchema> | z.infer<typeof bindingSchema>) {
    const binding = "userId" in request ? request : null;
    return this.db.$transaction(
      async (tx) => {
        // Match existing organization/member writers before locking users. The
        // directory lock also serializes competing absent-key/rebind decisions.
        await tx.$queryRaw`SELECT id FROM "Team" WHERE id = ${request.organizationId} FOR SHARE`;
        await tx.$queryRaw`SELECT true AS acquired FROM pg_advisory_xact_lock(hashtext('cal.scim.identity'), hashtext(${request.directoryId}))`;
        const existing = await tx.scimUserIdentity.findUnique({
          where: {
            directoryId_externalId: { directoryId: request.directoryId, externalId: request.externalId },
          },
          select: { id: true, userId: true, expectedUserUuid: true },
        });
        const userId = binding?.userId ?? existing?.userId;
        if (!userId) throw refused();
        const ids = Array.from(new Set([request.actorUserId, userId])).sort((a, b) => a - b);
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "users" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Membership" WHERE "teamId" = ${request.organizationId} AND "userId" IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`
        );
        await tx.$queryRaw`SELECT id FROM "DSyncData" WHERE "directoryId" = ${request.directoryId} FOR SHARE`;
        const organization = await tx.team.findUnique({
          where: { id: request.organizationId },
          select: { isOrganization: true, parentId: true },
        });
        const directory = await tx.dSyncData.findUnique({
          where: { directoryId: request.directoryId },
          select: { organizationId: true, tenant: true },
        });
        const users = await tx.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, uuid: true, role: true, locked: true, isPlatformManaged: true },
        });
        const actor = users.find((user) => user.id === request.actorUserId);
        const user = users.find((entry) => entry.id === userId);
        const members = await tx.membership.findMany({
          where: { teamId: request.organizationId, userId: { in: ids } },
          select: { userId: true, accepted: true },
        });
        if (
          !organization?.isOrganization ||
          organization.parentId !== null ||
          directory?.organizationId !== request.organizationId ||
          directory.tenant !== request.tenant ||
          !actor ||
          actor.uuid !== request.actorUuid ||
          actor.role !== "ADMIN" ||
          actor.locked ||
          actor.isPlatformManaged ||
          !user ||
          user.locked ||
          user.isPlatformManaged ||
          ids.some((entry) => !members.some((member) => member.userId === entry && member.accepted))
        )
          throw refused();
        const expectedUuid = binding?.expectedUserUuid ?? existing?.expectedUserUuid;
        if (
          user.uuid !== expectedUuid ||
          (existing && (existing.userId !== user.id || existing.expectedUserUuid !== user.uuid))
        )
          throw refused();
        if (existing) {
          const provenance = await tx.enterpriseAuditEvent.findFirst({
            where: {
              action,
              organizationId: request.organizationId,
              AND: [
                { details: { path: ["bindingId"], equals: existing.id } },
                { details: { path: ["directoryId"], equals: request.directoryId } },
                { details: { path: ["tenant"], equals: request.tenant } },
              ],
            },
            select: { id: true },
          });
          if (!provenance) throw refused();
        }
        if (!binding) {
          if (!existing) throw refused();
          return existing;
        }
        const other = await tx.scimUserIdentity.findUnique({
          where: { directoryId_userId: { directoryId: request.directoryId, userId: user.id } },
          select: { id: true },
        });
        if (other && other.id !== existing?.id) throw refused();
        const operationHash = digest({ action, request });
        const prior = await tx.enterpriseAuditEvent.findUnique({
          where: { operationId: binding.operationId },
          select: { action: true, operationHash: true, details: true },
        });
        if (prior) {
          const details = prior.details;
          if (
            prior.action !== action ||
            prior.operationHash !== operationHash ||
            !existing ||
            !details ||
            typeof details !== "object" ||
            Array.isArray(details) ||
            details.bindingId !== existing.id
          )
            throw refused();
          return existing;
        }
        const result =
          existing ??
          (await tx.scimUserIdentity.create({
            data: {
              directoryId: request.directoryId,
              externalId: request.externalId,
              userId: user.id,
              expectedUserUuid: user.uuid,
            },
            select: { id: true, userId: true, expectedUserUuid: true },
          }));
        await tx.enterpriseAuditEvent.create({
          data: {
            operationId: binding.operationId,
            operationHash,
            action,
            actorUserId: actor.id,
            organizationId: request.organizationId,
            details: { bindingId: result.id, directoryId: request.directoryId, tenant: request.tenant },
          },
          select: { id: true },
        });
        return result;
      },
      { isolationLevel: "Serializable", timeout: 10000, maxWait: 5000 }
    );
  }
}
