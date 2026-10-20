// SPDX-License-Identifier: MIT
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { PrismaClient } from "@calcom/prisma/client";
import { z } from "zod";
import { digest } from "./IdentityLinkPlan";
import { ScimIdentityService } from "./ScimIdentityService";
import { scimMembershipDisposition } from "./ScimMembershipProvenance";

const inputSchema = z
  .object({
    identity: z.unknown(),
    teamId: z.number().int().positive().safe(),
    groupName: z
      .string()
      .min(1)
      .max(256)
      .refine((value) => value.trim() === value),
    operationId: z.string().uuid(),
  })
  .strict();
const refused = () =>
  new ErrorWithCode(
    ErrorCode.Forbidden,
    "SCIM group grant requires exact current mapping and unchanged member provenance"
  );
const action = "identity.scim.membership.granted";

// Add-only reviewed operator adapter. Organization admission and revocation use
// their own domain workflows; no existing local membership is adopted or edited.
export class ScimGroupMembershipService {
  constructor(private readonly db: PrismaClient) {}

  add(raw: unknown) {
    const input = inputSchema.parse(raw);
    return new ScimIdentityService(this.db).withResolvedIdentity(
      input.identity,
      input.teamId,
      async (tx, identity) => {
        const scope = z
          .object({ organizationId: z.number(), directoryId: z.string(), actorUserId: z.number() })
          .passthrough()
          .parse(input.identity);
        await tx.$queryRaw`SELECT id FROM "DSyncTeamGroupMapping" WHERE "teamId" = ${input.teamId} AND "groupName" = ${input.groupName} FOR SHARE`;
        const mapping = await tx.dSyncTeamGroupMapping.findUnique({
          where: { teamId_groupName: { teamId: input.teamId, groupName: input.groupName } },
          select: { directoryId: true, organizationId: true },
        });
        if (mapping?.directoryId !== scope.directoryId || mapping.organizationId !== scope.organizationId)
          throw refused();
        await tx.$queryRaw`SELECT id FROM "Membership" WHERE "teamId" = ${input.teamId} AND "userId" = ${identity.userId} FOR UPDATE`;
        const member = await tx.membership.findUnique({
          where: { userId_teamId: { userId: identity.userId, teamId: input.teamId } },
          select: {
            id: true,
            userId: true,
            teamId: true,
            role: true,
            accepted: true,
            customRoleId: true,
            updatedAt: true,
          },
        });
        const grants = member
          ? await tx.scimMembershipGrant.findMany({
              where: { membershipId: member.id },
              select: {
                directoryId: true,
                membershipId: true,
                lastManagedRole: true,
                lastManagedAccepted: true,
                lastManagedCustomRoleId: true,
                lastManagedUpdatedAt: true,
              },
            })
          : [];
        const disposition = scimMembershipDisposition(
          { directoryId: scope.directoryId, userId: identity.userId, teamId: input.teamId },
          member,
          grants
        );
        const operationHash = digest({ action, input });
        const prior = await tx.enterpriseAuditEvent.findUnique({
          where: { operationId: input.operationId },
          select: { action: true, operationHash: true },
        });
        if (
          prior &&
          (prior.action !== action || prior.operationHash !== operationHash || disposition !== "owned")
        )
          throw refused();
        if (member)
          return {
            status: disposition === "local" ? ("preserved-local" as const) : ("already-managed" as const),
            membershipId: member.id,
          };
        const created = await tx.membership.create({
          data: { teamId: input.teamId, userId: identity.userId, role: "MEMBER", accepted: true },
          select: { id: true, role: true, accepted: true, customRoleId: true, updatedAt: true },
        });
        await tx.scimMembershipGrant.create({
          data: {
            directoryId: scope.directoryId,
            membershipId: created.id,
            lastManagedRole: created.role,
            lastManagedAccepted: created.accepted,
            lastManagedCustomRoleId: created.customRoleId,
            lastManagedUpdatedAt: created.updatedAt,
          },
          select: { id: true },
        });
        await tx.enterpriseAuditEvent.create({
          data: {
            operationId: input.operationId,
            operationHash,
            action,
            actorUserId: scope.actorUserId,
            organizationId: scope.organizationId,
            details: { membershipId: created.id, directoryId: scope.directoryId, groupName: input.groupName },
          },
          select: { id: true },
        });
        return { status: "granted" as const, membershipId: created.id };
      }
    );
  }
}
