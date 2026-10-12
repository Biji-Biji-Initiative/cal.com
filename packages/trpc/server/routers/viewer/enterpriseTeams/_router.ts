import {
  createTeamInput,
  setMemberInput,
  TeamService,
} from "@calcom/features/community-enterprise/teams/TeamService";
import authedProcedure from "../../../procedures/authedProcedure";
import { router } from "../../../trpc";

export const enterpriseTeamsRouter = router({
  overview: authedProcedure.query(({ ctx }) => new TeamService(ctx.prisma).overview(ctx.user.id)),
  create: authedProcedure
    .input(createTeamInput)
    .mutation(({ ctx, input }) => new TeamService(ctx.prisma).createTeam(ctx.user.id, input)),
  setMember: authedProcedure
    .input(setMemberInput)
    .mutation(({ ctx, input }) => new TeamService(ctx.prisma).setMember(ctx.user.id, input)),
});
