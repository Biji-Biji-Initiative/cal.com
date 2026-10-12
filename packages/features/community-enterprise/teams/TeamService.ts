// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { PermissionCheckService } from "@calcom/features/community-enterprise/authorization/PermissionCheckService";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { Prisma, PrismaClient } from "@calcom/prisma/client";
import { z } from "zod";

const positiveId = z.number().int().positive();
const requestId = z.string().uuid();
const slug = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const timezone = z
  .string()
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  });
export const createTeamInput = z
  .object({
    organizationId: positiveId,
    name: z.string().trim().min(1).max(100),
    slug,
    timeZone: timezone,
    requestId,
  })
  .strict();
export const setMemberInput = z
  .object({
    organizationId: positiveId,
    teamId: positiveId,
    userId: positiveId,
    role: z.enum(["MEMBER", "ADMIN", "OWNER"]),
    requestId,
  })
  .strict();

type Transaction = Prisma.TransactionClient;
const teamFields = {
  id: true,
  name: true,
  slug: true,
  timeZone: true,
  parentId: true,
  isOrganization: true,
} as const;
const denied = () => new ErrorWithCode(ErrorCode.Forbidden, "You cannot manage this organization or team");
const invalid = (message: string) => new ErrorWithCode(ErrorCode.BadRequest, message);

async function serializable<T>(client: PrismaClient, action: (tx: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.$transaction(action, {
        isolationLevel: "Serializable",
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (error) {
      if (
        attempt < 2 &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error.code === "P2034" || error.code === "P2002")
      )
        continue;
      throw error;
    }
  }
}

async function requireOrganizationAdmin(tx: Transaction, actorId: number, organizationId: number) {
  const permitted = await new PermissionCheckService(tx).checkPermission({
    userId: actorId,
    teamId: organizationId,
    permission: "organization.update",
    fallbackRoles: ["ADMIN", "OWNER"],
  });
  if (!permitted) throw denied();
  const organization = await tx.team.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      isOrganization: true,
      parentId: true,
      dsyncTeamGroupMapping: { select: { id: true }, take: 1 },
    },
  });
  if (!organization?.isOrganization || organization.parentId !== null) throw denied();
  if (organization.dsyncTeamGroupMapping.length)
    throw invalid("Directory-managed memberships must be changed in the directory");
}

function operationHash(actorId: number, action: string, input: object) {
  return createHash("sha256").update(JSON.stringify({ actorId, action, input })).digest("hex");
}

async function previousOperation(tx: Transaction, id: string, hash: string) {
  const event = await tx.enterpriseAuditEvent.findUnique({
    where: { operationId: id },
    select: {
      operationHash: true,
      entityId: true,
    },
  });
  if (!event) return null;
  if (event.operationHash !== hash || event.entityId === null)
    throw invalid("This operation identifier was already used for another request");
  return event.entityId;
}

export class TeamService {
  constructor(private readonly client: PrismaClient) {}

  async overview(actorId: number) {
    positiveId.parse(actorId);
    const user = await this.client.user.findUnique({
      where: { id: actorId },
      select: { id: true, locked: true },
    });
    if (!user || user.locked) throw denied();
    const memberships = await this.client.membership.findMany({
      where: { userId: actorId, accepted: true, team: { isOrganization: true, parentId: null } },
      select: { teamId: true, role: true, customRoleId: true, team: { select: teamFields } },
      orderBy: { teamId: "asc" },
    });
    const permissions = new PermissionCheckService(this.client);
    return Promise.all(
      memberships.map(async (membership) => {
        const canManage = await permissions.checkPermission({
          userId: actorId,
          teamId: membership.teamId,
          permission: "organization.update",
          fallbackRoles: ["ADMIN", "OWNER"],
        });
        const teams = await this.client.team.findMany({
          where: {
            parentId: membership.teamId,
            isOrganization: false,
            ...(canManage ? {} : { members: { some: { userId: actorId, accepted: true } } }),
          },
          select: {
            ...teamFields,
            dsyncTeamGroupMapping: { select: { id: true }, take: 1 },
            members: {
              where: { accepted: true, user: { locked: false } },
              select: {
                userId: true,
                role: true,
                customRoleId: true,
                user: { select: { id: true, name: true, username: true } },
              },
            },
            eventTypes: {
              select: { id: true, title: true, slug: true, schedulingType: true },
              orderBy: { id: "asc" },
            },
          },
          orderBy: { name: "asc" },
        });
        const eligibleMembers = canManage
          ? await this.client.membership.findMany({
              where: {
                teamId: membership.teamId,
                accepted: true,
                user: { locked: false },
              },
              select: { userId: true, user: { select: { id: true, name: true, username: true } } },
              orderBy: { userId: "asc" },
            })
          : [];
        return {
          organization: membership.team,
          canManage,
          teams: teams.map(({ dsyncTeamGroupMapping, ...team }) => ({
            ...team,
            directoryManaged: dsyncTeamGroupMapping.length > 0,
          })),
          eligibleMembers,
        };
      })
    );
  }

