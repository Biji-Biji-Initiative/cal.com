import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  return { middleware: initTRPC.create().middleware };
});

import { errorConversionMiddleware } from "./errorConversionMiddleware";

const t = initTRPC.create();
function caller(operation: () => unknown) {
  return t.router({ action: t.procedure.use(errorConversionMiddleware).query(operation) }).createCaller({});
}

describe("native tRPC domain-error conversion", () => {
  it("preserves successful responses", async () => {
    expect(await caller(() => ({ ok: true })).action()).toEqual({ ok: true });
  });
  it.each([
    [ErrorCode.Forbidden, "FORBIDDEN"],
    [ErrorCode.Unauthorized, "UNAUTHORIZED"],
    [ErrorCode.BadRequest, "BAD_REQUEST"],
    [ErrorCode.NotFound, "NOT_FOUND"],
  ] as const)("maps wrapped domain %s to %s", async (domain, transport) => {
    await expect(
      caller(() => {
        throw new ErrorWithCode(domain, "Expected domain failure");
      }).action()
    ).rejects.toMatchObject({ code: transport, message: "Expected domain failure" });
  });
  it("retains existing transport codes", async () => {
    const error = new TRPCError({ code: "CONFLICT", message: "Already classified" });
    await expect(
      caller(() => {
        throw error;
      }).action()
    ).rejects.toBe(error);
  });
  it("does not let arbitrary code-looking objects change the status", async () => {
    const error = Object.assign(new Error("Unknown failure"), { code: ErrorCode.Forbidden });
    await expect(
      caller(() => {
        throw error;
      }).action()
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
  it("retains unknown internal failures", async () => {
    await expect(
      caller(() => {
        throw new Error("Database unavailable");
      }).action()
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  });
});
