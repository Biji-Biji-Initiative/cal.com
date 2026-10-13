import { editApiKey } from "@calcom/features/community-enterprise/api-keys/ApiKeyManagement";
import type { PrismaClient } from "@calcom/prisma";
import type { TrpcSessionUser } from "../../../types";
import type { TEditInputSchema } from "./edit.schema";

type Options = {
  ctx: { user: NonNullable<TrpcSessionUser>; prisma: PrismaClient };
  input: TEditInputSchema;
};

export const editHandler = async ({ ctx, input }: Options) => {
  return editApiKey(ctx.prisma, ctx.user.id, input);
};
