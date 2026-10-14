// SPDX-License-Identifier: MIT
import { createHash, randomUUID } from "node:crypto";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { Prisma, type PrismaClient } from "@calcom/prisma/client";
import { z } from "zod";
import {
  organizationInvitationPrefix,
  parseOrganizationInvitationBinding,
} from "./OrganizationInvitationService";

const id = z.number().int().positive();
const identity = z.object({ id, uuid: z.string().uuid() }).strict();
const request = z
  .object({
    organizationId: id,
    target: identity,
    operation: z.enum(["set-role", "transfer-ownership", "remove"]),
    role: z.enum(["MEMBER", "ADMIN"]).optional(),
  })
  .strict();
export const memberReviewInput = request.refine(
  (value) => (value.operation === "set-role" ? value.role !== undefined : value.role === undefined),
  "A role is required only for role changes"
);
export const memberCommitInput = request
  .extend({ reviewHash: z.string().regex(/^[a-f0-9]{64}$/), requestId: z.string().uuid() })
  .strict()
  .refine(
    (value) => (value.operation === "set-role" ? value.role !== undefined : value.role === undefined),
    "Invalid operation/role combination"
  );
export const memberPageInput = z.object({ organizationId: id, cursor: id.optional() }).strict();
type Actor = z.infer<typeof identity>;
type Request = z.infer<typeof memberReviewInput>;
type Transaction = Prisma.TransactionClient;
const denied = () => new ErrorWithCode(ErrorCode.Forbidden, "You cannot manage this organization membership");
const invalid = (message: string) => new ErrorWithCode(ErrorCode.BadRequest, message);
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const userSelect = {
  id: true,
  uuid: true,
  name: true,
  email: true,
  role: true,
  locked: true,
  isPlatformManaged: true,
  organizationId: true,
  movedToProfileId: true,
} as const;
const memberSelect = {
  id: true,
  teamId: true,
  userId: true,
  accepted: true,
  role: true,
  customRoleId: true,
  updatedAt: true,
} as const;
const bounded = <T>(rows: T[]): T[] => {
  if (rows.length > 500)
    throw invalid(
      "This operation exceeds the reviewed single-member limit; use a separately reviewed bulk plan"
    );
  return rows;
};

