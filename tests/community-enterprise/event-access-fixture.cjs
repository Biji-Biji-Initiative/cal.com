// SPDX-License-Identifier: MIT
// Native event authorization, owner-only deletion and repository bodies.
const path = require("node:path");
const nest = require("@nestjs/common");
const { compile } = require("./booking-listing-fixture.cjs");

function eventAccessFixture({ native, load, db, root }) {
  const base = "apps/api/v2/src/";
  const events = `${base}platform/event-types/event-types_2024_06_14/`;
  const Repository = native(`${events}event-types.repository.ts`, "EventTypesRepository_2024_06_14", [
    "usersInclude",
    "getEventTypeById",
    "getUserEventType",
    "deleteEventType",
    "isUserHostOfEventType",
    "isUserAssignedToEventType",
  ]);
  const repository = Object.assign(new Repository(), { dbRead: { prisma: db }, dbWrite: { prisma: db } });
  const Membership = native(`${base}modules/memberships/memberships.repository.ts`, "MembershipsRepository", [
    "getUserAdminOrOwnerTeamMembership",
    "isUserOrganizationAdmin",
    "getOrgIdsWhereUserIsAdminOrOwner",
    "getUserMembershipInOneOfOrgs",
    "getUserMembershipInOneOfOrgsTeams",
  ]);
  const membership = Object.assign(new Membership(), { dbRead: { prisma: db } });
  const MembershipService = native(
    `${base}modules/memberships/services/memberships.service.ts`,
    "MembershipsService",
    ["isUserOrgAdminOrOwnerOfAnotherUser"]
  );
  const membershipService = Object.assign(new MembershipService(), { membershipsRepository: membership });
  const Teams = native(`${base}modules/teams/teams/teams.repository.ts`, "TeamsRepository", ["getById"]);
  const teams = Object.assign(new Teams(), { dbRead: { prisma: db } });
  const { PermissionCheckService, hasPlatformClientScope } = load(
    path.join(root, "packages/features/community-enterprise/authorization/PermissionCheckService.ts")
  );
  const { EventTypeAccessService } = compile(
    `${base}modules/event-types/services/event-type-access.service.ts`,
    {
      "@/platform/event-types/event-types_2024_06_14/event-types.repository": {
        EventTypesRepository_2024_06_14: Repository,
      },
      "@/modules/memberships/memberships.repository": { MembershipsRepository: Membership },
      "@/modules/memberships/services/memberships.service": { MembershipsService: MembershipService },
      "@/modules/teams/teams/teams.repository": { TeamsRepository: Teams },
      "@/modules/prisma/prisma-write.service": { PrismaWriteService: class {} },
      "@nestjs/common": nest,
      "@calcom/platform-libraries": { PermissionCheckService, hasPlatformClientScope },
    }
  );
  const access = new EventTypeAccessService(repository, membership, membershipService, teams, { prisma: db });
  const Service = native(
    `${events}services/event-types.service.ts`,
    "EventTypesService_2024_06_14",
    ["deleteEventType", "checkUserOwnsEventType", "getUserEventType"],
    nest
  );
  const service = Object.assign(new Service(), {
    eventTypesRepository: repository,
    eventTypeAccessService: access,
    dbWrite: { prisma: db },
  });
  const { ApiAuthGuard } = load(path.join(root, base, "modules/auth/guards/api-auth/api-auth.guard.ts"));
  const { PermissionsGuard } = load(
    path.join(root, base, "modules/auth/guards/permissions/permissions.guard.ts")
  );
  const { Permissions } = load(
    path.join(root, base, "modules/auth/decorators/permissions/permissions.decorator.ts")
  );
  const { GetUser } = load(path.join(root, base, "modules/auth/decorators/get-user/get-user.decorator.ts"));
  const Controller = native(
    `${events}controllers/event-types.controller.ts`,
    "EventTypesController_2024_06_14",
    ["deleteEventType"],
    {
      ...nest,
      ...require("@nestjs/swagger"),
      ApiAuthGuard,
      PermissionsGuard,
      Permissions,
      GetUser,
      EVENT_TYPE_WRITE: load(path.join(root, "packages/platform/constants/permissions.ts")).EVENT_TYPE_WRITE,
      API_KEY_OR_ACCESS_TOKEN_HEADER: {},
      SUCCESS_STATUS: "success",
    }
  );
  nest.Controller("v2/event-types")(Controller);
  Controller.prototype.eventTypesService = service;
  return { access, service, Controller, readers: [repository, membership, teams] };
}
module.exports = { eventAccessFixture };
