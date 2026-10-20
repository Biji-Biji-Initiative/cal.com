// SPDX-License-Identifier: MIT
// Targeted native Nest/Passport fixture, not the full application bootstrap.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const ts = require("typescript");
require("reflect-metadata");
const { Test } = require("@nestjs/testing");
const { ConfigService } = require("@nestjs/config");
const { Controller, Get, Req, UseGuards } = require("@nestjs/common");
const { PassportModule } = require("@nestjs/passport");
const cookieParser = require("cookie-parser");
const root = path.resolve(__dirname, "../..");

function fixtureModules(state, options = {}) {
  const cache = new Map();
  // Managed-token admission intentionally simulates a stale cache; the actual
  // permission repositories must still refuse revoked or diminished authority.
  class PrismaWriteService {}
  class PrismaReadService {}
  class JwtService {}
  class UsersService {
    getUserMainOrgId(user) {
      return user.movedToProfile?.organizationId ?? user.profiles?.[0]?.organizationId ?? null;
    }
  }
  class UsersRepository {
    async findByIdWithProfile() {
      state.replicaReads++;
      return state.permissionFixture ? state.permissionUser : state.staleUser;
    }
  }
  class OAuthFlowService {
    async validateAccessToken() {
      return state.permissionFixture === true;
    }
  }
  class TokensRepository {}
  class SchedulesAtomsService {
    async getSchedule() {
      state.atomCalls = (state.atomCalls || 0) + 1;
      return { id: 91, fixture: true };
    }
    async updateUserSchedule() {
      return this.getSchedule();
    }
  }
  class PrivateLinksService {
    async getPrivateLinks() {
      state.privateLinkCalls = (state.privateLinkCalls || 0) + 1;
      return [];
    }
    async createPrivateLink() {
      return this.getPrivateLinks();
    }
  }
  class EventTypeOwnershipGuard {
    canActivate(context) {
      state.ownershipChecks = (state.ownershipChecks || 0) + 1;
      return context.switchToHttp().getRequest().user?.id === 1 && state.privateLinksAllowed !== false;
    }
  }
  class TokensService {
    getDecodedThirdPartyAccessToken() {
      return null;
    }
  }
  class OAuthClientRepository {}
  class MembershipsRepository {
    async findPlatformOwnerUserId() {
      return state.permissionFixture ? 1 : undefined;
    }
    async findPlatformAdminUserId() {
      return undefined;
    }
  }
  const tokens = {
    PrismaWriteService,
    PrismaReadService,
    JwtService,
    UsersService,
    UsersRepository,
    OAuthFlowService,
    TokensRepository,
    TokensService,
    OAuthClientRepository,
    MembershipsRepository,
    SchedulesAtomsService,
    PrivateLinksService,
    EventTypeOwnershipGuard,
  };
  /** @type {[string, object][]} */
  const moduleEntries = [
    ["../services/private-links.service", { PrivateLinksService }],
    ["@/modules/event-types/guards/event-type-ownership.guard", { EventTypeOwnershipGuard }],
    ["../services/schedules-atom.service", { SchedulesAtomsService }],
    ["@/modules/atoms/services/schedules-atom.service", { SchedulesAtomsService }],
    [
      "@calcom/platform-libraries/schedules",
      { getAvailabilityListHandler() {}, duplicateScheduleHandler() {}, createScheduleHandler() {} },
    ],
    ["@/modules/prisma/prisma-write.service", { PrismaWriteService }],
    ["@/modules/prisma/prisma-read.service", { PrismaReadService }],
    ["@/modules/jwt/jwt.service", { JwtService }],
    ["@/modules/users/services/users.service", { UsersService }],
    ["@/modules/users/users.repository", { UsersRepository }],
    ["@/modules/oauth-clients/services/oauth-flow.service", { OAuthFlowService }],
    ["@/modules/tokens/tokens.repository", { TokensRepository }],
    ["@/modules/tokens/tokens.service", { TokensService }],
    ["@/modules/oauth-clients/oauth-client.repository", { OAuthClientRepository }],
    ["@/modules/memberships/memberships.repository", { MembershipsRepository }],
    [
      "@/lib/is-origin-allowed/is-origin-allowed",
      {
        isOriginAllowed: () => {
          throw new Error("Unexercised OAuth-origin path");
        },
      },
    ],
  ];
  const substitutions = new Map(moduleEntries);
  if (state.permissionFixture) {
    for (const entry of [
      "tokens/tokens.repository",
      "tokens/tokens.service",
      "oauth-clients/oauth-client.repository",
    ]) {
      substitutions.delete(`@/modules/${entry}`);
    }
  }
  function load(filename) {
    const file = [filename, `${filename}.ts`, `${filename}.tsx`, path.join(filename, "index.ts")].find(
      (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    );
    assert.ok(file, `Missing source ${filename}`);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const nativeRequire = createRequire(file);
    const result = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
    });
    assert.deepEqual(result.diagnostics, []);
    new Function("require", "module", "exports", "__filename", "__dirname", result.outputText)(
      (name) => {
        if (substitutions.has(name)) return substitutions.get(name);
        if (name === "@calcom/platform-constants")
          return Object.assign(
            {},
            ...["api.ts", "permissions.ts"].map((entry) =>
              load(path.join(root, "packages/platform/constants", entry))
            )
          );
        if (name === "@calcom/platform-utils")
          return load(path.join(root, "packages/platform/utils/permissions.ts"));
        if (name === "@calcom/platform-types")
          return load(path.join(root, "packages/platform/types/index.ts"));
        if (name === "@calcom/platform-enums")
          return load(path.join(root, "packages/platform/enums/index.ts"));
        if (name === "@calcom/prisma") return { __esModule: true, default: state.primary.prisma };
        if (name === "@calcom/platform-libraries") {
          return Object.assign(
            {},
            options.platformLibraries,
            ...[
              "identity/AuthentikConfig",
              "identity/AuthentikIdentity",
              "identity/StaffLoginPolicy",
              "api-keys/ApiKeyAuthentication",
              "api-keys/ApiKeyLifecycle",
            ].map((entry) => load(path.join(root, "packages/features/community-enterprise", entry)))
          );
        }
        if (name.startsWith("@/")) return load(path.join(root, "apps/api/v2/src", name.slice(2)));
        if (name.startsWith("@calcom/")) return load(path.join(root, "packages", name.slice(8)));
        if (name.startsWith(".")) return load(path.resolve(path.dirname(file), name));
        return nativeRequire(name);
      },
      module,
      module.exports,
      file,
      path.dirname(file)
    );
    return module.exports;
  }
  if (state.permissionFixture) {
    tokens.TokensRepository = load(
      path.join(root, "apps/api/v2/src/modules/tokens/tokens.repository.ts")
    ).TokensRepository;
    tokens.TokensService = load(
      path.join(root, "apps/api/v2/src/modules/tokens/tokens.service.ts")
    ).TokensService;
    tokens.OAuthClientRepository = load(
      path.join(root, "apps/api/v2/src/modules/oauth-clients/oauth-client.repository.ts")
    ).OAuthClientRepository;
  }
  return { load, tokens };
}

