import { AuthMethods } from "@/lib/enums/auth-methods";
import { parseBearerHeader } from "@/modules/auth/services/credential-policy";
import type { CreateApiKeyInput } from "@/modules/api-keys/inputs/create-api-key.input";
import type { RefreshApiKeyInput } from "@/modules/api-keys/inputs/refresh-api-key.input";
import type { ApiAuthGuardRequest } from "@/modules/auth/strategies/api-auth/api-auth.strategy";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createApiKey, rotateApiKey } from "@calcom/platform-libraries";

@Injectable()
export class ApiKeysService {
  constructor(private readonly database: PrismaWriteService, private readonly config: ConfigService) {}

  async getRequestApiKey(request: ApiAuthGuardRequest) {
    if (request.authMethod !== AuthMethods.API_KEY) throw new UnauthorizedException("An API key is required");
    try {
      const key = parseBearerHeader(request.get("Authorization"));
      if (key) return key;
    } catch { /* A malformed credential is never replaced with a session cookie. */ }
    throw new UnauthorizedException("An API key is required");
  }

  private lifetime(input: RefreshApiKeyInput) {
    const days = input.apiKeyDaysValid;
    if ((days !== undefined && (!Number.isSafeInteger(days) || days < 1)) ||
        (input.apiKeyNeverExpires !== undefined && typeof input.apiKeyNeverExpires !== "boolean") ||
        (days !== undefined && input.apiKeyNeverExpires === true)) {
      throw new BadRequestException("Choose a positive whole number of days or an explicit non-expiring key");
    }
    const expiresAt = new Date(Date.now() + (days ?? 30) * 86400000);
    if (!Number.isFinite(expiresAt.getTime())) throw new BadRequestException("Invalid API key lifetime");
    return { neverExpires: input.apiKeyNeverExpires === true, expiresAt };
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (typeof error === "object" && error !== null && "code" in error) {
        if (error.code === "forbidden_error") throw new ForbiddenException("API key operation is not permitted");
        if (error.code === "bad_request_error") throw new BadRequestException("Invalid API key input");
      }
      throw error;
    }
  }

  async createApiKey(authUserId: number, input: CreateApiKeyInput) {
    const lifetime = this.lifetime(input);
    return this.execute(() => createApiKey(this.database.prisma, authUserId, {
      ...lifetime, note: input.note, teamId: input.teamId,
    }, this.config.get<string>("api.keyPrefix") ?? "cal_"));
  }

  async refreshApiKey(authUserId: number, key: string, input: RefreshApiKeyInput) {
    const lifetime = this.lifetime(input);
    return this.execute(() => rotateApiKey(this.database.prisma, authUserId, key, lifetime,
      this.config.get<string>("api.keyPrefix") ?? "cal_"));
  }
}
