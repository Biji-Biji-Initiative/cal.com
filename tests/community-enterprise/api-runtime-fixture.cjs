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

function fixtureModules(state) {
  const cache = new Map();
  // These tokens provide the real primary client. Unexercised OAuth dependencies
  // are isolated; their verification is not claimed by the cookie/key tests.
  class PrismaWriteService {}
  class UsersService {
    getUserMainOrgId(user) {
      return user.movedToProfile?.organizationId ?? user.profiles?.[0]?.organizationId ?? null;
    }
  }
  class UsersRepository {
    async findByIdWithProfile() {
      state.replicaReads++;
      return state.staleUser;
    }
  }
  class OAuthFlowService {
    async validateAccessToken() {
      return false;
    }
  }
  class TokensRepository {}
  class TokensService {
    getDecodedThirdPartyAccessToken() {
      return null;
    }
  }
  class OAuthClientRepository {}
  class MembershipsRepository {}
  const tokens = {
    PrismaWriteService,
    UsersService,
    UsersRepository,
    OAuthFlowService,
    TokensRepository,
    TokensService,
    OAuthClientRepository,
    MembershipsRepository,
  };
  const substitutions = new Map([
    ["@/modules/prisma/prisma-write.service", { PrismaWriteService }],
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
  ]);
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
          return load(path.join(root, "packages/platform/constants/api.ts"));
        if (name === "@calcom/prisma") return { __esModule: true, default: state.primary.prisma };
        if (name === "@calcom/platform-libraries") {
          return Object.assign(
            {},
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
  return { load, tokens };
}

async function createApiRuntime(state, options = {}) {
  const { load, tokens } = fixtureModules(state);
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
  const controllers = [FixtureController];
  const extraProviders = [];
  if (options.apiKeyController) {
    const apiKeys = path.join(root, "apps/api/v2/src/modules/api-keys");
    controllers.push(load(path.join(apiKeys, "controllers/api-keys.controller.ts")).ApiKeysController);
    extraProviders.push(load(path.join(apiKeys, "services/api-keys.service.ts")).ApiKeysService);
  }
  const module = await Test.createTestingModule({
    imports: [PassportModule],
    controllers,
    providers: [
      ...extraProviders,
      ApiAuthStrategy,
      NextAuthStrategy,
      NextAuthSessionService,
      ApiAuthGuard,
      NextAuthGuard,
      { provide: ConfigService, useValue: state.config },
      ...Object.entries(tokens).map(([name, token]) => ({
        provide: token,
        useValue: name === "PrismaWriteService" ? state.primary : new token(),
      })),
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.use(cookieParser());
  if (options.configure) options.configure(app);
  await app.listen(0, "127.0.0.1");
  return { app, module, load, origin: await app.getUrl(), resolve: module.get(NextAuthSessionService) };
}
module.exports = { createApiRuntime, fixtureModules };