// Domain commands are shared by the native UI, not a second identity directory.
// Review hashes detect changed effects; they never replace current authorization.
export class OrganizationMemberService {
  constructor(private readonly db: PrismaClient) {}
  private async transaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(run, {
          isolationLevel: "Serializable",
          maxWait: 5000,
          timeout: 15000,
        });
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : null;
        if (attempt < 2 && (code === "P2034" || code === "P2002")) continue;
        throw error;
      }
    }
  }
  private async active(tx: Transaction, actor: Actor) {
    const user = await tx.user.findUnique({ where: { id: actor.id }, select: userSelect });
    if (!user || user.uuid !== actor.uuid || user.locked || user.isPlatformManaged) throw denied();
    return user;
  }
  private async root(tx: Transaction, organizationId: number) {
    const org = await tx.team.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        isOrganization: true,
        parentId: true,
        pendingPayment: true,
        isPlatform: true,
        dsyncTeamGroupMapping: { select: { id: true }, take: 1 },
        organizationSettings: {
          select: {
            dSyncData: { select: { id: true } },
            orgAutoJoinOnSignup: true,
            isOrganizationVerified: true,
            orgAutoAcceptEmail: true,
          },
        },
      },
    });
    if (!org?.isOrganization || org.parentId !== null || org.pendingPayment || org.isPlatform) throw denied();
    if (org.dsyncTeamGroupMapping.length || org.organizationSettings?.dSyncData)
      throw invalid("Directory-managed membership must be changed in the directory");
    return org;
  }
  private async admin(tx: Transaction, actor: Actor, organizationId: number) {
    const user = await this.active(tx, actor);
    const org = await this.root(tx, organizationId);
    const grant = await tx.membership.findUnique({
      where: { userId_teamId: { userId: actor.id, teamId: organizationId } },
      select: memberSelect,
    });
    if (!grant?.accepted || grant.customRoleId !== null || !["OWNER", "ADMIN"].includes(grant.role))
      throw denied();
    return { user, org, grant };
  }
  async members(actor: Actor, raw: z.input<typeof memberPageInput>) {
    actor = identity.parse(actor);
    const input = memberPageInput.parse(raw);
    return this.db.$transaction(
      async (tx) => {
        const { grant } = await this.admin(tx, actor, input.organizationId);
        const rows = await tx.membership.findMany({
          where: {
            teamId: input.organizationId,
            accepted: true,
            ...(input.cursor ? { id: { gt: input.cursor } } : {}),
          },
          select: {
            ...memberSelect,
            user: {
              select: {
                id: true,
                uuid: true,
                name: true,
                email: true,
                locked: true,
                isPlatformManaged: true,
              },
            },
          },
          orderBy: { id: "asc" },
          take: 51,
        });
        return {
          items: rows.slice(0, 50),
          nextCursor: rows.length > 50 ? rows[49].id : null,
          actorRole: grant.role,
          actorId: actor.id,
        };
      },
      { isolationLevel: "RepeatableRead", timeout: 10000 }
    );
  }
  private async tokenImpact(tx: Transaction, userIds: number[], scopes: number[], organizationId: number) {
    const apiKeys = bounded(
      await tx.apiKey.findMany({
        where: { userId: { in: userIds }, teamId: { in: scopes } },
        select: { id: true },
        orderBy: { id: "asc" },
        take: 501,
      })
    );
    const clients = bounded(
      await tx.platformOAuthClient.findMany({
        where: { organizationId },
        select: {
          id: true,
          users: { where: { id: { in: userIds } }, select: { id: true }, orderBy: { id: "asc" } },
        },
        orderBy: { id: "asc" },
        take: 501,
      })
    );
    const clientIds = clients.map((row) => row.id);
    const where = { userId: { in: userIds }, platformOAuthClientId: { in: clientIds } };
    const access = bounded(
      await tx.accessToken.findMany({ where, select: { id: true }, orderBy: { id: "asc" }, take: 501 })
    );
    const refresh = bounded(
      await tx.refreshToken.findMany({ where, select: { id: true }, orderBy: { id: "asc" }, take: 501 })
    );
    const authorization = bounded(
      await tx.platformAuthorizationToken.findMany({
        where,
        select: { id: true },
        orderBy: { id: "asc" },
        take: 501,
      })
    );
    return { apiKeys, clients, access, refresh, authorization };
  }
  private async plan(tx: Transaction, actor: Actor, input: Request) {
    const { user, org, grant } = await this.admin(tx, actor, input.organizationId);
    const target = await tx.user.findUnique({
      where: { id: input.target.id, locked: {} },
      select: userSelect,
    });
    const membership = await tx.membership.findUnique({
      where: { userId_teamId: { userId: input.target.id, teamId: org.id } },
      select: memberSelect,
    });
    if (!target || target.uuid !== input.target.uuid || target.isPlatformManaged || !membership?.accepted)
      throw denied();
    if (membership.customRoleId !== null)
      throw invalid("Custom-role membership requires the dedicated permission workflow");
    if (input.operation !== "remove" && (grant.role !== "OWNER" || target.locked)) throw denied();
    if (
      input.operation === "remove" &&
      grant.role !== "OWNER" &&
      membership.role !== "MEMBER" &&
      actor.id !== target.id
    )
      throw denied();
    if (input.operation === "set-role" && membership.role === input.role)
      throw invalid("The requested role is already current");
    if (input.operation === "transfer-ownership" && (actor.id === target.id || membership.role === "OWNER"))
      throw invalid("Select a different accepted member who is not already an owner");
    const blockers: string[] = [];
    const owners = bounded(
      await tx.membership.findMany({
        where: {
          teamId: org.id,
          accepted: true,
          role: "OWNER",
          customRoleId: null,
          user: { locked: false, isPlatformManaged: false },
        },
        select: { id: true, userId: true },
        orderBy: { id: "asc" },
        take: 501,
      })
    );
    if (
      membership.role === "OWNER" &&
      input.operation !== "transfer-ownership" &&
      !owners.some((row) => row.userId !== target.id)
    )
      blockers.push("last-owner");
    const children = bounded(
      await tx.team.findMany({
        where: { parentId: org.id, pendingPayment: {} },
        select: { id: true, isOrganization: true, dsyncTeamGroupMapping: { select: { id: true }, take: 1 } },
        orderBy: { id: "asc" },
        take: 501,
      })
    );
    const scopes = [org.id, ...children.filter((row) => !row.isOrganization).map((row) => row.id)];
    const grants = bounded(
      await tx.membership.findMany({
        where: { userId: target.id, teamId: { in: scopes } },
        select: memberSelect,
        orderBy: { id: "asc" },
        take: 501,
      })
    );
    const userIds =
      input.operation === "transfer-ownership" ? [actor.id, target.id].sort((a, b) => a - b) : [target.id];
    const tokens = await this.tokenImpact(
      tx,
      userIds,
      input.operation === "remove" ? scopes : [org.id],
      org.id
    );
    const profile = await tx.profile.findUnique({
      where: { userId_organizationId: { userId: target.id, organizationId: org.id } },
      select: { id: true, uid: true, updatedAt: true, movedFromUser: { select: { id: true } } },
    });
    const invitations: { id: number; pendingMemberId: number | null }[] = [];
    let linkedEventTypes = 0,
      openBookings = 0,
      sharedCredentials = 0,
      scopedWebhooks = 0;
    if (input.operation === "remove") {
      if (target.role === "ADMIN") blockers.push("instance-administrator");
      if (
        org.organizationSettings?.isOrganizationVerified &&
        org.organizationSettings.orgAutoJoinOnSignup &&
        org.organizationSettings.orgAutoAcceptEmail
      )
        blockers.push("automatic-readmission");
      if (children.some((row) => row.isOrganization)) blockers.push("nested-organizations");
      if (grants.some((row) => row.customRoleId !== null)) blockers.push("custom-child-role");
      if (
        children.some(
          (row) => row.dsyncTeamGroupMapping.length && grants.some((member) => member.teamId === row.id)
        )
      )
        blockers.push("directory-team");
      if (
        target.organizationId === org.id ||
        target.movedToProfileId === profile?.id ||
        profile?.movedFromUser
      )
        blockers.push("relocated-profile");
      for (const member of grants.filter(
        (row) => row.teamId !== org.id && row.accepted && row.role === "OWNER"
      )) {
        const replacement = await tx.membership.findFirst({
          where: {
            teamId: member.teamId,
            userId: { not: target.id },
            accepted: true,
            role: "OWNER",
            customRoleId: null,
            user: {
              locked: false,
              isPlatformManaged: false,
              teams: { some: { teamId: org.id, accepted: true } },
            },
          },
          select: { id: true },
        });
        if (!replacement) {
          blockers.push("last-team-owner");
          break;
        }
      }
      const eventScope: Prisma.EventTypeWhereInput = {
        OR: [
          { teamId: { in: scopes } },
          { profile: { organizationId: org.id } },
          { parent: { teamId: { in: scopes } } },
        ],
      };
      linkedEventTypes = await tx.eventType.count({
        where: {
          AND: [
            eventScope,
            {
              OR: [
                { userId: target.id },
                { profileId: profile?.id ?? -1 },
                { hosts: { some: { userId: target.id } } },
                { users: { some: { id: target.id } } },
                { schedule: { userId: target.id } },
                { restrictionSchedule: { userId: target.id } },
                { instantMeetingSchedule: { userId: target.id } },
                { hosts: { some: { schedule: { userId: target.id } } } },
                { destinationCalendar: { credential: { userId: target.id } } },

                { selectedCalendars: { some: { userId: target.id } } },
              ],
            },
          ],
        },
      });
      if (linkedEventTypes) blockers.push("scheduling-handoff");
      openBookings = await tx.booking.count({
        where: {
          userId: target.id,
          eventType: eventScope,
          endTime: { gt: new Date() },
          status: { in: ["ACCEPTED", "PENDING", "AWAITING_HOST"] },
        },
      });
      if (openBookings) blockers.push("future-bookings");
      sharedCredentials = await tx.credential.count({ where: { userId: target.id, teamId: { in: scopes } } });
      if (sharedCredentials) blockers.push("shared-calendar-credentials");
      scopedWebhooks = await tx.webhook.count({
        where: {
          userId: target.id,
          OR: [
            { teamId: { in: scopes } },
            { eventType: eventScope },
            { platformOAuthClient: { organizationId: org.id } },
          ],
        },
      });
      if (scopedWebhooks) blockers.push("scoped-webhooks");
      // An inherited team token may implement a different re-admission path.
      // Do not guess its ownership or claim revocation while it remains usable.
      if (
        await tx.verificationToken.count({
          where: {
            teamId: { in: scopes },
            identifier: { not: { startsWith: organizationInvitationPrefix } },
          },
        })
      )
        blockers.push("legacy-invitation-links");
      const rows = bounded(
        await tx.verificationToken.findMany({
          where: { teamId: org.id, identifier: { startsWith: organizationInvitationPrefix } },
          select: { id: true, identifier: true },
          orderBy: { id: "asc" },
          take: 501,
        })
      );
      for (const row of rows) {
        const binding = parseOrganizationInvitationBinding(row.identifier);
        if (
          ![binding.issuer, binding.recipient].some(
            (person) => person.id === target.id && person.uuid === target.uuid
          )
        )
          continue;
        const pending = await tx.membership.findUnique({
          where: { id: binding.membershipId },
          select: memberSelect,
        });
        const pendingMemberId =
          pending &&
          !pending.accepted &&
          pending.role === "MEMBER" &&
          pending.customRoleId === null &&
          pending.teamId === org.id &&
          pending.userId === binding.recipient.id
            ? pending.id
            : null;
        invitations.push({ id: row.id, pendingMemberId });
      }
    }
    const removedMembershipIds =
      input.operation === "remove"
        ? [
            ...grants.map((row) => row.id),
            ...invitations.flatMap((row) => (row.pendingMemberId === null ? [] : [row.pendingMemberId])),
          ]
        : [];
    const attributes = removedMembershipIds.length
      ? bounded(
          await tx.attributeToUser.findMany({
            where: { memberId: { in: removedMembershipIds } },
            select: { id: true, createdByDSyncId: true, updatedByDSyncId: true },
            orderBy: { id: "asc" },
            take: 501,
          })
        )
      : [];
    if (attributes.some((row) => row.createdByDSyncId || row.updatedByDSyncId))
      blockers.push("directory-attributes");
    if (
      removedMembershipIds.length &&
      (await tx.host.count({ where: { memberId: { in: removedMembershipIds } } }))
    )
      blockers.push("linked-host-records");
    const effects = {
      membershipsRemoved: input.operation === "remove" ? grants.length : 0,
      organizationAttributesRemoved: attributes.length,
      profilesRemoved: input.operation === "remove" && profile ? 1 : 0,
      scopedApiKeysRevoked: tokens.apiKeys.length,
      oauthTokensRevoked: tokens.access.length + tokens.refresh.length + tokens.authorization.length,
      invitationsCancelled: invitations.length,
      pendingAdmissionsCancelled: invitations.filter((row) => row.pendingMemberId !== null).length,
      childRolesPreserved:
        input.operation !== "remove" ? grants.filter((row) => row.teamId !== org.id).length : 0,
      linkedEventTypes,
      openBookings,
      sharedCredentials,
      scopedWebhooks,
    };
    const reviewHash = fingerprint({
      version: 1,
      actor,
      input,
      user,
      org,
      grant,
      target,
      membership,
      owners,
      children,
      grants,
      tokens,
      profile,
      invitations,
      attributes,
      effects,
      blockers,
    });
    return {
      reviewHash,
      blockers,
      effects,
      target: {
        id: target.id,
        uuid: target.uuid,
        name: target.name,
        email: target.email,
        role: membership.role,
      },
      state: { org, grant, target, membership, grants, tokens, profile, invitations },
    };
  }
  async review(actor: Actor, raw: z.input<typeof memberReviewInput>) {
    actor = identity.parse(actor);
    const input = memberReviewInput.parse(raw);
    return this.db.$transaction(
      async (tx) => {
        const { reviewHash, blockers, effects, target } = await this.plan(tx, actor, input);
        return { input: { ...input, reviewHash, requestId: randomUUID() }, blockers, effects, target };
      },
      { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 15000 }
    );
  }
  async commit(actor: Actor, raw: z.input<typeof memberCommitInput>) {
    actor = identity.parse(actor);
    const input = memberCommitInput.parse(raw);
    const action = `organization.member.${input.operation}`;
    const operationHash = fingerprint({ version: 1, actor, action, input });
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Team" WHERE id=${input.organizationId} FOR UPDATE`;
      const ownerRows = bounded(
        await tx.membership.findMany({
          where: {
            role: "OWNER",
            accepted: true,
            OR: [{ teamId: input.organizationId }, { team: { parentId: input.organizationId } }],
          },
          select: { userId: true },
          take: 501,
        })
      );
      const userIds = Array.from(
        new Set([actor.id, input.target.id, ...ownerRows.map((row) => row.userId)])
      ).sort((a, b) => a - b);
      // Local account revocation and last-active-owner checks have one row-lock
      // order. A user change cannot overtake this admitted commit unnoticed.
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "users" WHERE id IN (${Prisma.join(userIds)}) ORDER BY id FOR UPDATE`
      );

      await this.active(tx, actor);
      const previous = await tx.enterpriseAuditEvent.findUnique({
        where: { operationId: input.requestId },
        select: { operationHash: true, action: true, actorUserId: true },
      });
      if (previous) {
        if (
          previous.operationHash !== operationHash ||
          previous.action !== action ||
          previous.actorUserId !== actor.id
        )
          throw invalid("This operation identifier was already used for another request");
        return { recorded: true, replayed: true };
      }
      const request = {
        organizationId: input.organizationId,
        target: input.target,
        operation: input.operation,
        ...(input.role ? { role: input.role } : {}),
      };
      const { reviewHash, blockers, effects, state } = await this.plan(tx, actor, request);
      if (reviewHash !== input.reviewHash)
        throw invalid(
          "Membership or affected resources changed; review the current impact before confirming"
        );
      if (blockers.length)
        throw invalid("Resolve the displayed ownership, scheduling or directory blockers before confirming");
      const { tokens } = state;
      if (tokens.apiKeys.length)
        await tx.apiKey.deleteMany({ where: { id: { in: tokens.apiKeys.map((row) => row.id) } } });
      if (tokens.access.length)
        await tx.accessToken.deleteMany({ where: { id: { in: tokens.access.map((row) => row.id) } } });
      if (tokens.refresh.length)
        await tx.refreshToken.deleteMany({ where: { id: { in: tokens.refresh.map((row) => row.id) } } });
      if (tokens.authorization.length)
        await tx.platformAuthorizationToken.deleteMany({
          where: { id: { in: tokens.authorization.map((row) => row.id) } },
        });
      if (input.operation === "remove") {
        for (const client of tokens.clients)
          if (client.users.length)
            await tx.platformOAuthClient.update({
              where: { id: client.id },
              data: { users: { disconnect: { id: state.target.id } } },
              select: { id: true },
            });
        for (const invitation of state.invitations) {
          if (invitation.pendingMemberId !== null)
            await tx.membership.deleteMany({ where: { id: invitation.pendingMemberId, accepted: false } });
          await tx.verificationToken.delete({ where: { id: invitation.id }, select: { id: true } });
        }
        await tx.membership.deleteMany({ where: { id: { in: state.grants.map((row) => row.id) } } });
        if (state.profile) await tx.profile.delete({ where: { id: state.profile.id }, select: { id: true } });
      } else {
        await tx.membership.update({
          where: { id: state.membership.id },
          data: { role: input.operation === "transfer-ownership" ? "OWNER" : input.role },
          select: { id: true },
        });
        if (input.operation === "transfer-ownership")
          await tx.membership.update({
            where: { id: state.grant.id },
            data: { role: "ADMIN" },
            select: { id: true },
          });
      }
      await tx.enterpriseAuditEvent.create({
        data: {
          operationId: input.requestId,
          operationHash,
          action,
          actorUserId: actor.id,
          organizationId: input.organizationId,
          entityId: state.membership.id,
          details: {
            version: 1,
            targetUserId: state.target.id,
            targetUuid: state.target.uuid,
            previousRole: state.membership.role,
            nextRole:
              input.operation === "remove"
                ? null
                : input.operation === "transfer-ownership"
                  ? "OWNER"
                  : input.role,
            effects,
          },
        },
        select: { id: true },
      });
      return { recorded: true, replayed: false };
    });
  }
}
