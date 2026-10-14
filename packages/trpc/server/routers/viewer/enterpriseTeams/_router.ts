import { randomUUID } from "node:crypto";
import {
  invitationAdminInput,
  invitationPageInput,
  invitationResponseInput,
  inviteOrganizationMemberInput,
  OrganizationInvitationService,
} from "@calcom/features/community-enterprise/organizations/OrganizationInvitationService";
import {
  OrganizationProvisioningService,
  provisionOrganizationInput,
  reviewOrganizationInput,
} from "@calcom/features/community-enterprise/organizations/OrganizationProvisioningService";
import { sendOrganizationInvitationNotice } from "@calcom/features/community-enterprise/organizations/sendOrganizationInvitationNotice";
import {
  createTeamInput,
  setMemberInput,
  TeamService,
} from "@calcom/features/community-enterprise/teams/TeamService";
import { WEBAPP_URL } from "@calcom/lib/constants";
import { TRPCError } from "@trpc/server";
import authedProcedure from "../../../procedures/authedProcedure";
import { router } from "../../../trpc";

// Initial organization admission is a same-origin operator browser action.
// Future API/MCP clients need explicit grants, not a reused privileged cookie.
const provisioningProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.req?.method !== "POST" || ctx.req.headers.origin !== new URL(WEBAPP_URL).origin) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Organization admission requires the same-origin operator interface",
    });
  }
  return next();
});

export const enterpriseTeamsRouter = router({
  invitations: authedProcedure
    .input(invitationPageInput)
    .query(({ ctx, input }) =>
      new OrganizationInvitationService(ctx.prisma).pending({ id: ctx.user.id, uuid: ctx.user.uuid }, input)
    ),
  inviteMember: provisioningProcedure
    .input(inviteOrganizationMemberInput)
    .mutation(async ({ ctx, input }) => {
      const actor = { id: ctx.user.id, uuid: ctx.user.uuid };
      const service = new OrganizationInvitationService(ctx.prisma);
      const result = await service.invite(actor, input);
      if (result.replayed) return { ...result, email: "unconfirmed" as const };
      // The pending invitation is committed before email. Failure here must not
      // pretend the membership is accepted or create another invite on retry.
      try {
        const notification = await service.notify(
          actor,
          {
            organizationId: input.organizationId,
            invitationId: result.invitationId,
            requestId: randomUUID(),
          },
          sendOrganizationInvitationNotice
        );
        return { ...result, ...notification };
      } catch {
        return { ...result, email: "unconfirmed" as const };
      }
    }),
  respondToInvitation: provisioningProcedure
    .input(invitationResponseInput)
    .mutation(({ ctx, input }) =>
      new OrganizationInvitationService(ctx.prisma).respond({ id: ctx.user.id, uuid: ctx.user.uuid }, input)
    ),
  cancelInvitation: provisioningProcedure
    .input(invitationAdminInput)
    .mutation(({ ctx, input }) =>
      new OrganizationInvitationService(ctx.prisma).cancel({ id: ctx.user.id, uuid: ctx.user.uuid }, input)
    ),
  resendInvitation: provisioningProcedure
    .input(invitationAdminInput)
    .mutation(({ ctx, input }) =>
      new OrganizationInvitationService(ctx.prisma).notify(
        { id: ctx.user.id, uuid: ctx.user.uuid },
        input,
        sendOrganizationInvitationNotice
      )
    ),

  provisioningCapabilities: authedProcedure.query(({ ctx }) =>
    new OrganizationProvisioningService(ctx.prisma).capabilities({ id: ctx.user.id, uuid: ctx.user.uuid })
  ),
  reviewOrganization: provisioningProcedure
    .input(reviewOrganizationInput)
    .mutation(({ ctx, input }) =>
      new OrganizationProvisioningService(ctx.prisma).review({ id: ctx.user.id, uuid: ctx.user.uuid }, input)
    ),
  provisionOrganization: provisioningProcedure
    .input(provisionOrganizationInput)
    .mutation(({ ctx, input }) =>
      new OrganizationProvisioningService(ctx.prisma).provision(
        { id: ctx.user.id, uuid: ctx.user.uuid },
        input
      )
    ),

  overview: authedProcedure.query(({ ctx }) => new TeamService(ctx.prisma).overview(ctx.user.id)),
  create: authedProcedure
    .input(createTeamInput)
    .mutation(({ ctx, input }) => new TeamService(ctx.prisma).createTeam(ctx.user.id, input)),
  setMember: authedProcedure
    .input(setMemberInput)
    .mutation(({ ctx, input }) => new TeamService(ctx.prisma).setMember(ctx.user.id, input)),
});
