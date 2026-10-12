// SPDX-License-Identifier: MIT
import process from "node:process";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { UsersService } from "@/modules/users/services/users.service";
import type { UserWithProfile } from "@/modules/users/users.repository";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { JWT } from "next-auth/jwt";
import {
  hasAuthentikMarker,
  isAuthentikOnly,
  readAuthentikSessionConfig,
  refreshAuthentikToken,
} from "@calcom/platform-libraries";
import { sessionUserId } from "./credential-policy";

@Injectable()
export class NextAuthSessionService {
  constructor(
    private readonly database: PrismaWriteService,
    private readonly config: ConfigService,
    private readonly users: UsersService
  ) {}

  // Only pass tokens verified/decrypted by NextAuth. This does not decode a JWT
  // or convert an Authentik access token into a Cal session.
  async resolve(token: JWT): Promise<{ user: UserWithProfile; organizationId: number | null }> {
    let id: number;
    try {
      id = sessionUserId(token);
      if (isAuthentikOnly(process.env) && !hasAuthentikMarker(token)) {
        throw new Error("Native session required");
      }
    } catch {
      throw new UnauthorizedException("Invalid staff session");
    }
    // A lagging read replica must not revive a disabled account or revoked link.
    return this.database.prisma.$transaction(async (tx) => {
      let current = token;
      const native = hasAuthentikMarker(token);
      if (native) {
        try {
          current = await refreshAuthentikToken(
            tx,
            readAuthentikSessionConfig(process.env),
            { token },
            this.config.get<string>("app.baseUrl") ?? ""
          );
        } catch {
          throw new UnauthorizedException("Invalid staff session");
        }
      }
      if (sessionUserId(current) !== id) throw new UnauthorizedException("Invalid staff session");
      // Preserve the existing internal UserWithProfile shape used by API v2;
      // this record is not a response DTO. Relations are limited to live grants.
      const organization = { select: { isPlatform: true, name: true, slug: true, id: true } } as const;
      const user = await tx.user.findUnique({
        where: { id },
        include: {
          movedToProfile: { include: { organization } },
          profiles: {
            where: {
              organization: {
                isOrganization: true,
                parentId: null,
                members: { some: { userId: id, accepted: true } },
              },
            },
            include: { organization },
          },
        },
      });
      if (!user || user.id !== id || user.locked !== false) {
        throw new UnauthorizedException("Invalid staff session");
      }
      const allowed = new Set(user.profiles.map((profile) => profile.id));
      if (user.movedToProfile && (user.movedToProfile.userId !== id || !allowed.has(user.movedToProfile.id))) {
        user.movedToProfile = null;
        user.movedToProfileId = null;
      }
      const organizationId = native ? current.org?.id ?? null : this.users.getUserMainOrgId(user) ?? null;
      if (organizationId !== null && !user.profiles.some((profile) => profile.organizationId === organizationId)) {
        throw new UnauthorizedException("Invalid staff organization");
      }
      return { user, organizationId };
    }, { isolationLevel: "RepeatableRead", maxWait: 2000, timeout: 5000 });
  }
}
