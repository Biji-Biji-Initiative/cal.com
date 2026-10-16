// SPDX-License-Identifier: MIT
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { Prisma, type PrismaClient } from "@calcom/prisma/client";
import { z } from "zod";
import { RUNNING_PREFIX, UNKNOWN_PREFIX } from "../../tasker/execution";
import { InvitationNoticeDelivery } from "./InvitationNoticeDelivery";
import {
  enqueueInvitationNotice,
  type InvitationNoticePayload,
  invitationNoticePrefix,
  invitationNoticeReference,
  invitationNoticeType,
} from "./InvitationNoticeOutbox";

const positiveId = z.number().int().positive();
const actorSchema = z.object({ id: positiveId, uuid: z.string().uuid() }).strict();
export const inviteOrganizationMemberInput = z
  .object({
    organizationId: positiveId,
    email: z.string().trim().email().max(254),
    requestId: z.string().uuid(),
  })
  .strict();
export const invitationPageInput = z
  .object({ organizationId: positiveId.optional(), cursor: positiveId.optional() })
  .strict();
export const invitationResponseInput = z
  .object({ invitationId: positiveId, decision: z.enum(["accept", "decline"]), requestId: z.string().uuid() })
  .strict();
export const invitationAdminInput = z
  .object({ organizationId: positiveId, invitationId: positiveId, requestId: z.string().uuid() })
  .strict();
type Actor = z.infer<typeof actorSchema>;
type Transaction = Prisma.TransactionClient;
export const organizationInvitationPrefix = "cal.enterprise.invite.v1:";
const PREFIX = organizationInvitationPrefix;
const bodySchema = z
  .object({ recipient: actorSchema, membershipId: positiveId, issuer: actorSchema })
  .strict();
const fields = {
  id: true,
  identifier: true,
  teamId: true,
  expires: true,
  createdAt: true,
  updatedAt: true,
} as const;
const userFields = {
  id: true,
  uuid: true,
  locked: true,
  isPlatformManaged: true,
  name: true,
  email: true,
  emailVerified: true,
  username: true,
  locale: true,
} as const;
const denied = () => new ErrorWithCode(ErrorCode.Forbidden, "You cannot act on this organization invitation");
const invalid = (message: string) => new ErrorWithCode(ErrorCode.BadRequest, message);
const rootFields = {
  id: true,
  name: true,
  parentId: true,
  isOrganization: true,
  pendingPayment: true,
  dsyncTeamGroupMapping: { select: { id: true }, take: 1 },
} as const;
const memberFields = {
  id: true,
  userId: true,
  teamId: true,
  accepted: true,
  role: true,
  customRoleId: true,
} as const;
type InvitationUser = Prisma.UserGetPayload<{ select: typeof userFields }>;
type InvitationRoot = Prisma.TeamGetPayload<{ select: typeof rootFields }>;
type InvitationMember = Pick<
  Prisma.MembershipGetPayload<{ select: typeof memberFields }>,
  "accepted" | "role" | "customRoleId"
>;
function requireActive(user: InvitationUser | null | undefined, actor: Actor) {
  if (!user || user.id !== actor.id || user.uuid !== actor.uuid || user.locked || user.isPlatformManaged)
    throw denied();
  return user;
}
function requireRoot(org: InvitationRoot | null | undefined) {
  if (!org?.isOrganization || org.parentId !== null || org.pendingPayment) throw denied();
  if (org.dsyncTeamGroupMapping.length)
    throw invalid("Directory-managed invitations must be changed in the directory");
  return org;
}
function requireAdmin(member: InvitationMember | null | undefined) {
  if (!member?.accepted || member.customRoleId !== null || !["ADMIN", "OWNER"].includes(member.role))
    throw denied();
}
const prefixFor = (uuid: string) => `${PREFIX}${uuid}:`;
export function parseOrganizationInvitationBinding(identifier: string) {
  if (!identifier.startsWith(PREFIX)) throw denied();
  const end = identifier.indexOf(":", PREFIX.length);
  if (end < 0) throw denied();
  const value = bodySchema.parse(JSON.parse(identifier.slice(end + 1)));
  if (identifier.slice(PREFIX.length, end) !== value.recipient.uuid) throw denied();
  return value;
}
const hash = (actor: Actor, action: string, input: object) =>
  createHash("sha256")
    .update(JSON.stringify({ version: 1, actor, action, input }))
    .digest("hex");
export type InvitationNotice = {
  invitationId: number;
  organizationName: string;
  from: string;
  to: string;
  locale: string;
};
export type InvitationNotification = (notice: InvitationNotice) => Promise<"submitted" | "not_sent">;

