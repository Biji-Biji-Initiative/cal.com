import { PermissionCheckService } from "@calcom/features/community-enterprise/authorization/PermissionCheckService";
import { prisma } from "@calcom/prisma";
import { TRPCError } from "@trpc/server";
import authedProcedure from "../../../procedures/authedProcedure";
import { webhookIdAndEventTypeIdSchema } from "./types";

async function requireTeamWebhookAccess(userId: number, teamId: number | null | undefined) {
  if (teamId == null) return;
  if (
    !(await new PermissionCheckService(prisma).checkPermission({
      userId,
      teamId,
      permission: "webhook.update",
      fallbackRoles: ["ADMIN", "OWNER"],
    }))
  )
    throw new TRPCError({ code: "FORBIDDEN" });
}

export const createWebhookProcedure = () => {
  return authedProcedure.input(webhookIdAndEventTypeIdSchema.optional()).use(async ({ ctx, input, next }) => {
    if (!input) return next();

    const { id, webhookId, eventTypeId } = input;
    if (id && webhookId && id !== webhookId) throw new TRPCError({ code: "BAD_REQUEST" });
    const lookupId = id || webhookId;

    if (lookupId) {
      // Check if user is authorized to edit webhook
      const webhook = await prisma.webhook.findUnique({
        where: { id: lookupId },
        select: {
          id: true,
          userId: true,
          eventTypeId: true,
          teamId: true,
          platform: true,
          platformOAuthClientId: true,
        },
      });

      if (!webhook) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Historical owner-only checks must not survive removal of organization
      // membership or let an ownerless team webhook become globally writable.
      if (webhook.platformOAuthClientId) throw new TRPCError({ code: "FORBIDDEN" });
      if (webhook.platform) {
        const operator = await prisma.user.findUnique({
          where: { id: ctx.user.id },
          select: { role: true, locked: true },
        });
        if (!operator || operator.locked || operator.role !== "ADMIN")
          throw new TRPCError({ code: "FORBIDDEN" });
      } else if (!webhook.userId && !webhook.teamId && !webhook.eventTypeId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await requireTeamWebhookAccess(ctx.user.id, webhook.teamId);

      if (eventTypeId && eventTypeId !== webhook.eventTypeId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      if (webhook.eventTypeId) {
        const eventType = await prisma.eventType.findUnique({
          where: { id: webhook.eventTypeId },
          select: {
            id: true,
            userId: true,
            teamId: true,
            profile: { select: { organizationId: true } },
            parent: { select: { teamId: true } },
          },
        });

        if (!eventType) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        const scope = eventType.teamId ?? eventType.profile?.organizationId ?? eventType.parent?.teamId;
        if (scope && webhook.teamId && scope !== webhook.teamId) throw new TRPCError({ code: "FORBIDDEN" });
        await requireTeamWebhookAccess(ctx.user.id, scope);
        if (eventType.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
      } else if (webhook.userId && webhook.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
    } else if (eventTypeId) {
      const eventType = await prisma.eventType.findUnique({
        where: { id: eventTypeId },
        select: {
          id: true,
          userId: true,
          teamId: true,
          profile: { select: { organizationId: true } },
          parent: { select: { teamId: true } },
        },
      });

      if (!eventType) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      await requireTeamWebhookAccess(
        ctx.user.id,
        eventType.teamId ?? eventType.profile?.organizationId ?? eventType.parent?.teamId
      );
      if (eventType.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
    }

    return next();
  });
};

export const webhookProcedure = createWebhookProcedure();
