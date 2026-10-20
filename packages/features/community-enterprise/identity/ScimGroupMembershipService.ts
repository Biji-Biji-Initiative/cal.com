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
const deactivationSchema = inputSchema.extend({ event: z.literal("group-member-remove") });

// Reviewed operator adapter; organization admission and user-wide deprovision
// remain separate workflows. Local memberships are never adopted or edited.
export class ScimGroupMembershipService {
  constructor(private readonly db: PrismaClient) {}

  add(raw: unknown) {
    return this.run(inputSchema.parse(raw), false);
  }

  deactivate(raw: unknown) {
    return this.run(deactivationSchema.parse(raw), true);
  }

  private run(input: z.infer<typeof inputSchema> | z.infer<typeof deactivationSchema>, deactivate: boolean) {
    const action = deactivate ? "identity.scim.membership.deactivated" : "identity.scim.membership.granted";
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
        // Reactivation requires its own reviewed operation.
        if (!deactivate && disposition === "owned" && member?.accepted !== true) throw refused();
        const operationHash = digest({ action, input });
        const prior = await tx.enterpriseAuditEvent.findUnique({
          where: { operationId: input.operationId },
          select: { action: true, operationHash: true },
        });
        if (
          prior &&
          (prior.action !== action ||
            prior.operationHash !== operationHash ||
            disposition !== "owned" ||
            (deactivate && member?.accepted !== false))
        )
          throw refused();
        if (member && disposition === "local")
          return { status: "preserved-local" as const, membershipId: member.id };
        if (member && !deactivate) return { status: "already-managed" as const, membershipId: member.id };
        if (deactivate && !member) return { status: "absent" as const };
        if (member && !member.accepted)
          return { status: "already-inactive" as const, membershipId: member.id };
        const select = { id: true, role: true, accepted: true, customRoleId: true, updatedAt: true } as const;
        // Deleting Membership cascades native Host rows. Retain those and all
        // appointments while the existing booking authority fences assignment.
        const changed = member
          ? await tx.membership.update({ where: { id: member.id }, data: { accepted: false }, select })
          : await tx.membership.create({
              data: { teamId: input.teamId, userId: identity.userId, role: "MEMBER", accepted: true },
              select,
            });
        const snapshot = {
          lastManagedRole: changed.role,
          lastManagedAccepted: changed.accepted,
          lastManagedCustomRoleId: changed.customRoleId,
          lastManagedUpdatedAt: changed.updatedAt,
        };
        if (member)
          await tx.scimMembershipGrant.update({
            where: { directoryId_membershipId: { directoryId: scope.directoryId, membershipId: member.id } },
            data: snapshot,
            select: { id: true },
          });
        else
          await tx.scimMembershipGrant.create({
            data: { directoryId: scope.directoryId, membershipId: changed.id, ...snapshot },
            select: { id: true },
          });
        await tx.enterpriseAuditEvent.create({
          data: {
            operationId: input.operationId,
            operationHash,
            action,
            actorUserId: scope.actorUserId,
            organizationId: scope.organizationId,
            details: { membershipId: changed.id, directoryId: scope.directoryId, groupName: input.groupName },
          },
          select: { id: true },
        });
        return { status: member ? ("deactivated" as const) : ("granted" as const), membershipId: changed.id };
      }
    );
  }
}
