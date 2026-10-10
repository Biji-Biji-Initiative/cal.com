// SPDX-License-Identifier: MIT

import type { DB } from "@calcom/kysely";
import type { Kysely } from "kysely";
import { jsonArrayFrom, jsonObjectFrom } from "kysely/helpers/postgres";
import type { AuthoritySnapshot, PermissionStore } from "./PermissionPolicy";

// Share the policy, not a second SQL implementation of roles. Passing the
// listing transaction keeps grants and returned bookings on one DB snapshot.
export class KyselyPermissionStore implements PermissionStore {
  constructor(private readonly database: Kysely<DB>) {}

  async snapshot(userId: number): Promise<AuthoritySnapshot> {
    const user = await this.database
      .selectFrom("users")
      .select(["id", "locked"])
      .where("id", "=", userId)
      .executeTakeFirst();
    const memberships = await this.database
      .selectFrom("Membership")
      .select((eb) => [
        "Membership.userId",
        "Membership.teamId",
        "Membership.accepted",
        "Membership.role",
        "Membership.customRoleId",
        jsonObjectFrom(
          eb
            .selectFrom("Role")
            .select((role) => [
              "Role.id",
              "Role.teamId",
              jsonArrayFrom(
                role
                  .selectFrom("RolePermission")
                  .select(["resource", "action"])
                  .whereRef("RolePermission.roleId", "=", "Role.id")
              ).as("permissions"),
            ])
            .whereRef("Role.id", "=", "Membership.customRoleId")
        ).as("customRole"),
      ])
      .where("Membership.userId", "=", userId)
      .execute();
    return { user: user ?? null, memberships };
  }

  async teams(ids: readonly number[]) {
    if (ids.length === 0) return [];
    return this.database
      .selectFrom("Team")
      .select(["id", "parentId", "isOrganization"])
      .where("id", "in", ids)
      .execute();
  }

  async children(parentIds: readonly number[]) {
    if (parentIds.length === 0) return [];
    return this.database
      .selectFrom("Team")
      .select(["id", "parentId", "isOrganization"])
      .where("parentId", "in", parentIds)
      .execute();
  }
}
