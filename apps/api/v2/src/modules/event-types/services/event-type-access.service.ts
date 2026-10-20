import { hasPlatformClientScope, PermissionCheckService } from "@calcom/platform-libraries";
import type { EventType, Prisma } from "@calcom/prisma/client";
import { Injectable } from "@nestjs/common";
import { ApiAuthGuardUser } from "@/modules/auth/strategies/api-auth/api-auth.strategy";
import { MembershipsRepository } from "@/modules/memberships/memberships.repository";
import { MembershipsService } from "@/modules/memberships/services/memberships.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { TeamsRepository } from "@/modules/teams/teams/teams.repository";
import { EventTypesRepository_2024_06_14 } from "@/platform/event-types/event-types_2024_06_14/event-types.repository";

type EventScopeClient = Pick<
  Prisma.TransactionClient,
  "eventType" | "user" | "membership" | "team" | "platformOAuthClient"
>;

@Injectable()
export class EventTypeAccessService {
  constructor(
    private readonly eventTypesRepository: EventTypesRepository_2024_06_14,
    private readonly membershipsRepository: MembershipsRepository,
    private readonly membershipsService: MembershipsService,
    private readonly teamsRepository: TeamsRepository,
    private readonly dbWrite: PrismaWriteService
  ) {}

  async isWithinApiKeyScope(
    user: ApiAuthGuardUser,
    eventTypeId: number,
    client: EventScopeClient = this.dbWrite.prisma,
    permission: "eventType.read" | "eventType.update" | "eventType.delete" = "eventType.read"
  ): Promise<boolean> {
    return (await this.getCurrentEventType(user, eventTypeId, client, permission)) !== null;
  }

  async userOwnsEventType(
    user: ApiAuthGuardUser,
    eventTypeId: number,
    permission: "eventType.read" | "eventType.update" = "eventType.read",
    client?: EventScopeClient
  ): Promise<boolean> {
    if (client) {
      const current = await this.getCurrentEventType(user, eventTypeId, client, permission);
      return current !== null && current.event.userId === user.id;
    }
    return this.dbWrite.prisma.$transaction(
      async (client) => {
        await client.$executeRaw`SET TRANSACTION READ ONLY`;
        return this.userOwnsEventType(user, eventTypeId, permission, client);
      },
      { isolationLevel: "RepeatableRead" }
    );
  }

  private async getCurrentEventType(
    user: ApiAuthGuardUser,
    eventTypeId: number,
    client: EventScopeClient,
    permission: "eventType.read" | "eventType.update" | "eventType.delete"
  ) {
    if (!Number.isSafeInteger(user.id) || user.id <= 0) return null;
    const actor = await client.user.findUnique({
      where: { id: user.id },
      select: { locked: true, role: true },
    });
    if (!actor || actor.locked !== false) return null;
    if (!Number.isSafeInteger(eventTypeId) || eventTypeId <= 0) return null;
    const event = await client.eventType.findUnique({
      where: { id: eventTypeId },
      select: { id: true, userId: true, teamId: true, parent: { select: { teamId: true } } },
    });
    if (!event) return null;
    const resourceTeamId = event.teamId ?? event.parent?.teamId;
    if (user.apiClientId !== undefined && !(await hasPlatformClientScope(client, user.apiClientId, event)))
      return null;

    if (
      user.apiKeyTeamId != null &&
      (!Number.isSafeInteger(user.apiKeyTeamId) ||
        user.apiKeyTeamId <= 0 ||
        resourceTeamId !== user.apiKeyTeamId)
    )
      return null;
    if (
      resourceTeamId != null &&
      !(await new PermissionCheckService(client).checkPermission({
        userId: user.id,
        teamId: resourceTeamId,
        permission,
        fallbackRoles:
          user.apiKeyTeamId == null && permission === "eventType.read"
            ? ["MEMBER", "ADMIN", "OWNER"]
            : ["ADMIN", "OWNER"],
      }))
    )
      return null;
    return { actor, event };
  }

  async userIsEventTypeAdminOrOwner(authUser: ApiAuthGuardUser, eventType: EventType): Promise<boolean> {
    return this.dbWrite.prisma.$transaction(
      async (client) => {
        await client.$executeRaw`SET TRANSACTION READ ONLY`;
        const current = await this.getCurrentEventType(authUser, eventType.id, client, "eventType.read");
        if (!current) return false;
        const authUserId = authUser.id;
        const { id: eventTypeId, teamId, userId: eventTypeOwnerId } = current.event;
        if (authUser.isSystemAdmin && authUser.apiKeyTeamId === undefined && current.actor.role === "ADMIN")
          return true;
        if (eventTypeOwnerId === authUserId) return true;
        if (await this.isUserHostOrAssignedToEventType(authUserId, eventTypeId, client)) return true;
        if (teamId && (await this.isUserTeamAdminOrParentOrgAdmin(authUserId, teamId, client))) return true;
        if (
          eventTypeOwnerId &&
          (await this.isUserOrgAdminOrOwnerOfEventOwner(authUserId, eventTypeOwnerId, client))
        )
          return true;
        return false;
      },
      { isolationLevel: "RepeatableRead" }
    );
  }

  private async isUserHostOrAssignedToEventType(
    authUserId: number,
    eventTypeId: number,
    client: EventScopeClient
  ): Promise<boolean> {
    const [isUserHost, isUserAssigned] = await Promise.all([
      this.eventTypesRepository.isUserHostOfEventType(authUserId, eventTypeId, client),
      this.eventTypesRepository.isUserAssignedToEventType(authUserId, eventTypeId, client),
    ]);
    return isUserHost || isUserAssigned;
  }

  private async isUserTeamAdminOrParentOrgAdmin(
    authUserId: number,
    teamId: number,
    client: EventScopeClient
  ): Promise<boolean> {
    const membership = await this.membershipsRepository.getUserAdminOrOwnerTeamMembership(
      authUserId,
      teamId,
      client
    );
    if (membership) return true;

    const team = await this.teamsRepository.getById(teamId, client);
    const parentOrgId = team?.parentId ?? null;
    if (parentOrgId) {
      const isOrgAdmin = await this.membershipsRepository.isUserOrganizationAdmin(
        authUserId,
        parentOrgId,
        client
      );
      if (isOrgAdmin) return true;
    }

    return false;
  }

  private async isUserOrgAdminOrOwnerOfEventOwner(
    authUserId: number,
    eventTypeOwnerId: number,
    client: EventScopeClient
  ): Promise<boolean> {
    return this.membershipsService.isUserOrgAdminOrOwnerOfAnotherUser(authUserId, eventTypeOwnerId, client);
  }
}