// VerificationToken already owns team-invitation lifetime. These namespaced
// rows are identity-bound inbox records, NOT bearer capabilities. Neither the
// random token nor the binding envelope is returned to browsers or emails.
export class OrganizationInvitationService {
  constructor(private readonly db: PrismaClient) {}

  private async transact<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(work, {
          isolationLevel: "Serializable",
          maxWait: 5000,
          timeout: 10000,
        });
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : null;
        if (attempt < 2 && (code === "P2034" || code === "P2002")) continue;
        throw error;
      }
    }
  }
  private async active(tx: Transaction, actor: Actor) {
    const user = await tx.user.findUnique({ where: { id: actor.id }, select: userFields });
    return requireActive(user, actor);
  }
  private async root(tx: Transaction, organizationId: number) {
    const org = await tx.team.findUnique({
      where: { id: organizationId },
      select: rootFields,
    });
    return requireRoot(org);
  }
  private async admin(tx: Transaction, actor: Actor, organizationId: number) {
    const user = await this.active(tx, actor);
    const org = await this.root(tx, organizationId);
    const member = await tx.membership.findUnique({
      where: { userId_teamId: { userId: actor.id, teamId: organizationId } },
      select: { accepted: true, role: true, customRoleId: true },
    });
    requireAdmin(member);
    return { user, org };
  }
  private async lock(tx: Transaction, organizationId: number) {
    // All invitation writers serialize per root; existing admin/revocation writes
    // remain covered by Serializable conflicts and current-state revalidation.
    await tx.$queryRaw`SELECT id FROM "Team" WHERE id=${organizationId} FOR UPDATE`;
  }
  private async now(tx: Transaction) {
    // Epoch milliseconds avoid adapter-dependent timezone decoding of raw
    // timestamptz values. Lifetimes and cooldowns compare the actual instant.
    const [row] = await tx.$queryRaw<
      Array<{ milliseconds: number }>
    >`SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS milliseconds`;
    if (!Number.isFinite(row.milliseconds)) throw invalid("Cannot determine invitation time");
    return new Date(row.milliseconds);
  }

  private async previous(tx: Transaction, requestId: string, operationHash: string) {
    const previous = await tx.enterpriseAuditEvent.findUnique({
      where: { operationId: requestId },
      select: { operationHash: true, entityId: true },
    });
    if (!previous) return null;
    if (previous.operationHash !== operationHash || previous.entityId === null)
      throw invalid("This request identifier was already used for a different operation");
    return previous.entityId;
  }
  private async audit(
    tx: Transaction,
    actor: Actor,
    organizationId: number,
    entityId: number,
    requestId: string,
    action: string,
    operationHash: string,
    details: Prisma.InputJsonObject = {}
  ) {
    await tx.enterpriseAuditEvent.create({
      data: {
        operationId: requestId,
        operationHash,
        actorUserId: actor.id,
        organizationId,
        entityId,
        action,
        details: { version: 1, ...details },
      },
      select: { id: true },
    });
  }
  private async record(tx: Transaction, invitationId: number) {
    const row = await tx.verificationToken.findUnique({ where: { id: invitationId }, select: fields });
    if (!row || row.teamId === null) throw denied();
    const binding = parseOrganizationInvitationBinding(row.identifier);
    const member = await tx.membership.findFirst({
      where: { id: binding.membershipId, userId: binding.recipient.id, teamId: row.teamId },
      select: { id: true, role: true, customRoleId: true, accepted: true },
    });
    if (!member || member.accepted || member.role !== "MEMBER" || member.customRoleId !== null)
      throw denied();
    return { ...row, organizationId: row.teamId, binding, member };
  }

  async invite(actor: Actor, raw: z.input<typeof inviteOrganizationMemberInput>) {
    actor = actorSchema.parse(actor);
    const parsed = inviteOrganizationMemberInput.parse(raw);
    const input = { ...parsed, email: parsed.email.toLowerCase() };
    const action = "organization.invitation.created";
    const operationHash = hash(actor, action, input);
    return this.transact(async (tx) => {
      await this.lock(tx, input.organizationId);
      await this.admin(tx, actor, input.organizationId);
      const previous = await this.previous(tx, input.requestId, operationHash);
      if (previous !== null) {
        const existing = await this.record(tx, previous);
        if (existing.organizationId !== input.organizationId || existing.expires <= (await this.now(tx)))
          throw invalid("The invitation is no longer pending; refresh the list");
        const task = await tx.task.findUnique({
          where: {
            referenceUid_type: {
              type: invitationNoticeType,
              referenceUid: invitationNoticeReference({
                version: 1,
                actor,
                invitationId: existing.id,
                organizationId: input.organizationId,
                requestId: input.requestId,
              }),
            },
          },
          select: { id: true },
        });
        // A historical invitation without an outbox row is not silently re-sent.
        return {
          invitationId: existing.id,
          expires: existing.expires,
          replayed: true,
          notificationTaskId: task?.id ?? null,
        };
      }
      const matches = await tx.user.findMany({
        where: { email: { equals: input.email, mode: "insensitive" } },
        select: userFields,
        take: 2,
      });
      const target = matches[0];
      if (
        matches.length !== 1 ||
        !target ||
        target.locked ||
        target.isPlatformManaged ||
        !target.emailVerified
      )
        throw invalid(
          "Invite one active existing account with a verified email address. Enrollment and address verification must be completed separately."
        );
      const current = await tx.membership.findUnique({
        where: { userId_teamId: { userId: target.id, teamId: input.organizationId } },
        select: { id: true },
      });
      if (current)
        throw invalid(
          "This account already has a membership or pending invitation. Review it instead of replacing it."
        );
      const membership = await tx.membership.create({
        data: { teamId: input.organizationId, userId: target.id, role: "MEMBER", accepted: false },
        select: { id: true },
      });
      const binding = {
        recipient: { id: target.id, uuid: target.uuid },
        membershipId: membership.id,
        issuer: actor,
      };
      const expires = new Date((await this.now(tx)).getTime() + 7 * 86400000);
      const invitation = await tx.verificationToken.create({
        data: {
          identifier: prefixFor(target.uuid) + JSON.stringify(binding),
          token: createHash("sha256").update(randomBytes(32)).digest("hex"),
          teamId: input.organizationId,
          expires,
        },
        select: { id: true },
      });
      const notificationTaskId = await enqueueInvitationNotice(tx, {
        version: 1,
        actor,
        organizationId: input.organizationId,
        invitationId: invitation.id,
        requestId: input.requestId,
      });
      await this.audit(
        tx,
        actor,
        input.organizationId,
        invitation.id,
        input.requestId,
        action,
        operationHash,
        {
          notificationTaskId,
          recipientId: target.id,
          membershipId: membership.id,
          role: "MEMBER",
          expires: expires.toISOString(),
        }
      );
      return { invitationId: invitation.id, expires, replayed: false, notificationTaskId };
    });
  }

  async pending(actor: Actor, raw: z.input<typeof invitationPageInput>) {
    actor = actorSchema.parse(actor);
    const input = invitationPageInput.parse(raw);
    return this.db.$transaction(
      async (tx) => {
        await this.active(tx, actor);
        if (input.organizationId !== undefined) await this.admin(tx, actor, input.organizationId);
        const rows = await tx.verificationToken.findMany({
          where: {
            ...(input.organizationId !== undefined
              ? { teamId: input.organizationId, identifier: { startsWith: PREFIX } }
              : { identifier: { startsWith: prefixFor(actor.uuid) } }),
            ...(input.cursor ? { id: { gt: input.cursor } } : {}),
          },
          select: fields,
          orderBy: { id: "asc" },
          take: 51,
        });
        // Hydrate only this bounded page once. The former per-row record/admin
        // reads multiplied round trips and could exhaust the read transaction.
        const candidates = rows.slice(0, 50).flatMap((row) => {
          if (row.teamId === null) return [];
          try {
            const binding = parseOrganizationInvitationBinding(row.identifier);
            if (
              input.organizationId === undefined &&
              (binding.recipient.id !== actor.id || binding.recipient.uuid !== actor.uuid)
            )
              return [];
            return [{ ...row, organizationId: row.teamId, binding }];
          } catch (error) {
            if (
              !(error instanceof ErrorWithCode) &&
              !(error instanceof z.ZodError) &&
              !(error instanceof SyntaxError)
            )
              throw error;
            return [];
          }
        });
        const memberIds = candidates.map((row) => row.binding.membershipId);
        const userIds = Array.from(
          new Set(candidates.flatMap((row) => [row.binding.recipient.id, row.binding.issuer.id]))
        );
        const orgIds = Array.from(new Set(candidates.map((row) => row.organizationId)));
        const [members, users, roots] = await Promise.all([
          tx.membership.findMany({
            where: {
              OR: [
                { id: { in: memberIds } },
                ...candidates.map((row) => ({ userId: row.binding.issuer.id, teamId: row.organizationId })),
              ],
            },
            select: memberFields,
          }),
          tx.user.findMany({ where: { id: { in: userIds } }, select: userFields }),
          tx.team.findMany({ where: { id: { in: orgIds } }, select: rootFields }),
        ]);
        const membersById = new Map(members.map((member) => [member.id, member]));
        const admins = new Map(members.map((member) => [`${member.teamId}:${member.userId}`, member]));
        const usersById = new Map(users.map((user) => [user.id, user]));
        const rootsById = new Map(roots.map((org) => [org.id, org]));
        const items = [];
        const now = await this.now(tx);
        for (const row of candidates) {
          const member = membersById.get(row.binding.membershipId);
          if (
            !member ||
            member.userId !== row.binding.recipient.id ||
            member.teamId !== row.organizationId ||
            member.accepted ||
            member.role !== "MEMBER" ||
            member.customRoleId !== null
          )
            continue;
          try {
            const recipient = requireActive(usersById.get(row.binding.recipient.id), row.binding.recipient);
            const org = requireRoot(rootsById.get(row.organizationId));
            let actionable = row.expires > now && !!recipient.emailVerified;
            try {
              requireActive(usersById.get(row.binding.issuer.id), row.binding.issuer);
              requireAdmin(admins.get(`${row.organizationId}:${row.binding.issuer.id}`));
            } catch {
              actionable = false;
            }
            items.push({
              id: row.id,
              organizationId: org.id,
              organizationName: org.name,
              expires: row.expires,
              createdAt: row.createdAt,
              recipient: { id: recipient.id, name: recipient.name, email: recipient.email },
              role: "MEMBER" as const,
              actionable,
            });
          } catch (error) {
            if (!(error instanceof ErrorWithCode)) throw error;
          }
        }
        return { items, nextCursor: rows.length > 50 ? rows[49].id : null };
      },
      { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 10000 }
    );
  }

  async respond(actor: Actor, raw: z.input<typeof invitationResponseInput>) {
    actor = actorSchema.parse(actor);
    const input = invitationResponseInput.parse(raw);
    const action = `organization.invitation.${input.decision === "accept" ? "accepted" : "declined"}`;
    const operationHash = hash(actor, action, input);
    return this.transact(async (tx) => {
      await this.active(tx, actor);
      if ((await this.previous(tx, input.requestId, operationHash)) !== null)
        return { responseRecorded: true, replayed: true };
      const first = await this.record(tx, input.invitationId);
      await this.lock(tx, first.organizationId);
      const invitation = await this.record(tx, input.invitationId);
      if (invitation.binding.recipient.id !== actor.id || invitation.binding.recipient.uuid !== actor.uuid)
        throw denied();
      const user = await this.active(tx, actor);
      await this.root(tx, invitation.organizationId);
      if (input.decision === "accept") {
        if (!user.emailVerified)
          throw invalid("Verify your account email before accepting an organization invitation");
        if (invitation.expires <= (await this.now(tx))) throw invalid("This invitation has expired");
        await this.admin(tx, invitation.binding.issuer, invitation.organizationId);
        const existingProfile = await tx.profile.findUnique({
          where: { userId_organizationId: { userId: actor.id, organizationId: invitation.organizationId } },
          select: { id: true },
        });
        // An orphan or directory-owned profile is not ours to reinterpret.
        if (existingProfile) throw invalid("An existing profile needs operator review before admission");
        const username =
          user.username && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(user.username)
            ? user.username
            : `member-${user.id}`;
        await tx.profile.create({
          data: { uid: randomUUID(), userId: user.id, organizationId: invitation.organizationId, username },
          select: { id: true },
        });
        await tx.membership.update({
          where: { id: invitation.member.id },
          data: { accepted: true },
          select: { id: true },
        });
      } else {
        await tx.membership.delete({ where: { id: invitation.member.id }, select: { id: true } });
      }
      await tx.verificationToken.delete({ where: { id: invitation.id }, select: { id: true } });
      await this.audit(
        tx,
        actor,
        invitation.organizationId,
        invitation.id,
        input.requestId,
        action,
        operationHash,
        { membershipId: invitation.member.id, recipientId: actor.id }
      );
      return { responseRecorded: true, replayed: false };
    });
  }

  async cancel(actor: Actor, raw: z.input<typeof invitationAdminInput>) {
    actor = actorSchema.parse(actor);
    const input = invitationAdminInput.parse(raw);
    const action = "organization.invitation.cancelled";
    const operationHash = hash(actor, action, input);
    return this.transact(async (tx) => {
      await this.lock(tx, input.organizationId);
      await this.admin(tx, actor, input.organizationId);
      if ((await this.previous(tx, input.requestId, operationHash)) !== null)
        return { cancelled: true, replayed: true };
      const invitation = await this.record(tx, input.invitationId);
      if (invitation.organizationId !== input.organizationId) throw denied();
      await tx.membership.delete({ where: { id: invitation.member.id }, select: { id: true } });
      await tx.verificationToken.delete({ where: { id: invitation.id }, select: { id: true } });
      await this.audit(
        tx,
        actor,
        input.organizationId,
        invitation.id,
        input.requestId,
        action,
        operationHash,
        { recipientId: invitation.binding.recipient.id, membershipId: invitation.member.id }
      );
      return { cancelled: true, replayed: false };
    });
  }

  private async notificationSnapshot(
    tx: Transaction,
    input: InvitationNoticePayload
  ): Promise<InvitationNotice> {
    const invitation = await this.record(tx, input.invitationId);
    const ids = Array.from(
      new Set([input.actor.id, invitation.binding.issuer.id, invitation.binding.recipient.id])
    ).sort((a, b) => a - b);
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "users" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`
    );
    const { user, org } = await this.admin(tx, input.actor, input.organizationId);
    if (invitation.organizationId !== input.organizationId || invitation.expires <= (await this.now(tx)))
      throw denied();
    await this.admin(tx, invitation.binding.issuer, invitation.organizationId);
    const target = await this.active(tx, invitation.binding.recipient);
    if (!target.emailVerified)
      throw invalid("The recipient email must be verified before sending another notice");
    return {
      invitationId: invitation.id,
      organizationName: org.name,
      from: user.name || "Organization administrator",
      to: target.email,
      locale: target.locale || "en",
    };
  }

  private delivery() {
    return new InvitationNoticeDelivery(this.db, (tx, input) => this.notificationSnapshot(tx, input));
  }

  // Internal worker/route adapters only: the task ID is never a public capability.
  async deliverQueuedNotice(taskId: string, deliver: InvitationNotification) {
    return this.delivery().dispatch(taskId, deliver);
  }
  async consumeQueuedNotice(payload: string, taskId: string, deliver: InvitationNotification) {
    return this.delivery().consume(payload, taskId, deliver);
  }

  async notify(actor: Actor, raw: z.input<typeof invitationAdminInput>, deliver: InvitationNotification) {
    actor = actorSchema.parse(actor);
    const input = invitationAdminInput.parse(raw);
    const action = "organization.invitation.notification-queued";
    const operationHash = hash(actor, action, input);
    const payload: InvitationNoticePayload = { version: 1, actor, ...input };
    const queued = await this.transact(async (tx) => {
      await this.lock(tx, input.organizationId);
      await this.admin(tx, actor, input.organizationId);
      const previous = await this.previous(tx, input.requestId, operationHash);
      if (previous !== null) {
        const task = await tx.task.findUnique({
          where: {
            referenceUid_type: {
              type: invitationNoticeType,
              referenceUid: invitationNoticeReference(payload),
            },
          },
          select: { id: true, attempts: true },
        });
        return task && task.attempts === 0 ? task.id : null;
      }
      await this.notificationSnapshot(tx, payload);
      const where = {
        type: invitationNoticeType,
        referenceUid: { startsWith: invitationNoticePrefix(input.invitationId) },
      };
      const latest = await tx.task.findFirst({
        where,
        select: { createdAt: true },
        orderBy: { createdAt: "desc" },
      });
      const pending = await tx.task.findFirst({
        where: {
          ...where,
          succeededAt: null,
          OR: [
            { attempts: { lt: tx.task.fields.maxAttempts } },
            { lastError: { startsWith: RUNNING_PREFIX } },
            { lastError: { startsWith: UNKNOWN_PREFIX } },
          ],
        },
        select: { id: true },
      });
      if (pending)
        throw invalid("An earlier notification is pending or unconfirmed; reconcile it before another send");
      const attempted = await tx.enterpriseAuditEvent.findFirst({
        where: {
          organizationId: input.organizationId,
          entityId: input.invitationId,
          action: "organization.invitation.notification-attempted",
        },
        select: { createdAt: true },
        orderBy: { createdAt: "desc" },
      });
      const latestTime = Math.max(latest?.createdAt.getTime() ?? 0, attempted?.createdAt.getTime() ?? 0);
      if (latestTime + 60000 > (await this.now(tx)).getTime())
        throw invalid("Wait one minute before another email attempt");
      const taskId = await enqueueInvitationNotice(tx, payload);
      await this.audit(
        tx,
        actor,
        input.organizationId,
        input.invitationId,
        input.requestId,
        action,
        operationHash,
        { notificationTaskId: taskId }
      );
      return taskId;
    });
    if (!queued) return { email: "already_attempted" as const };
    return this.deliverQueuedNotice(queued, deliver);
  }
}
