// SPDX-License-Identifier: MIT
export type StaffLoginEnvironment = Readonly<Record<string, string | undefined>>;
type AccountContext = { account?: { provider: string; type: string } | null };
type TokenContext = AccountContext & { token: object };

export function isBridgeStaffOnly(env: StaffLoginEnvironment): boolean {
  return env.CAL_AUTHENTIK_ENABLED === "false" && env.CAL_AUTHENTIK_ONLY === "false";
}

export function isAuthentikOnly(env: StaffLoginEnvironment): boolean {
  const value = env.CAL_AUTHENTIK_ONLY;
  if (value === undefined || value === "false") return false;
  if (value !== "true") throw new Error("CAL_AUTHENTIK_ONLY must be true or false");
  if (env.CAL_AUTHENTIK_ENABLED !== "true") {
    throw new Error("Authentik-only login requires CAL_AUTHENTIK_ENABLED=true");
  }
  return true;
}

// This is a dispatch requirement, NOT token validation. The existing native
// refresh must still validate the binding, issuer, subject and current user.
export function hasAuthentikMarker(token: unknown): boolean {
  return (
    typeof token === "object" &&
    token !== null &&
    Object.hasOwn(token, "authentik") &&
    Reflect.get(token, "authentik") !== undefined
  );
}

export function selectAuthentikProvider<T extends { id: string; options?: unknown }>(providers: T[]): T[] {
  const selected = providers.filter((provider) => provider.id === "authentik");
  if (selected.length !== 1) {
    throw new Error("Authentik-only login requires exactly one native Authentik provider");
  }
  // Email providers have options without an id field. Do not narrow the entire
  // native Provider union to an OAuth-only options shape during filtering.
  const options = selected[0].options;
  if (options !== undefined && options !== null) {
    if (typeof options !== "object") throw new Error("Invalid native Authentik provider options");
    const overriddenId = Reflect.get(options, "id");
    if (overriddenId !== undefined && overriddenId !== "authentik") {
      throw new Error("Authentik-only login requires exactly one native Authentik provider");
    }
  }
  return selected;
}

export function restrictStaffSignIn<T extends AccountContext>(
  next: (context: T) => boolean | string | PromiseLike<boolean | string>
) {
  return async (context: T): Promise<boolean | string> => {
    if (context.account?.provider !== "authentik" || context.account.type !== "oauth") return false;
    return next(context);
  };
}

export function restrictStaffJwt<T extends TokenContext, Result extends object>(
  next: (context: T) => Result | PromiseLike<Result>
) {
  return async (context: T): Promise<Result> => {
    // An old native cookie must not authorize an incoming password/social login.
    if (context.account) {
      if (context.account.provider !== "authentik" || context.account.type !== "oauth") {
        throw new Error("Native Authentik sign-in required");
      }
    } else if (!hasAuthentikMarker(context.token)) {
      // Never merge the client session-update body to manufacture this marker.
      throw new Error("Native Authentik session required");
    }
    const token = await next(context);
    if (!hasAuthentikMarker(token)) throw new Error("Native Authentik session binding missing");
    return token;
  };
}

export function restrictLocalAccountRoute<Args extends unknown[]>(
  next: (...args: Args) => Response | PromiseLike<Response>,
  environment: () => StaffLoginEnvironment
) {
  return async (...args: Args): Promise<Response> => {
    const env = environment();
    if (isAuthentikOnly(env) || isBridgeStaffOnly(env)) {
      // Deny before parsing a body, inspecting an invite, writing a password,
      // bootstrapping an administrator, or delivering account-recovery mail.
      return Response.json(
        { message: "Sign in with Authentik", code: "AUTHENTIK_ONLY" },
        {
          status: 403,
          headers: { "Cache-Control": "no-store" },
        }
      );
    }
    return next(...args);
  };
}

export function restrictBridgeJwt<
  T extends TokenContext & { user?: unknown; trigger?: string },
  Result extends object,
>(next: (context: T) => Result | PromiseLike<Result>) {
  return async (context: T): Promise<Result> => {
    // Only the trusted carrier issues bridge sessions. The existing callback
    // must still refresh the signed subject against the current database user.
    if (
      context.account ||
      context.user !== undefined ||
      (context.trigger !== undefined && context.trigger !== "update") ||
      hasAuthentikMarker(context.token)
    ) {
      throw new Error("An existing bridge session is required");
    }
    const token = await next(context);
    if (hasAuthentikMarker(token)) throw new Error("Unexpected native identity binding");
    return token;
  };
}
