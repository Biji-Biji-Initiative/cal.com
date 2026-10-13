// SPDX-License-Identifier: MIT
import { hashAPIKey } from "@calcom/features/api-keys-legacy/api-keys/lib/apiKeys";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { PrismaClient } from "@calcom/prisma/client";
import { rawApiKey } from "./ApiKeyInput";
import { requireApiKeyAuthority } from "./ApiKeyLifecycle";

const denied = () => new ErrorWithCode(ErrorCode.Unauthorized, "API key is unavailable");

// Credential existence, ownership and current authority belong to one primary
// snapshot. A stale replica must not revive an old key or its former privileges.
export async function authenticateApiKey(client: PrismaClient, credential: string, prefix: string) {
  let hashedKey: string;
  try {
    hashedKey = hashAPIKey(rawApiKey(credential, prefix));
  } catch {
    throw denied();
  }
  return client.$transaction(
    async (tx) => {
      const key = await tx.apiKey.findUnique({
        where: { hashedKey },
        select: { userId: true, teamId: true, expiresAt: true },
      });
      if (
        !key ||
        (key.expiresAt !== null &&
          (!Number.isFinite(key.expiresAt.getTime()) || key.expiresAt.getTime() <= Date.now()))
      )
        throw denied();
      const organizationId = await requireApiKeyAuthority(tx, key.userId, key.teamId);
      const organization = { select: { isPlatform: true, name: true, slug: true, id: true } } as const;
      // Retain API v2's existing internal UserWithProfile contract, not a response
      // DTO. Do not load calendar credentials or expose the credential record.
      const user = await tx.user.findUnique({
        where: { id: key.userId },
        include: {
          profiles: {
            where: {
              ...(key.teamId === null ? {} : { organizationId: organizationId ?? -1 }),
              organization: {
                isOrganization: true,
                parentId: null,
                members: { some: { userId: key.userId, accepted: true } },
              },
            },
            include: { organization },
          },
          movedToProfile: { include: { organization } },
        },
      });
      if (!user || user.locked !== false) throw denied();
      if (
        user.movedToProfile &&
        !user.profiles.some((profile) => profile.id === user.movedToProfileId && profile.userId === user.id)
      ) {
        user.movedToProfile = null;
        user.movedToProfileId = null;
      }
      // A team-bound credential cannot carry the owner's instance-administration
      // capability into an otherwise authorized team request.
      const role: typeof user.role = key.teamId === null ? user.role : "USER";
      return { user: { ...user, role }, teamId: key.teamId };
    },
    { isolationLevel: "RepeatableRead", maxWait: 2000, timeout: 5000 }
  );
}
