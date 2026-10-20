// SPDX-License-Identifier: MIT

import type { PrismaClient } from "@calcom/prisma";
import prisma from "@calcom/prisma";
import { PermissionPolicy } from "./PermissionPolicy";

export type PermissionString = string;
export type PermissionChecker = Pick<
  PermissionPolicy,
  "checkPermission" | "hasPermission" | "getTeamIdsWithPermission"
>;

// Accept a transaction client as well as the shared Prisma client so callers
// can bind authorization and a protected mutation to the same transaction.
export class PermissionCheckService extends PermissionPolicy {
  constructor(client: Pick<PrismaClient, "user" | "membership" | "team"> = prisma) {
    super({
      async snapshot(userId) {
        const [user, memberships] = await Promise.all([
          client.user.findUnique({ where: { id: userId }, select: { id: true, locked: true } }),
          client.membership.findMany({
            where: { userId },
            select: {
              userId: true,
              teamId: true,
              accepted: true,
              role: true,
              customRoleId: true,
              customRole: {
                select: {
                  id: true,
                  teamId: true,
                  permissions: { select: { resource: true, action: true } },
                },
              },
            },
          }),
        ]);
        return { user, memberships };
      },
      async teams(ids) {
        return client.team.findMany({
          where: { id: { in: [...ids] } },
          select: { id: true, parentId: true, isOrganization: true },
        });
      },
      async children(parentIds) {
        return client.team.findMany({
          where: { parentId: { in: [...parentIds] } },
          select: { id: true, parentId: true, isOrganization: true },
        });
      },
    });
  }
}

export async function hasPlatformClientScope(
  client: Pick<PrismaClient, "platformOAuthClient">,
  clientId: string,
  resource: { userId: number | null; teamId: number | null; parent?: { teamId: number | null } | null }
): Promise<boolean> {
  if (typeof clientId !== "string" || !clientId) return false;
  const resourceTeamId = resource.teamId ?? resource.parent?.teamId;
  const scopedClient = await client.platformOAuthClient.findFirst({
    where: {
      id: clientId,
      organization: {
        isOrganization: true,
        parentId: null,
        ...(resourceTeamId == null
          ? {}
          : {
              OR: [{ id: resourceTeamId }, { children: { some: { id: resourceTeamId } } }],
            }),
      },
      ...(resourceTeamId == null ? { users: { some: { id: resource.userId ?? -1 } } } : {}),
    },
    select: { id: true },
  });
  return scopedClient !== null;
}
