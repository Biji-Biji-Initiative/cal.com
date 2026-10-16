import { X_CAL_CLIENT_ID, X_CAL_SECRET_KEY } from "@calcom/platform-constants";
import { hasPermissions } from "@calcom/platform-utils";
import type { PlatformOAuthClient } from "@calcom/prisma/client";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthMethods } from "@/lib/enums/auth-methods";
import { Permissions } from "@/modules/auth/decorators/permissions/permissions.decorator";
import { clientSecretsMatch } from "@/modules/auth/services/client-secret";
import { parseBearerHeader } from "@/modules/auth/services/credential-policy";
import type { ApiAuthGuardRequest } from "@/modules/auth/strategies/api-auth/api-auth.strategy";
import { OAuthClientRepository } from "@/modules/oauth-clients/oauth-client.repository";
import { TokensRepository } from "@/modules/tokens/tokens.repository";

const unavailable = () => new ForbiddenException("OAuth permission authority is unavailable");
type ClientPermissions = Pick<PlatformOAuthClient, "id" | "permissions">;

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokensRepository: TokensRepository,
    private readonly oAuthClientRepository: OAuthClientRepository
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride(Permissions, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredPermissions?.length) return true;

    const request = context.switchToHttp().getRequest<ApiAuthGuardRequest>();
    const userId = request.user?.id;
    if (!Number.isSafeInteger(userId) || userId <= 0 || request.user?.locked !== false) {
      throw unavailable();
    }

    // Passport has already chosen and verified one method. Reinterpreting an
    // ambient cookie or secondary header here would change that authority.
    if (
      [AuthMethods.NEXT_AUTH, AuthMethods.API_KEY, AuthMethods.THIRD_PARTY_ACCESS_TOKEN].includes(
        request.authMethod
      )
    ) {
      // These established user credentials do not use platform-client bits.
      // Their existing resource/membership and third-party scope checks remain.
      return true;
    }

    let client: ClientPermissions;
    if (request.authMethod === AuthMethods.ACCESS_TOKEN) {
      let token: string | undefined;
      try {
        token = parseBearerHeader(request.get("Authorization"));
      } catch {
        throw unavailable();
      }
      if (!token) throw unavailable();
      client = await this.getOAuthClientByAccessToken(token, userId);
    } else if (request.authMethod === AuthMethods.OAUTH_CLIENT) {
      const id = request.params?.clientId || request.get(X_CAL_CLIENT_ID);
      const suppliedSecret = request.get(X_CAL_SECRET_KEY);
      if (
        !id ||
        !suppliedSecret ||
        !Number.isSafeInteger(request.organizationId) ||
        !request.organizationId
      ) {
        throw unavailable();
      }
      client = await this.getOAuthClientById(id, userId, request.organizationId, suppliedSecret);
    } else {
      // A direct guard call, wrong ordering or new unreviewed credential type
      // cannot convert a permission decorator into unconditional acceptance.
      throw unavailable();
    }

    if (
      !Number.isSafeInteger(client.permissions) ||
      client.permissions < 0 ||
      !hasPermissions(client.permissions, [...requiredPermissions])
    ) {
      throw new ForbiddenException("OAuth client does not have the required permissions");
    }
    return true;
  }

  async getOAuthClientByAccessToken(accessToken: string, userId: number): Promise<ClientPermissions> {
    if (!accessToken || !Number.isSafeInteger(userId) || userId <= 0) throw unavailable();
    const authority = await this.tokensRepository.getAccessTokenPermissionState(accessToken, userId);
    if (
      !authority ||
      !(authority.expiresAt instanceof Date) ||
      !Number.isFinite(authority.expiresAt.getTime()) ||
      authority.expiresAt.getTime() <= Date.now()
    ) {
      throw unavailable();
    }
    return authority.client;
  }

  async getOAuthClientById(
    id: string,
    userId: number,
    organizationId: number,
    suppliedSecret: string
  ): Promise<ClientPermissions> {
    if (
      !id ||
      !Number.isSafeInteger(userId) ||
      userId <= 0 ||
      !Number.isSafeInteger(organizationId) ||
      organizationId <= 0 ||
      !suppliedSecret
    )
      throw unavailable();
    const client = await this.oAuthClientRepository.getOAuthClientPermissionState(id, userId, organizationId);
    if (!client || !clientSecretsMatch(client.secret, suppliedSecret)) throw unavailable();
    // The current secret is needed only for a rotation check, never returned.
    return { id: client.id, permissions: client.permissions };
  }
}
