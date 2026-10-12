import process from "node:process";
import { readAuthentikConfig } from "@calcom/features/community-enterprise/identity/AuthentikConfig";
import { refreshAuthentikToken } from "@calcom/features/community-enterprise/identity/AuthentikIdentity";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import { WEBAPP_URL } from "@calcom/lib/constants";
import { getUserAvatarUrl } from "@calcom/lib/getAvatarUrl";
import logger from "@calcom/lib/logger";
import prisma from "@calcom/prisma";
import type { GetServerSidePropsContext, NextApiRequest } from "next";
import type { AuthOptions, Session } from "next-auth";
import { getToken } from "next-auth/jwt";

class LicenseKeySingleton {
  static async getInstance(..._args: unknown[]) {
    return new LicenseKeySingleton();
  }
  async checkLicense() {
    return true;
  }
  async validateLicenseKey() {
    return true;
  }
}
class DeploymentRepository {
  constructor(_prisma?: unknown) {}
  async findFirst(..._args: unknown[]) {
    return null;
  }
}

const log = logger.getSubLogger({ prefix: ["getServerSession"] });
/**
 * This is a slimmed down version of the `getServerSession` function from
 * `next-auth`.
 *
 * Instead of requiring the entire options object for NextAuth, we create
 * a compatible session using information from the incoming token.
 *
 * The downside to this is that we won't refresh sessions if the users
 * token has expired (30 days). This should be fine as we call `/auth/session`
 * frequently enough on the client-side to keep the session alive.
 */
export async function getServerSession(options: {
  req: NextApiRequest | GetServerSidePropsContext["req"];
  authOptions?: AuthOptions;
}) {
  const { req, authOptions: { secret } = {} } = options;

  let token = await getToken({
    req,
    secret,
  });

  if (process.env.CAL_AUTHENTIK_ONLY !== undefined) {
    const { hasAuthentikMarker, isAuthentikOnly } = await import(
      "@calcom/features/community-enterprise/identity/StaffLoginPolicy"
    );
    if (isAuthentikOnly(process.env) && !hasAuthentikMarker(token)) return null;
  }

  if (token?.authentik !== undefined) {
    try {
      token = await refreshAuthentikToken(prisma, readAuthentikConfig(process.env), { token }, WEBAPP_URL);
    } catch {
      return null;
    }
  }

  if (!token || !token.email || !token.sub) {
    log.debug("Couldn't get token");
    return null;
  }

  const userId = token.sub ? Number(token.sub) : null;

  if (!userId || userId <= 0) {
    log.warn("Invalid or missing user ID in token", { sub: token.sub });
    return null;
  }

  const userFromDb = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!userFromDb || userFromDb.locked) {
    log.warn("No user found for valid token", { userId });
    return null;
  }

  const deploymentRepo = new DeploymentRepository(prisma);
  const licenseKeyService = await LicenseKeySingleton.getInstance(deploymentRepo);
  const hasValidLicense = await licenseKeyService.checkLicense();

  let upId = token.upId;

  if (!upId) {
    upId = `usr-${userFromDb.id}`;
  }

  if (!upId) {
    log.error("No upId found for session", { userId: userFromDb.id });
    return null;
  }

  const userRepository = new UserRepository(prisma);
  const user = await userRepository.enrichUserWithTheProfile({
    user: userFromDb,
    upId,
  });

  const session: Session = {
    hasValidLicense,
    expires: new Date(typeof token.exp === "number" ? token.exp * 1000 : Date.now()).toISOString(),
    user: {
      id: user.id,
      uuid: user.uuid,
      name: user.name,
      username: user.username,
      email: user.email,
      emailVerified: user.emailVerified,
      email_verified: user.emailVerified !== null,
      completedOnboarding: user.completedOnboarding,
      role: user.role,
      image: getUserAvatarUrl({
        avatarUrl: user.avatarUrl,
      }),
      belongsToActiveTeam: token.belongsToActiveTeam,
      org: token.org,
      orgAwareUsername: token.orgAwareUsername,
      locale: user.locale ?? undefined,
      profile: user.profile,
    },
    profileId: token.profileId,
    upId,
  };

  if (token?.impersonatedBy?.id) {
    const impersonatedByUser = await prisma.user.findUnique({
      where: {
        id: token.impersonatedBy.id,
      },
      select: {
        id: true,
        uuid: true,
        role: true,
      },
    });
    if (impersonatedByUser) {
      session.user.impersonatedBy = {
        id: impersonatedByUser?.id,
        uuid: impersonatedByUser.uuid,
        role: impersonatedByUser.role,
      };
    }
  }

  log.debug("Returned session", { userId: session.user.id });
  return session;
}
