import { listApiKeyMetadata } from "@calcom/features/community-enterprise/api-keys/ApiKeyManagement";
import type { PrismaClient } from "@calcom/prisma";
import type { TrpcSessionUser } from "../../../types";
import type { TFindKeyOfTypeInputSchema } from "./findKeyOfType.schema";

type Options = {
  ctx: { user: NonNullable<TrpcSessionUser>; prisma: PrismaClient };
  input: TFindKeyOfTypeInputSchema;
};

export const findKeyOfTypeHandler = async ({ ctx, input }: Options) => {
  return listApiKeyMetadata(ctx.prisma, ctx.user.id, input);
};
