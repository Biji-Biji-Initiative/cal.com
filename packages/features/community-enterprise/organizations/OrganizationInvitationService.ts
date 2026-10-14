// SPDX-License-Identifier: MIT
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { Prisma, PrismaClient } from "@calcom/prisma/client";
import { z } from "zod";

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
const PREFIX = "cal.enterprise.invite.v1:";
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
  username: true,
  locale: true,
} as const;
const denied = () => new ErrorWithCode(ErrorCode.Forbidden, "You cannot act on this organization invitation");
const invalid = (message: string) => new ErrorWithCode(ErrorCode.BadRequest, message);
const prefixFor = (uuid: string) => `${PREFIX}${uuid}:`;
function envelope(identifier: string) {
  if (!identifier.startsWith(PREFIX)) throw denied();
  const end = identifier.indexOf(":", PREFIX.length);
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
    if (!user || user.uuid !== actor.uuid || user.locked || user.isPlatformManaged) throw denied();
    return user;
  }
  private async root(tx: Transaction, organizationId: number) {
    const org = await tx.team.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        parentId: true,
        isOrganization: true,
        pendingPayment: true,
        dsyncTeamGroupMapping: { select: { id: true }, take: 1 },
      },
    });
    if (!org?.isOrganization || org.parentId !== null || org.pendingPayment) throw denied();
    if (org.dsyncTeamGroupMapping.length)
      throw invalid("Directory-managed invitations must be changed in the directory");
    return org;
  }
  private async admin(tx: Transaction, actor: Actor, organizationId: number) {
    const user = await this.active(tx, actor);
    const org = await this.root(tx, organizationId);
    const member = await tx.membership.findUnique({
      where: { userId_teamId: { userId: actor.id, teamId: organizationId } },
      select: { accepted: true, role: true, customRoleId: true },
    });
    if (!member?.accepted || member.customRoleId !== null || !["ADMIN", "OWNER"].includes(member.role))
      throw denied();
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
    const binding = envelope(row.identifier);
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
        return { invitationId: existing.id, expires: existing.expires, replayed: true };
      }
      const matches = await tx.user.findMany({
        where: { email: { equals: input.email, mode: "insensitive" } },
        select: userFields,
        take: 2,
      });
      const target = matches[0];
      if (matches.length !== 1 || !target || target.locked || target.isPlatformManaged)
        throw invalid(
          "Invite one active existing account. New-account enrollment must be completed separately."
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
      await this.audit(
        tx,
        actor,
        input.organizationId,
        invitation.id,
        input.requestId,
        action,
        operationHash,
        {
          recipientId: target.id,
          membershipId: membership.id,
          role: "MEMBER",
          expires: expires.toISOString(),
        }
      );
      return { invitationId: invitation.id, expires, replayed: false };
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
        const items = [];
        const now = await this.now(tx);
        for (const row of rows.slice(0, 50)) {
          try {
            const invitation = await this.record(tx, row.id);
            if (
              input.organizationId === undefined &&
              (invitation.binding.recipient.id !== actor.id ||
                invitation.binding.recipient.uuid !== actor.uuid)
            )
              continue;
            const recipient = await this.active(tx, invitation.binding.recipient);
            const org = await this.root(tx, invitation.organizationId);
            let actionable = invitation.expires > now;
            try {
              await this.admin(tx, invitation.binding.issuer, invitation.organizationId);
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
            if (
              !(error instanceof ErrorWithCode) &&
              !(error instanceof z.ZodError) &&
              !(error instanceof SyntaxError)
            )
              throw error;
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

  async notify(actor: Actor, raw: z.input<typeof invitationAdminInput>, deliver: InvitationNotification) {
    actor = actorSchema.parse(actor);
    const input = invitationAdminInput.parse(raw);
    const action = "organization.invitation.notification-attempted";
    const operationHash = hash(actor, action, input);
    const notice = await this.transact(async (tx) => {
      await this.lock(tx, input.organizationId);
      const { user, org } = await this.admin(tx, actor, input.organizationId);
      if ((await this.previous(tx, input.requestId, operationHash)) !== null) return null;
      const invitation = await this.record(tx, input.invitationId);
      if (invitation.organizationId !== input.organizationId || invitation.expires <= (await this.now(tx)))
        throw denied();
      await this.admin(tx, invitation.binding.issuer, invitation.organizationId);
      const target = await this.active(tx, invitation.binding.recipient);
      const previous = await tx.enterpriseAuditEvent.findFirst({
        where: { entityId: input.invitationId, action },
        select: { createdAt: true },
        orderBy: { createdAt: "desc" },
      });
      if (previous && previous.createdAt.getTime() + 60000 > (await this.now(tx)).getTime())
        throw invalid("Wait one minute before another email attempt");
      await this.audit(
        tx,
        actor,
        input.organizationId,
        invitation.id,
        input.requestId,
        action,
        operationHash,
        { recipientId: target.id }
      );
      return {
        invitationId: invitation.id,
        organizationName: org.name,
        from: user.name || "Organization administrator",
        to: target.email,
        locale: target.locale || "en",
      };
    });
    // No SMTP inside a retryable database transaction. The audit says attempted,
    // not delivered. A crash/ambiguous result is not silently sent a second time.
    if (!notice) return { email: "already_attempted" as const };
    try {
      return { email: await deliver(notice) };
    } catch {
      return { email: "unconfirmed" as const };
    }
  }
}
