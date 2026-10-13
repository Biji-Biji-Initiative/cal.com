import { createApiKey } from "@calcom/features/community-enterprise/api-keys/ApiKeyLifecycle";
import prisma from "@calcom/prisma";
import { TRPCError } from "@trpc/server";
import type { TrpcSessionUser } from "../../../types";
import type { TCreateInputSchema } from "./create.schema";

type CreateHandlerOptions = {
  ctx: { user: Pick<NonNullable<TrpcSessionUser>, "id"> };
  input: TCreateInputSchema;
};

export const createHandler = async ({ ctx, input }: CreateHandlerOptions) => {
  try {
    return await createApiKey(prisma, ctx.user.id, input, process.env.API_KEY_PREFIX ?? "cal_");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      if (error.code === "forbidden_error") throw new TRPCError({ code: "FORBIDDEN" });
      if (error.code === "bad_request_error") throw new TRPCError({ code: "BAD_REQUEST" });
    }
    throw error;
  }
};
