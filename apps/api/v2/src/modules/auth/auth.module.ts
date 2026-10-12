import { NextAuthSessionService } from "@/modules/auth/services/next-auth-session.service";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import { ApiKeysModule } from "@/modules/api-keys/api-keys.module";
import { ApiAuthGuard } from "@/modules/auth/guards/api-auth/api-auth.guard";
import { NextAuthGuard } from "@/modules/auth/guards/next-auth/next-auth.guard";
import { ApiAuthStrategy } from "@/modules/auth/strategies/api-auth/api-auth.strategy";
import { NextAuthStrategy } from "@/modules/auth/strategies/next-auth/next-auth.strategy";
import { DeploymentsModule } from "@/modules/deployments/deployments.module";
import { MembershipsModule } from "@/modules/memberships/memberships.module";
import { OAuthFlowService } from "@/modules/oauth-clients/services/oauth-flow.service";
import { RedisModule } from "@/modules/redis/redis.module";
import { TokensModule } from "@/modules/tokens/tokens.module";
import { UsersModule } from "@/modules/users/users.module";
import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";

@Module({
  imports: [
    PassportModule,
    PrismaModule,
    RedisModule,
    ApiKeysModule,
    UsersModule,
    MembershipsModule,
    TokensModule,
    DeploymentsModule,
  ],
  providers: [NextAuthSessionService, NextAuthGuard, NextAuthStrategy, ApiAuthGuard, ApiAuthStrategy, OAuthFlowService],
  exports: [NextAuthGuard, ApiAuthGuard],
})
export class AuthModule {}
