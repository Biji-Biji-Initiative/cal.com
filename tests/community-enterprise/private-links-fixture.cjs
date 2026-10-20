// SPDX-License-Identifier: MIT
// Actual native private-link controller, guard, services, repository and helpers.
const path = require("node:path");
const nest = require("@nestjs/common");
const { compile } = require("./booking-listing-fixture.cjs");
const { sourceModules } = require("./tasker-fixture.cjs");

function privateLinksFixture({ load, tokens, db, root, eventAccess }) {
  const api = "apps/api/v2/src/";
  const base = `${api}platform/event-types-private-links/`;
  const types = load(path.join(root, "packages/platform/types/index.ts"));
  const source = sourceModules(db).load;
  const helpers = {
    ...source("packages/lib/generateHashedLink.ts"),
    ...compile("packages/lib/hashedLinksUtils.ts", {
      "@calcom/dayjs": source("packages/dayjs/index.ts"),
      "@calcom/lib/errorCodes": source("packages/lib/errorCodes.ts"),
    }),
  };
  const common = { "@nestjs/common": nest, "@calcom/platform-types": types };
  const { PrivateLinksRepository } = compile(`${base}private-links.repository.ts`, {
    ...common,
    "@/modules/prisma/prisma-read.service": { PrismaReadService: tokens.PrismaReadService },
    "@/modules/prisma/prisma-write.service": { PrismaWriteService: tokens.PrismaWriteService },
  });
  const repo = new PrivateLinksRepository({ prisma: db }, { prisma: db });
  const { PrivateLinksInputService } = compile(`${base}services/private-links-input.service.ts`, common);
  const { PrivateLinksOutputService } = compile(`${base}services/private-links-output.service.ts`, {
    ...common,
    "class-transformer": require("class-transformer"),
  });
  const { PrivateLinksService } = compile(`${base}services/private-links.service.ts`, {
    ...common,
    "@/platform/event-types-private-links/private-links.repository": { PrivateLinksRepository },
    "@/platform/event-types-private-links/services/private-links-input.service": { PrivateLinksInputService },
    "@/platform/event-types-private-links/services/private-links-output.service": {
      PrivateLinksOutputService,
    },
    "@calcom/platform-libraries/private-links": helpers,
  });
  const service = new PrivateLinksService(
    new PrivateLinksInputService(),
    new PrivateLinksOutputService(),
    repo
  );
  const { EventTypeOwnershipGuard } = compile(
    `${api}modules/event-types/guards/event-type-ownership.guard.ts`,
    {
      ...common,
      "@/platform/event-types/event-types_2024_06_14/services/event-types.service": {
        EventTypesService_2024_06_14: eventAccess.service.constructor,
      },
      "@/modules/event-types/services/event-type-access.service": {
        EventTypeAccessService: eventAccess.access.constructor,
      },
    }
  );
  const { ApiAuthGuard } = load(path.join(root, api, "modules/auth/guards/api-auth/api-auth.guard.ts"));
  const { PermissionsGuard } = load(
    path.join(root, api, "modules/auth/guards/permissions/permissions.guard.ts")
  );
  const { Permissions } = load(
    path.join(root, api, "modules/auth/decorators/permissions/permissions.decorator.ts")
  );
  const { GetUser } = load(path.join(root, api, "modules/auth/decorators/get-user/get-user.decorator.ts"));
  const { EventTypesPrivateLinksController } = compile(
    `${base}controllers/event-types-private-links.controller.ts`,
    {
      ...common,
      "@nestjs/swagger": require("@nestjs/swagger"),
      "@calcom/platform-constants": {
        ...load(path.join(root, "packages/platform/constants/api.ts")),
        ...load(path.join(root, "packages/platform/constants/permissions.ts")),
      },
      "../services/private-links.service": { PrivateLinksService },
      "@/lib/docs/headers": { API_KEY_OR_ACCESS_TOKEN_HEADER: {} },
      "@/modules/auth/decorators/get-user/get-user.decorator": { GetUser },
      "@/modules/auth/decorators/permissions/permissions.decorator": { Permissions },
      "@/modules/auth/guards/api-auth/api-auth.guard": { ApiAuthGuard },
      "@/modules/auth/guards/permissions/permissions.guard": { PermissionsGuard },
      "@/modules/event-types/guards/event-type-ownership.guard": { EventTypeOwnershipGuard },
    }
  );
  return {
    Controller: EventTypesPrivateLinksController,
    providers: [
      EventTypeOwnershipGuard,
      { provide: PrivateLinksService, useValue: service },
      { provide: eventAccess.service.constructor, useValue: eventAccess.service },
      { provide: eventAccess.access.constructor, useValue: eventAccess.access },
    ],
  };
}
module.exports = { privateLinksFixture };
