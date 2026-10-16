import { APPS_WRITE, SCHEDULE_READ, SCHEDULE_WRITE } from "@calcom/platform-constants";
import { createMock } from "@golevelup/ts-jest";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PermissionsGuard } from "./permissions.guard";
import { AuthMethods } from "@/lib/enums/auth-methods";
import { Permissions } from "@/modules/auth/decorators/permissions/permissions.decorator";
import type { ApiAuthGuardRequest } from "@/modules/auth/strategies/api-auth/api-auth.strategy";
import { OAuthClientRepository } from "@/modules/oauth-clients/oauth-client.repository";
import { TokensRepository } from "@/modules/tokens/tokens.repository";

describe("PermissionsGuard selected-authority contract", () => {
  let guard: PermissionsGuard;
  let tokens: TokensRepository;
  let clients: OAuthClientRepository;
  beforeEach(() => {
    tokens = createMock<TokensRepository>();
    clients = createMock<OAuthClientRepository>();
    jest.spyOn(tokens, "getAccessTokenPermissionState").mockResolvedValue({
      expiresAt: new Date(Date.now() + 60000),
      client: { id: "client", permissions: SCHEDULE_READ | SCHEDULE_WRITE },
    });
    jest.spyOn(clients, "getOAuthClientPermissionState").mockResolvedValue({
      id: "client",
      permissions: SCHEDULE_READ | SCHEDULE_WRITE,
      secret: "test-client-credential",
    });
    guard = new PermissionsGuard(new Reflector(), tokens, clients);
  });
  function context(
    method: AuthMethods = AuthMethods.ACCESS_TOKEN,
    headers: Record<string, string> = { Authorization: "Bearer test-access-credential" },
    permissions: (typeof SCHEDULE_READ | typeof SCHEDULE_WRITE | typeof APPS_WRITE)[] | undefined = [
      SCHEDULE_WRITE,
    ]
  ) {
    const handler = () => undefined;
    class FixtureController {}
    if (permissions) Permissions(permissions)(handler);
    const request = createMock<ApiAuthGuardRequest>({
      authMethod: method,
      organizationId: 42,
      user: { id: 7, locked: false },
      params: {},
      headers,
      get: jest.fn((name: string) => headers[name]),
    });
    const ctx = createMock<ExecutionContext>({
      switchToHttp: () => ({ getRequest: () => request }),
    });
    jest.spyOn(ctx, "getHandler").mockReturnValue(handler);
    jest.spyOn(ctx, "getClass").mockReturnValue(FixtureController);
    return { ctx, request, FixtureController };
  }
  const clientHeaders = { "x-cal-client-id": "client", "x-cal-secret-key": "test-client-credential" };

  it("retains complete read/write masks for admitted access tokens", async () => {
    const { ctx } = context(AuthMethods.ACCESS_TOKEN, undefined, [SCHEDULE_READ, SCHEDULE_WRITE]);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(tokens.getAccessTokenPermissionState).toHaveBeenCalledWith("test-access-credential", 7);
  });
  it("rejects an absent required bit without exposing credentials", async () => {
    const { ctx } = context(AuthMethods.ACCESS_TOKEN, undefined, [APPS_WRITE]);
    await expect(guard.canActivate(ctx)).rejects.toThrow("required permissions");
  });
  it("uses a controller requirement when the handler has none", async () => {
    const { ctx, FixtureController } = context(AuthMethods.ACCESS_TOKEN, undefined, []);
    const handler = () => undefined;
    jest.spyOn(ctx, "getHandler").mockReturnValue(handler);
    Permissions([APPS_WRITE])(FixtureController);
    await expect(guard.canActivate(ctx)).rejects.toThrow("required permissions");
  });
  it("method permission metadata deliberately overrides its controller default", async () => {
    const { ctx, FixtureController } = context(AuthMethods.ACCESS_TOKEN, undefined, [SCHEDULE_READ]);
    Permissions([APPS_WRITE])(FixtureController);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
  it("an explicit empty requirement does not make this guard a mandatory authenticator", async () => {
    const { ctx, FixtureController } = context(AuthMethods.ACCESS_TOKEN, undefined, []);
    Permissions([APPS_WRITE])(FixtureController);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(tokens.getAccessTokenPermissionState).not.toHaveBeenCalled();
  });
  for (const method of [AuthMethods.NEXT_AUTH, AuthMethods.API_KEY, AuthMethods.THIRD_PARTY_ACCESS_TOKEN]) {
    it(`preserves ${method}'s existing separate resource-policy contract`, async () => {
      const { ctx } = context(method);
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(tokens.getAccessTokenPermissionState).not.toHaveBeenCalled();
      expect(clients.getOAuthClientPermissionState).not.toHaveBeenCalled();
    });
  }
  it("untrusted headers do not invent the selected method", async () => {
    const { ctx, request } = context();
    Reflect.deleteProperty(request, "authMethod");
    request.headers["x-auth-method"] = "next-auth";
    await expect(guard.canActivate(ctx)).rejects.toThrow("authority is unavailable");
  });
  for (const change of ["missing-user", "locked-user", "zero-user"] as const) {
    it(`refuses ${change} before looking up permissions`, async () => {
      const { ctx, request } = context();
      if (change === "missing-user") Reflect.deleteProperty(request, "user");
      if (change === "locked-user") request.user.locked = true;
      if (change === "zero-user") request.user.id = 0;
      await expect(guard.canActivate(ctx)).rejects.toThrow("authority is unavailable");
      expect(tokens.getAccessTokenPermissionState).not.toHaveBeenCalled();
    });
  }
  for (const value of [
    "Basic test-access-credential",
    "Bearer",
    "Bearer one two",
    "Bearer test-access-credential\n",
  ]) {
    it(`refuses malformed credential ${JSON.stringify(value)} without a cookie fallback`, async () => {
      const { ctx } = context(AuthMethods.ACCESS_TOKEN, { Authorization: value, Cookie: "unrelated-cookie" });
      await expect(guard.canActivate(ctx)).rejects.toThrow("authority is unavailable");
    });
  }
  it("accepts the same case-insensitive Bearer scheme as authentication", async () => {
    const { ctx } = context(AuthMethods.ACCESS_TOKEN, { Authorization: "bearer test-access-credential" });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
  for (const expiresAt of [new Date(0), new Date(Number.NaN)]) {
    it(`refuses non-current expiry ${String(expiresAt)}`, async () => {
      jest
        .spyOn(tokens, "getAccessTokenPermissionState")
        .mockResolvedValue({ expiresAt, client: { id: "client", permissions: SCHEDULE_WRITE } });
      await expect(guard.canActivate(context().ctx)).rejects.toThrow("authority is unavailable");
    });
  }
  it("does not include a missing raw token in the error", async () => {
    jest.spyOn(tokens, "getAccessTokenPermissionState").mockResolvedValue(null);
    await expect(guard.getOAuthClientByAccessToken("test-access-credential", 7)).rejects.toThrow(
      "authority is unavailable"
    );
    await expect(guard.getOAuthClientByAccessToken("test-access-credential", 7)).rejects.not.toThrow(
      "test-access-credential"
    );
  });
  it("passes a primary read failure through without a secondary reader", async () => {
    jest.spyOn(tokens, "getAccessTokenPermissionState").mockRejectedValue(new Error("primary failed"));
    await expect(guard.canActivate(context().ctx)).rejects.toThrow("primary failed");
  });
  it("validates the selected client against current actor, organization and secret", async () => {
    await expect(guard.canActivate(context(AuthMethods.OAUTH_CLIENT, clientHeaders).ctx)).resolves.toBe(true);
    expect(clients.getOAuthClientPermissionState).toHaveBeenCalledWith("client", 7, 42);
  });
  it("does not switch an already selected client to a secondary bearer", async () => {
    const { ctx } = context(AuthMethods.OAUTH_CLIENT, {
      ...clientHeaders,
      Authorization: "Bearer cal_secondary",
      Cookie: "secondary",
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(tokens.getAccessTokenPermissionState).not.toHaveBeenCalled();
  });
  it("retains route-client precedence over a conflicting client header", async () => {
    const { ctx, request } = context(AuthMethods.OAUTH_CLIENT, clientHeaders);
    request.params.clientId = "route-client";
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(clients.getOAuthClientPermissionState).toHaveBeenCalledWith("route-client", 7, 42);
  });
  it("refuses client secret rotation without returning the stored secret", async () => {
    await expect(
      guard.canActivate(
        context(AuthMethods.OAUTH_CLIENT, { ...clientHeaders, "x-cal-secret-key": "prior-secret" }).ctx
      )
    ).rejects.toThrow("authority is unavailable");
    expect(await guard.getOAuthClientById("client", 7, 42, "test-client-credential")).toEqual({
      id: "client",
      permissions: 48,
    });
  });
  it("refuses a missing organization rather than omitting the database filter", async () => {
    const { ctx, request } = context(AuthMethods.OAUTH_CLIENT, clientHeaders);
    request.organizationId = null;
    await expect(guard.canActivate(ctx)).rejects.toThrow("authority is unavailable");
    expect(clients.getOAuthClientPermissionState).not.toHaveBeenCalled();
  });
  it("rejects a malformed negative permission mask", async () => {
    jest.spyOn(tokens, "getAccessTokenPermissionState").mockResolvedValue({
      expiresAt: new Date(Date.now() + 60000),
      client: { id: "client", permissions: -1 },
    });
    await expect(guard.canActivate(context().ctx)).rejects.toThrow("required permissions");
  });
});
