import { PermissionCheckService } from "@calcom/platform-libraries";
import type { EventType, Prisma } from "@calcom/prisma/client";
import { Injectable } from "@nestjs/common";
import { ApiAuthGuardUser } from "@/modules/auth/strategies/api-auth/api-auth.strategy";
import { MembershipsRepository } from "@/modules/memberships/memberships.repository";
import { MembershipsService } from "@/modules/memberships/services/memberships.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { TeamsRepository } from "@/modules/teams/teams/teams.repository";
import { EventTypesRepository_2024_06_14 } from "@/platform/event-types/event-types_2024_06_14/event-types.repository";

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
    client: Pick<Prisma.TransactionClient, "eventType" | "user" | "membership" | "team"> = this.dbWrite
      .prisma,
    permission: "eventType.read" | "eventType.delete" = "eventType.read"
  ): Promise<boolean> {
    if (!Number.isSafeInteger(user.id) || user.id <= 0) return false;
    const actor = await client.user.findUnique({ where: { id: user.id }, select: { locked: true } });
    if (!actor || actor.locked !== false) return false;
    if (!Number.isSafeInteger(eventTypeId) || eventTypeId <= 0) return false;
    const event = await client.eventType.findUnique({
      where: { id: eventTypeId },
      select: { teamId: true, parent: { select: { teamId: true } } },
    });
    if (!event) return false;
    const resourceTeamId = event.teamId ?? event.parent?.teamId;
    if (
      user.apiKeyTeamId != null &&
      (!Number.isSafeInteger(user.apiKeyTeamId) ||
        user.apiKeyTeamId <= 0 ||
        resourceTeamId !== user.apiKeyTeamId)
    )
      return false;
    if (resourceTeamId == null) return true;
    // A retained owner or Host relation must not revive a revoked team grant.
    return new PermissionCheckService(client).checkPermission({
      userId: user.id,
      teamId: resourceTeamId,
      permission,
      fallbackRoles:
        user.apiKeyTeamId == null && permission === "eventType.read"
          ? ["MEMBER", "ADMIN", "OWNER"]
          : ["ADMIN", "OWNER"],
    });
  }

  async userIsEventTypeAdminOrOwner(authUser: ApiAuthGuardUser, eventType: EventType): Promise<boolean> {
    if (!(await this.isWithinApiKeyScope(authUser, eventType.id))) return false;
    const authUserId = authUser.id;
    const eventTypeId = eventType.id;
    const teamId = eventType.teamId;
    const eventTypeOwnerId = eventType.userId || null;

    if (authUser.isSystemAdmin && authUser.apiKeyTeamId === undefined) return true;

    if (eventTypeOwnerId === authUserId) return true;

    if (eventTypeId) {
      const isHostOrAssigned = await this.isUserHostOrAssignedToEventType(authUserId, eventTypeId);
      if (isHostOrAssigned) return true;
    }

    if (teamId) {
      const isTeamOrParentOrgAdmin = await this.isUserTeamAdminOrParentOrgAdmin(authUserId, teamId);
      if (isTeamOrParentOrgAdmin) return true;
    }

    if (eventTypeOwnerId) {
      const isOrgAdminOrOwnerOfEventOwner = await this.isUserOrgAdminOrOwnerOfEventOwner(
        authUserId,
        eventTypeOwnerId
      );
      if (isOrgAdminOrOwnerOfEventOwner) return true;
    }

    return false;
  }

  private async isUserHostOrAssignedToEventType(authUserId: number, eventTypeId: number): Promise<boolean> {
    const [isUserHost, isUserAssigned] = await Promise.all([
      this.eventTypesRepository.isUserHostOfEventType(authUserId, eventTypeId),
      this.eventTypesRepository.isUserAssignedToEventType(authUserId, eventTypeId),
    ]);
    return isUserHost || isUserAssigned;
  }

  private async isUserTeamAdminOrParentOrgAdmin(authUserId: number, teamId: number): Promise<boolean> {
    const membership = await this.membershipsRepository.getUserAdminOrOwnerTeamMembership(authUserId, teamId);
    if (membership) return true;

    const team = await this.teamsRepository.getById(teamId);
    const parentOrgId = team?.parentId ?? null;
    if (parentOrgId) {
      const isOrgAdmin = await this.membershipsRepository.isUserOrganizationAdmin(authUserId, parentOrgId);
      if (isOrgAdmin) return true;
    }

    return false;
  }

  private async isUserOrgAdminOrOwnerOfEventOwner(
    authUserId: number,
    eventTypeOwnerId: number
  ): Promise<boolean> {
    return this.membershipsService.isUserOrgAdminOrOwnerOfAnotherUser(authUserId, eventTypeOwnerId);
  }
}
