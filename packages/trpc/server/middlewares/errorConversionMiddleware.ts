import { TRPCError } from "@trpc/server";
import { convertErrorWithCodeToTRPCError } from "../lib/toTRPCError";
import { middleware } from "../trpc";

/** Translate recognized domain errors, whether thrown or wrapped by tRPC. */
export const errorConversionMiddleware = middleware(async ({ next }) => {
  try {
    const result = await next();
    // The installed tRPC version returns resolver failures as MiddlewareResult,
    // rather than rejecting next(). Preserve already-classified transport errors
    // and unknown failures; translate only a recognized domain cause.
    if (!result.ok && result.error.code === "INTERNAL_SERVER_ERROR") {
      const translated = convertErrorWithCodeToTRPCError(result.error.cause);
      if (translated instanceof TRPCError) return { ...result, error: translated };
    }
    return result;
  } catch (error) {
    throw convertErrorWithCodeToTRPCError(error);
  }
});
