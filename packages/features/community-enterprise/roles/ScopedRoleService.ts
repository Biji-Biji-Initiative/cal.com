// SPDX-License-Identifier: MIT
import { createHash, randomUUID } from "node:crypto";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { Prisma, type PrismaClient } from "@calcom/prisma/client";
import { z } from "zod";
import {
  type RoleActor,
  type RoleAssignment,
  type RoleScope,
  roleActorInput,
  roleAssignmentCommitInput,
  roleAssignmentInput,
  roleCreateInput,
  roleScopeInput,
  scopedPermissions,
} from "./roleInputs";

type Transaction = Prisma.TransactionClient;
const denied = () =>
  new ErrorWithCode(ErrorCode.Forbidden, "Only a current organization owner can manage these local roles");
const invalid = (message: string) => new ErrorWithCode(ErrorCode.BadRequest, message);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const userSelect = {
  id: true,
  uuid: true,
  name: true,
  email: true,
  locked: true,
  isPlatformManaged: true,
} as const;
const memberSelect = {
  id: true,
  userId: true,
  teamId: true,
  role: true,
  customRoleId: true,
  accepted: true,
  updatedAt: true,
} as const;
const roleSelect = {
  id: true,
  name: true,
  description: true,
  teamId: true,
  type: true,
  permissions: {
    select: { resource: true, action: true },
    orderBy: [{ resource: "asc" as const }, { action: "asc" as const }],
  },
} satisfies Prisma.RoleSelect;
const createdAction = "custom-role.created";
const assignmentAction = "custom-role.assigned";

// Retained Role/RolePermission/Membership records remain the authority model.
// Definitions are immutable through this interface: replacing a role requires
// reviewed per-member assignment, not silently changing every holder's powers.
export class ScopedRoleService {
  constructor(private readonly db: PrismaClient) {}

