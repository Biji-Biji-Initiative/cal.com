import {
  roleAssignmentCommitInput,
  roleAssignmentInput,
  roleCreateInput,
  roleScopeInput,
} from "@calcom/features/community-enterprise/roles/roleInputs";
import { ScopedRoleService } from "@calcom/features/community-enterprise/roles/ScopedRoleService";
import { WEBAPP_URL } from "@calcom/lib/constants";
import { TRPCError } from "@trpc/server";
import authedProcedure from "../../../procedures/authedProcedure";
import { router } from "../../../trpc";

// User IDs and a browser confirmation are not reusable agent credentials.
const roleMutation = authedProcedure.use(({ ctx, next }) => {
  if (ctx.req?.method !== "POST" || ctx.req.headers.origin !== new URL(WEBAPP_URL).origin)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Role administration requires the same-origin interface",
    });
  return next();
});
export const enterpriseRolesRouter = router({
  capability: authedProcedure
    .input(roleScopeInput)
    .query(({ ctx, input }) =>
      new ScopedRoleService(ctx.prisma).capability({ id: ctx.user.id, uuid: ctx.user.uuid }, input)
    ),
  catalog: authedProcedure
    .input(roleScopeInput)
    .query(({ ctx, input }) =>
      new ScopedRoleService(ctx.prisma).catalog({ id: ctx.user.id, uuid: ctx.user.uuid }, input)
    ),
  create: roleMutation
    .input(roleCreateInput)
    .mutation(({ ctx, input }) =>
      new ScopedRoleService(ctx.prisma).create({ id: ctx.user.id, uuid: ctx.user.uuid }, input)
    ),
  review: roleMutation
    .input(roleAssignmentInput)
    .mutation(({ ctx, input }) =>
      new ScopedRoleService(ctx.prisma).review({ id: ctx.user.id, uuid: ctx.user.uuid }, input)
    ),
  assign: roleMutation
    .input(roleAssignmentCommitInput)
    .mutation(({ ctx, input }) =>
      new ScopedRoleService(ctx.prisma).assign({ id: ctx.user.id, uuid: ctx.user.uuid }, input)
    ),
});