async function createApiRuntime(state, options = {}) {
  const { load, tokens } = fixtureModules(state, options);
  const auth = "apps/api/v2/src/modules/auth/";
  const { NextAuthSessionService } = load(path.join(root, auth, "services/next-auth-session.service.ts"));
  const { ApiAuthStrategy } = load(path.join(root, auth, "strategies/api-auth/api-auth.strategy.ts"));
  const { NextAuthStrategy } = load(path.join(root, auth, "strategies/next-auth/next-auth.strategy.ts"));
  const { ApiAuthGuard } = load(path.join(root, auth, "guards/api-auth/api-auth.guard.ts"));
  const { NextAuthGuard } = load(path.join(root, auth, "guards/next-auth/next-auth.guard.ts"));
  const { ApiAuthGuardOnlyAllow } = load(
    path.join(root, auth, "decorators/api-auth-guard-only-allow.decorator.ts")
  );
  class FixtureController {
    native(req) {
      return this.describe(req);
    }
    cookie(req) {
      return this.describe(req);
    }
    key(req) {
      return this.describe(req);
    }
    access(req) {
      return this.describe(req);
    }
    any(req) {
      return this.describe(req);
    }
    describe(req) {
      return {
        id: req.user.id,
        role: req.user.role,
        isSystemAdmin: req.user.isSystemAdmin,
        organizationId: req.organizationId ?? null,
        profileOrganizations: req.user.profiles?.map((profile) => profile.organizationId) ?? [],
      };
    }
  }
  Controller("fixture")(FixtureController);
  for (const [name, method] of [
    ["native", null],
    ["cookie", "NEXT_AUTH"],
    ["key", "API_KEY"],
    ["access", "ACCESS_TOKEN"],
    ["any", undefined],
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(FixtureController.prototype, name);
    Req()(FixtureController.prototype, name, 0);
    Get(name)(FixtureController.prototype, name, descriptor);
    UseGuards(method === null ? NextAuthGuard : ApiAuthGuard)(FixtureController.prototype, name, descriptor);
    if (method) ApiAuthGuardOnlyAllow([method])(FixtureController.prototype, name, descriptor);
  }
  /** @type {import("@nestjs/common").Type<object>[]} */
  const controllers = [FixtureController];
  const extraProviders = [];
  if (state.permissionFixture) {
    const { PermissionsGuard } = load(path.join(root, auth, "guards/permissions/permissions.guard.ts"));
    const { Permissions } = load(path.join(root, auth, "decorators/permissions/permissions.decorator.ts"));
    const { SCHEDULE_READ, SCHEDULE_WRITE } = load(
      path.join(root, "packages/platform/constants/permissions.ts")
    );
    extraProviders.push(
      PermissionsGuard,
      load(
        path.join(
          root,
          "apps/api/v2/src/modules/oauth-clients/services/oauth-clients/oauth-clients-output.service.ts"
        )
      ).OAuthClientsOutputService
    );
    class PermissionController {
      guest() {
        return { permitted: true };
      }
      read(req) {
        return { id: req.user.id, method: req.authMethod };
      }
      write(req) {
        return this.read(req);
      }
      inherited(req) {
        return this.read(req);
      }
      client(req) {
        return this.read(req);
      }
      guardOnly() {
        return { permitted: true };
      }
    }
    Controller("permission")(PermissionController);
    Permissions([SCHEDULE_WRITE])(PermissionController);
    /** @type {[string, string, number[] | null][]} */
    const permissionRoutes = [
      ["read", "read", [SCHEDULE_READ]],
      ["write", "write", [SCHEDULE_WRITE]],
      ["inherited", "inherited", null],
      ["client", "client/:clientId", [SCHEDULE_WRITE]],
      ["guardOnly", "guard-only", [SCHEDULE_WRITE]],
      ["guest", "guest", []],
    ];
    for (const [name, route, required] of permissionRoutes) {
      const descriptor = Object.getOwnPropertyDescriptor(PermissionController.prototype, name);
      Req()(PermissionController.prototype, name, 0);
      Get(route)(PermissionController.prototype, name, descriptor);
      UseGuards(
        ...(["guardOnly", "guest"].includes(name) ? [PermissionsGuard] : [ApiAuthGuard, PermissionsGuard])
      )(PermissionController.prototype, name, descriptor);
      if (required) Permissions(required)(PermissionController.prototype, name, descriptor);
    }
    controllers.push(PermissionController);
    controllers.push(
      load(path.join(root, "apps/api/v2/src/modules/atoms/controllers/atoms.schedules.controller.ts"))
        .AtomsSchedulesController
    );
    controllers.push(
      load(
        path.join(
          root,
          "apps/api/v2/src/platform/event-types-private-links/controllers/event-types-private-links.controller.ts"
        )
      ).EventTypesPrivateLinksController
    );
  }
  if (options.apiKeyController) {
    const apiKeys = path.join(root, "apps/api/v2/src/modules/api-keys");
    controllers.push(load(path.join(apiKeys, "controllers/api-keys.controller.ts")).ApiKeysController);
    extraProviders.push(load(path.join(apiKeys, "services/api-keys.service.ts")).ApiKeysService);
  }
  const extension = options.extend?.({ load, tokens }) ?? {};
  controllers.push(...(extension.controllers ?? []));
  extraProviders.push(...(extension.providers ?? []));
  const module = await Test.createTestingModule({
    imports: [PassportModule],
    controllers,
    providers: [
      ApiAuthStrategy,
      NextAuthStrategy,
      NextAuthSessionService,
      ApiAuthGuard,
      NextAuthGuard,
      { provide: ConfigService, useValue: state.config },
      ...Object.entries(tokens).map(([name, token]) => ({
        provide: token,
        ...(state.permissionFixture &&
        ["TokensRepository", "TokensService", "OAuthClientRepository"].includes(name)
          ? { useClass: token }
          : {
              useValue:
                name === "PrismaWriteService"
                  ? state.primary
                  : name === "PrismaReadService"
                    ? state.replica
                    : new token(),
            }),
      })),
      ...extraProviders,
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.use(cookieParser());
  if (options.configure) options.configure(app);
  await app.listen(0, "127.0.0.1");
  return { app, module, load, origin: await app.getUrl(), resolve: module.get(NextAuthSessionService) };
}
module.exports = { createApiRuntime, fixtureModules };