  async createTeam(actorId: number, rawInput: z.input<typeof createTeamInput>) {
    positiveId.parse(actorId);
    const input = createTeamInput.parse(rawInput);
    const hash = operationHash(actorId, "team.created", input);
    return serializable(this.client, async (tx) => {
      await requireOrganizationAdmin(tx, actorId, input.organizationId);
      const previous = await previousOperation(tx, input.requestId, hash);
      if (previous !== null) return { teamId: previous, replayed: true };
      const duplicate = await tx.team.findFirst({
        where: { parentId: input.organizationId, slug: input.slug },
        select: { id: true },
      });
      if (duplicate) throw invalid("A team with this address already exists in the organization");
      const team = await tx.team.create({
        data: {
          name: input.name,
          slug: input.slug,
          timeZone: input.timeZone,
          parentId: input.organizationId,
          isOrganization: false,
          members: { create: { userId: actorId, role: "OWNER", accepted: true } },
        },
        select: { id: true },
      });
      await tx.enterpriseAuditEvent.create({
        data: {
          operationId: input.requestId,
          operationHash: hash,
          actorUserId: actorId,
          organizationId: input.organizationId,
          entityId: team.id,
          action: "team.created",
          details: { source: "local", name: input.name, slug: input.slug, timeZone: input.timeZone },
        },
        select: { id: true },
      });
      return { teamId: team.id, replayed: false };
    });
  }

  async setMember(actorId: number, rawInput: z.input<typeof setMemberInput>) {
    positiveId.parse(actorId);
    const input = setMemberInput.parse(rawInput);
    const hash = operationHash(actorId, "team.member.set", input);
    return serializable(this.client, async (tx) => {
      await requireOrganizationAdmin(tx, actorId, input.organizationId);
      const team = await tx.team.findFirst({
        where: { id: input.teamId, parentId: input.organizationId, isOrganization: false },
        select: { id: true, dsyncTeamGroupMapping: { select: { id: true }, take: 1 } },
      });
      if (!team) throw denied();
      if (team.dsyncTeamGroupMapping.length)
        throw invalid("Directory-managed team membership cannot be overwritten locally");
      const parentMembership = await tx.membership.findUnique({
        where: {
          userId_teamId: {
            userId: input.userId,
            teamId: input.organizationId,
          },
        },
        select: { accepted: true, user: { select: { locked: true } } },
      });
      if (!parentMembership?.accepted || parentMembership.user.locked)
        throw invalid("The person must be an active, accepted member of this organization");
      const previous = await previousOperation(tx, input.requestId, hash);
      if (previous !== null) return { membershipId: previous, replayed: true };
      const current = await tx.membership.findUnique({
        where: { userId_teamId: { userId: input.userId, teamId: input.teamId } },
        select: { id: true, role: true, accepted: true, customRoleId: true },
      });
      if (current?.customRoleId)
        throw invalid("A custom role cannot be replaced through the basic-role control");
      if (current?.accepted && current.role === "OWNER" && input.role !== "OWNER") {
        const owners = await tx.membership.count({
          where: {
            teamId: input.teamId,
            role: "OWNER",
            accepted: true,
            customRoleId: null,
            user: { locked: false, teams: { some: { teamId: input.organizationId, accepted: true } } },
          },
        });
        if (owners <= 1) throw invalid("The team must retain an active owner");
      }
      const changed = await tx.membership.upsert({
        where: { userId_teamId: { userId: input.userId, teamId: input.teamId } },
        create: { userId: input.userId, teamId: input.teamId, role: input.role, accepted: true },
        update: { role: input.role, accepted: true },
        select: { id: true },
      });
      await tx.enterpriseAuditEvent.create({
        data: {
          operationId: input.requestId,
          operationHash: hash,
          actorUserId: actorId,
          organizationId: input.organizationId,
          entityId: changed.id,
          action: "team.member.set",
          details: {
            source: "local",
            teamId: input.teamId,
            userId: input.userId,
            before: current?.role ?? null,
            after: input.role,
          },
        },
        select: { id: true },
      });
      return { membershipId: changed.id, replayed: false };
    });
  }
}
