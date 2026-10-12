import { NextAuthPassportStrategy } from "@/lib/passport/strategies/types";
import { NextAuthSessionService } from "@/modules/auth/services/next-auth-session.service";
import { Injectable, InternalServerErrorException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import type { Request } from "express";
import { getToken } from "next-auth/jwt";

@Injectable()
export class NextAuthStrategy extends PassportStrategy(NextAuthPassportStrategy, "next-auth") {
  constructor(private readonly sessions: NextAuthSessionService, private readonly config: ConfigService) {
    super();
  }

  async authenticate(req: Request) {
    try {
      const nextAuthSecret = this.config.get("next.authSecret", { infer: true });
      if (typeof nextAuthSecret !== "string" || nextAuthSecret.length === 0) {
        throw new UnauthorizedException("Native session authentication is unavailable");
      }
      const payload = await getToken({ req, secret: nextAuthSecret });

      if (!payload) {
        throw new UnauthorizedException("NextAuthStrategy - Authentication token is missing or invalid.");
      }

      const { user } = await this.sessions.resolve(payload);

      return this.success(user);
    } catch (error) {
      if (error instanceof Error) return this.error(error);
      return this.error(
        new InternalServerErrorException(
          "NextAuthStrategy - An error occurred while authenticating the request"
        )
      );
    }
  }
}
