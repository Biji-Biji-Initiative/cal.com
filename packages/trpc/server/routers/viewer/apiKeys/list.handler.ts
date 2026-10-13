import { listApiKeyMetadata } from "@calcom/features/community-enterprise/api-keys/ApiKeyManagement";
import type { PrismaClient } from "@calcom/prisma";
import type { TrpcSessionUser } from "../../../types";

type ListOptions = {
  ctx: { user: NonNullable<TrpcSessionUser>; prisma: PrismaClient };
};

export const listHandler = async ({ ctx: { user, prisma } }: ListOptions) => {
  return listApiKeyMetadata(prisma, user.id);
};
