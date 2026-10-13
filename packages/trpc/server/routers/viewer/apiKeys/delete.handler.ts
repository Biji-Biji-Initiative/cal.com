import { revokeApiKey } from "@calcom/features/community-enterprise/api-keys/ApiKeyManagement";
import type { PrismaClient } from "@calcom/prisma";
import type { TrpcSessionUser } from "../../../types";
import type { TDeleteInputSchema } from "./delete.schema";

type Options = {
  ctx: { user: NonNullable<TrpcSessionUser>; prisma: PrismaClient };
  input: TDeleteInputSchema;
};

export const deleteHandler = async ({ ctx, input }: Options) => {
  return revokeApiKey(ctx.prisma, ctx.user.id, input.id);
};
