import {
  OrganizationProvisioningService,
  provisionOrganizationInput,
  reviewOrganizationInput,
} from "@calcom/features/community-enterprise/organizations/OrganizationProvisioningService";
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
