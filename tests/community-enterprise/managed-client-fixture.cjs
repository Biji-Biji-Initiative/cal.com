// SPDX-License-Identifier: MIT
// Native client credentials and owner/profile repositories against the owned DB.
const path = require("node:path");
function managedClientFixture({ native, load, tokens, db, root }) {
  const base = "apps/api/v2/src/modules/";
  const User = native(`${base}users/users.repository.ts`, "UsersRepository", ["findByIdWithProfile"]);
  const users = Object.assign(new User(), { dbRead: { prisma: db } });
  const Membership = native(`${base}memberships/memberships.repository.ts`, "MembershipsRepository", [
    "findPlatformOwnerUserId",
    "findPlatformAdminUserId",
  ]);
  const memberships = Object.assign(new Membership(), { dbRead: { prisma: db } });
  const { OAuthClientRepository } = load(path.join(root, base, "oauth-clients/oauth-client.repository.ts"));
  const clients = new OAuthClientRepository({ prisma: db }, { prisma: db });
  return {
    clients,
    providers: [
      { provide: tokens.UsersRepository, useValue: users },
      { provide: tokens.MembershipsRepository, useValue: memberships },
      { provide: tokens.OAuthClientRepository, useValue: clients },
    ],
  };
}
module.exports = { managedClientFixture };