  private async write<T>(operation: (tx: Transaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(operation, {
          isolationLevel: "ReadCommitted",
          maxWait: 5000,
          timeout: 15000,
        });
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        if (attempt < 2 && (code === "P2034" || code === "P2002")) continue;
        throw error;
      }
    }
  }

  private async lock(tx: Transaction, actor: RoleActor, scope: RoleScope, target?: RoleActor) {
    // Match the existing member-lifecycle root -> user -> membership order.
    // Authority is read in subsequent statements after any wait, not before it.
    await tx.$queryRaw`SELECT id FROM "Team" WHERE id=${scope.organizationId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "organizationId" FROM "OrganizationSettings" WHERE "organizationId"=${scope.organizationId} FOR UPDATE`;
    if (scope.scopeId !== scope.organizationId)
      await tx.$queryRaw`SELECT id FROM "Team" WHERE id=${scope.scopeId} FOR UPDATE`;
    const users = Array.from(new Set([actor.id, ...(target ? [target.id] : [])])).sort((a, b) => a - b);
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "users" WHERE id IN (${Prisma.join(users)}) ORDER BY id FOR UPDATE`
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "Membership" WHERE "userId" IN (${Prisma.join(users)}) AND "teamId" IN (${scope.organizationId},${scope.scopeId}) ORDER BY id FOR UPDATE`
    );
    await tx.$queryRaw(Prisma.sql`SELECT a.id FROM "AttributeToUser" a JOIN "Membership" m ON a."memberId"=m.id
      WHERE m."userId" IN (${Prisma.join(users)}) AND m."teamId" IN (${scope.organizationId},${scope.scopeId})
      ORDER BY a.id FOR SHARE OF a`);
  }

  private async hasDirectoryProvenance(tx: Transaction, memberIds: number[]) {
    return !!(await tx.attributeToUser.findFirst({
      where: {
        memberId: { in: memberIds },
        OR: [{ createdByDSyncId: { not: null } }, { updatedByDSyncId: { not: null } }],
      },
      select: { id: true },
    }));
  }

  private async authority(tx: Transaction, actor: RoleActor, input: RoleScope) {
    const user = await tx.user.findUnique({ where: { id: actor.id }, select: userSelect });
    if (!user || user.uuid !== actor.uuid || user.locked || user.isPlatformManaged) throw denied();
    const org = await tx.team.findUnique({
      where: { id: input.organizationId },
      select: {
        id: true,
        parentId: true,
        isOrganization: true,
        isPlatform: true,
        pendingPayment: true,
        dsyncTeamGroupMapping: { select: { id: true }, take: 1 },
        organizationSettings: { select: { dSyncData: { select: { id: true } } } },
      },
    });
    if (!org?.isOrganization || org.parentId !== null || org.isPlatform || org.pendingPayment) throw denied();
    const grant = await tx.membership.findUnique({
      where: { userId_teamId: { userId: actor.id, teamId: org.id } },
      select: memberSelect,
    });
    if (!grant?.accepted || grant.role !== "OWNER" || grant.customRoleId !== null) throw denied();
    const scope = await tx.team.findUnique({
      where: { id: input.scopeId },
      select: {
        id: true,
        name: true,
        parentId: true,
        isOrganization: true,
        pendingPayment: true,
        isPlatform: true,
        dsyncTeamGroupMapping: { select: { id: true }, take: 1 },
      },
    });
    if (
      !scope ||
      scope.pendingPayment ||
      scope.isPlatform ||
      (scope.id !== org.id && (scope.parentId !== org.id || scope.isOrganization))
    )
      throw denied();
    if (
      org.dsyncTeamGroupMapping.length ||
      org.organizationSettings?.dSyncData ||
      scope.dsyncTeamGroupMapping.length
    )
      throw invalid(
        "Directory-managed access must be changed through its source, not replaced by a local role"
      );
    if (await this.hasDirectoryProvenance(tx, [grant.id]))
      throw invalid("Directory grant provenance requires source-managed administration");
    return { user, org, scope, grant };
  }

  async capability(actor: RoleActor, raw: z.input<typeof roleScopeInput>) {
    actor = roleActorInput.parse(actor);
    const input = roleScopeInput.parse(raw);
    try {
      await this.db.$transaction((tx) => this.authority(tx, actor, input), {
        isolationLevel: "RepeatableRead",
      });
      return { canManageRoles: true };
    } catch (error) {
      if (
        error instanceof ErrorWithCode &&
        (error.code === ErrorCode.Forbidden || error.code === ErrorCode.BadRequest)
      )
        return { canManageRoles: false };
      throw error;
    }
  }

  private async definition(tx: Transaction, roleId: string, scope: RoleScope) {
    const role = await tx.role.findUnique({ where: { id: roleId }, select: roleSelect });
    if (!role || role.teamId !== scope.scopeId || role.type !== "CUSTOM")
      throw invalid("The role must belong to this exact scope");
    const permissions = role.permissions.map((permission) => `${permission.resource}.${permission.action}`);
    if (
      !permissions.length ||
      permissions.some((value) => !scopedPermissions.some((known) => known === value))
    )
      throw invalid("This role includes permissions outside the reviewed local catalogue");
    const definitionHash = hash(role);
    const evidence = await tx.enterpriseAuditEvent.findMany({
      where: {
        organizationId: scope.organizationId,
        entityId: scope.scopeId,
        action: createdAction,
        details: { path: ["roleId"], equals: role.id },
      },
      select: { id: true, details: true },
      take: 2,
    });
    const provenance = z
      .object({ source: z.literal("local"), definitionHash: z.string(), roleId: z.string() })
      .safeParse(evidence[0]?.details);
    if (
      evidence.length !== 1 ||
      !provenance.success ||
      provenance.data.definitionHash !== definitionHash ||
      provenance.data.roleId !== role.id
    )
      throw invalid(
        "The role has unreviewed or changed provenance; create a reviewed replacement rather than overwriting it"
      );
    return { role, definitionHash, permissions, provenanceId: evidence[0].id };
  }

  async catalog(actor: RoleActor, raw: z.input<typeof roleScopeInput>) {
    actor = roleActorInput.parse(actor);
    const input = roleScopeInput.parse(raw);
    return this.db.$transaction(
      async (tx) => {
        const { scope } = await this.authority(tx, actor, input);
        const roles = await tx.role.findMany({
          where: { teamId: scope.id },
          select: roleSelect,
          orderBy: { id: "asc" },
          take: 101,
        });
        const members = await tx.membership.findMany({
          where: { teamId: scope.id, accepted: true },
          select: { ...memberSelect, user: { select: userSelect } },
          orderBy: { id: "asc" },
          take: 501,
        });
        if (roles.length > 100 || members.length > 500)
          throw invalid(
            "This scope exceeds the single-screen review bound; use a separately reviewed paged administration plan"
          );
        const choices = await Promise.all(
          roles.map(async (role) => {
            try {
              const known = await this.definition(tx, role.id, input);
              return { id: role.id, name: role.name, permissions: known.permissions, managed: true };
            } catch (error) {
              if (!(error instanceof ErrorWithCode)) throw error;
              return { id: role.id, name: role.name, permissions: [] as string[], managed: false };
            }
          })
        );
        return {
          scope: { id: scope.id, name: scope.name, organization: scope.isOrganization },
          permissions: [...scopedPermissions],
          roles: choices,
          members: members
            .filter(
              (member) => member.role === "MEMBER" && !member.user.locked && !member.user.isPlatformManaged
            )
            .map((member) => ({ id: member.id, user: member.user, customRoleId: member.customRoleId })),
        };
      },
      { isolationLevel: "RepeatableRead", timeout: 15000 }
    );
  }

  async create(actor: RoleActor, raw: z.input<typeof roleCreateInput>) {
    actor = roleActorInput.parse(actor);
    const parsed = roleCreateInput.parse(raw);
    const input = { ...parsed, permissions: [...parsed.permissions].sort() };
    const operationHash = hash({ version: 1, action: createdAction, actor, input });
    return this.write(async (tx) => {
      await this.lock(tx, actor, input);
      await this.authority(tx, actor, input);
      const previous = await tx.enterpriseAuditEvent.findUnique({
        where: { operationId: input.requestId },
        select: { action: true, actorUserId: true, operationHash: true, details: true },
      });
      if (previous) {
        const stored = z.object({ roleId: z.string() }).safeParse(previous.details);
        if (
          previous.action !== createdAction ||
          previous.actorUserId !== actor.id ||
          previous.operationHash !== operationHash ||
          !stored.success
        )
          throw invalid("This operation identifier belongs to another request");
        await this.definition(tx, stored.data.roleId, input);
        return { roleId: stored.data.roleId, replayed: true };
      }
      if (
        await tx.role.findFirst({
          where: { teamId: input.scopeId, name: { equals: input.name, mode: "insensitive" } },
          select: { id: true },
        })
      )
        throw invalid("A role with this name already exists in this scope");
      if ((await tx.role.count({ where: { teamId: input.scopeId } })) >= 100)
        throw invalid("This scope already has the maximum reviewed role definitions");
      const role = await tx.role.create({
        data: {
          name: input.name,
          description: input.description,
          teamId: input.scopeId,
          type: "CUSTOM",
          permissions: {
            create: input.permissions.map((permission) => {
              const [resource, action] = permission.split(".");
              return { resource, action };
            }),
          },
        },
        select: roleSelect,
      });
      await tx.enterpriseAuditEvent.create({
        data: {
          operationId: input.requestId,
          operationHash,
          action: createdAction,
          actorUserId: actor.id,
          organizationId: input.organizationId,
          entityId: input.scopeId,
          details: {
            version: 1,
            source: "local",
            actorUuid: actor.uuid,
            roleId: role.id,
            definitionHash: hash(role),
            permissions: input.permissions,
          },
        },
        select: { id: true },
      });
      return { roleId: role.id, replayed: false };
    });
  }

  private async plan(tx: Transaction, actor: RoleActor, input: RoleAssignment) {
    const authority = await this.authority(tx, actor, input);
    const target = await tx.user.findUnique({ where: { id: input.target.id }, select: userSelect });
    if (!target || target.uuid !== input.target.uuid || target.locked || target.isPlatformManaged)
      throw invalid("The target account is not the reviewed active local identity");
    const parent = await tx.membership.findUnique({
      where: { userId_teamId: { userId: target.id, teamId: input.organizationId } },
      select: memberSelect,
    });
    const member = await tx.membership.findUnique({
      where: { userId_teamId: { userId: target.id, teamId: input.scopeId } },
      select: memberSelect,
    });
    if (!parent?.accepted || !member?.accepted || member.role !== "MEMBER")
      throw invalid(
        "Only an accepted ordinary member can receive a custom role; owner and administrator changes use the existing reviewed lifecycle"
      );
    if (input.scopeId !== input.organizationId && parent.customRoleId === null && parent.role !== "MEMBER")
      throw invalid(
        "Inherited organization administration would override this role; review the parent authority first"
      );
    if (await this.hasDirectoryProvenance(tx, [parent.id, member.id]))
      throw invalid("Directory grant provenance cannot be replaced by a local assignment");
    if (parent.customRoleId && input.scopeId !== input.organizationId)
      await this.definition(tx, parent.customRoleId, {
        organizationId: input.organizationId,
        scopeId: input.organizationId,
      });
    const current = member.customRoleId ? await this.definition(tx, member.customRoleId, input) : null;
    const next = input.roleId ? await this.definition(tx, input.roleId, input) : null;
    const reviewHash = hash({ version: 1, actor, input, authority, target, parent, member, current, next });
    return { reviewHash, member, target, current, next };
  }

  async review(actor: RoleActor, raw: z.input<typeof roleAssignmentInput>) {
    actor = roleActorInput.parse(actor);
    const input = roleAssignmentInput.parse(raw);
    return this.db.$transaction(
      async (tx) => {
        const planned = await this.plan(tx, actor, input);
        return {
          input: { ...input, reviewHash: planned.reviewHash, requestId: randomUUID() },
          target: planned.target,
          before: planned.current
            ? { name: planned.current.role.name, permissions: planned.current.permissions }
            : null,
          after: planned.next
            ? { name: planned.next.role.name, permissions: planned.next.permissions }
            : null,
          provenance: "local" as const,
        };
      },
      { isolationLevel: "RepeatableRead", timeout: 15000 }
    );
  }

  async assign(actor: RoleActor, raw: z.input<typeof roleAssignmentCommitInput>) {
    actor = roleActorInput.parse(actor);
    const input = roleAssignmentCommitInput.parse(raw);
    const operationHash = hash({ version: 1, action: assignmentAction, actor, input });
    return this.write(async (tx) => {
      await this.lock(tx, actor, input, input.target);
      await this.authority(tx, actor, input);
      const previous = await tx.enterpriseAuditEvent.findUnique({
        where: { operationId: input.requestId },
        select: { action: true, actorUserId: true, operationHash: true },
      });
      if (previous) {
        if (
          previous.action !== assignmentAction ||
          previous.actorUserId !== actor.id ||
          previous.operationHash !== operationHash
        )
          throw invalid("This operation identifier belongs to another request");
        return { recorded: true, replayed: true };
      }
      const current = await tx.membership.findUnique({
        where: { userId_teamId: { userId: input.target.id, teamId: input.scopeId } },
        select: { customRoleId: true },
      });
      const parentMember = await tx.membership.findUnique({
        where: { userId_teamId: { userId: input.target.id, teamId: input.organizationId } },
        select: { customRoleId: true },
      });
      const roleIds = Array.from(
        new Set(
          [current?.customRoleId, parentMember?.customRoleId, input.roleId].filter(
            (value): value is string => typeof value === "string"
          )
        )
      ).sort();
      if (roleIds.length) {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Role" WHERE id IN (${Prisma.join(roleIds)}) ORDER BY id FOR UPDATE`
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "RolePermission" WHERE "roleId" IN (${Prisma.join(roleIds)}) ORDER BY id FOR SHARE`
        );
      }
      const request = {
        organizationId: input.organizationId,
        scopeId: input.scopeId,
        target: input.target,
        roleId: input.roleId,
      };
      const planned = await this.plan(tx, actor, request);
      if (planned.reviewHash !== input.reviewHash)
        throw invalid("Membership, role definition or authority changed; review again before confirming");
      await tx.membership.update({
        where: { id: planned.member.id },
        data: { customRoleId: input.roleId },
        select: { id: true },
      });
      await tx.enterpriseAuditEvent.create({
        data: {
          operationId: input.requestId,
          operationHash,
          action: assignmentAction,
          actorUserId: actor.id,
          organizationId: input.organizationId,
          entityId: planned.member.id,
          details: {
            version: 1,
            source: "local",
            actorUuid: actor.uuid,
            targetUserId: input.target.id,
            targetUuid: input.target.uuid,
            scopeId: input.scopeId,
            previousRoleId: planned.member.customRoleId,
            nextRoleId: input.roleId,
            previousDefinition: planned.current?.definitionHash ?? null,
            nextDefinition: planned.next?.definitionHash ?? null,
            reviewedImpact: input.reviewHash,
            personalOwnershipChanged: false,
            directoryGrantChanged: false,
          },
        },
        select: { id: true },
      });
      return { recorded: true, replayed: false };
    });
  }
}
