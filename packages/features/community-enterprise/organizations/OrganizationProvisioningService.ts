// SPDX-License-Identifier: MIT
import { createHash, randomUUID } from "node:crypto";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { Prisma, type PrismaClient } from "@calcom/prisma/client";
import { z } from "zod";

const id = z.number().int().positive();
const slug = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const timeZone = z
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
const person = z.object({ id, uuid: z.string().uuid() }).strict();
const details = z.object({ name: z.string().trim().min(1).max(100), slug, timeZone });
export const reviewOrganizationInput = details
  .extend({
    ownerEmail: z.string().trim().email().max(254),
    memberEmails: z.array(z.string().trim().email().max(254)).max(19).default([]),
  })
  .strict();
export const provisionOrganizationInput = details
  .extend({
    owner: person,
    members: z.array(person).max(19),
    requestId: z.string().uuid(),
  })
  .strict();
export type ProvisionOrganizationInput = z.infer<typeof provisionOrganizationInput>;
export type ProvisioningActor = z.infer<typeof person>;
const userFields = {
  id: true,
  uuid: true,
  email: true,
  name: true,
  username: true,
  locked: true,
  isPlatformManaged: true,
} as const;
const action = "organization.provisioned";
const invalid = (message: string) => new ErrorWithCode(ErrorCode.BadRequest, message);
const denied = () =>
  new ErrorWithCode(
    ErrorCode.Forbidden,
    "Organization admission requires a current active instance operator"
  );
type Transaction = Prisma.TransactionClient;

// Membership and Profile are additive to the existing identity. Provisioning
// must not move personal bookings, attach an IdP identity or grant operator access.
export class OrganizationProvisioningService {
  constructor(private readonly db: PrismaClient) {}

  private async isOperator(tx: Transaction, actor: ProvisioningActor) {
    const user = await tx.user.findUnique({
      where: { id: actor.id },
      select: { uuid: true, role: true, locked: true, isPlatformManaged: true },
    });
    return (
      !!user && user.uuid === actor.uuid && user.role === "ADMIN" && !user.locked && !user.isPlatformManaged
    );
  }

  private async requireOperator(tx: Transaction, actor: ProvisioningActor) {
    if (!(await this.isOperator(tx, actor))) throw denied();
  }

  async capabilities(actor: ProvisioningActor) {
    return { canProvision: await this.isOperator(this.db, person.parse(actor)) };
  }

  async review(actor: ProvisioningActor, raw: unknown) {
    const checked = person.parse(actor);
    const input = reviewOrganizationInput.parse(raw);
    const emails = [input.ownerEmail, ...input.memberEmails].map((email) => email.toLowerCase());
    if (new Set(emails).size !== emails.length) throw invalid("Name each initial account only once");
    return this.db.$transaction(
      async (tx) => {
        await this.requireOperator(tx, checked);
        await this.requireUnusedSlug(tx, input.slug);
        const users = await tx.user.findMany({
          where: { OR: emails.map((email) => ({ email: { equals: email, mode: "insensitive" as const } })) },
          select: userFields,
          take: 21,
        });
        const resolved = emails.map((email) => {
          const matches = users.filter((user) => user.email.toLowerCase() === email);
          if (matches.length !== 1 || matches[0].locked || matches[0].isPlatformManaged)
            throw invalid(
              "Each initial member must resolve to one active existing human account; no accounts or invitations were created"
            );
          return matches[0];
        });
        const [owner, ...members] = resolved;
        const ref = (user: typeof owner) => ({ id: user.id, uuid: user.uuid });
        return {
          input: {
            name: input.name,
            slug: input.slug,
            timeZone: input.timeZone,
            owner: ref(owner),
            members: members.map(ref),
            requestId: randomUUID(),
          },
          accounts: resolved.map((user, index) => ({
            id: user.id,
            name: user.name,
            email: user.email,
            role: index === 0 ? ("OWNER" as const) : ("MEMBER" as const),
          })),
        };
      },
      { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 10000 }
    );
  }

  private async requireUnusedSlug(tx: Transaction, requestedSlug: string) {
    // Root NULL parents are not made unique by the retained compound index.
    // Include pending-payment rows, which the global extension otherwise hides.
    const exists = await tx.team.findFirst({
      where: {
        parentId: null,
        slug: { equals: requestedSlug, mode: "insensitive" },
        pendingPayment: {},
      },
      select: { id: true },
    });
    if (exists) throw invalid("This organization address is already reserved");
  }

  async provision(actor: ProvisioningActor, raw: unknown) {
    const checked = person.parse(actor);
    const parsed = provisionOrganizationInput.parse(raw);
    const input = { ...parsed, members: [...parsed.members].sort((a, b) => a.id - b.id) };
    const targets = [input.owner, ...input.members];
    if (
      new Set(targets.map((target) => target.id)).size !== targets.length ||
      new Set(targets.map((target) => target.uuid)).size !== targets.length
    )
      throw invalid("Name each initial account only once");
    const hash = createHash("sha256")
      .update(JSON.stringify({ version: 1, action, actor: checked, input }))
      .digest("hex");
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT true AS acquired FROM pg_advisory_xact_lock(hashtext('cal.organization.provision.operation'), hashtext(${input.requestId}))`;
            await tx.$queryRaw`SELECT true AS acquired FROM pg_advisory_xact_lock(hashtext('cal.organization.provision.slug'), hashtext(${input.slug}))`;
            const ids = Array.from(new Set([checked.id, ...targets.map((target) => target.id)])).sort(
              (a, b) => a - b
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT id FROM "users" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`
            );
            await this.requireOperator(tx, checked);
            const users = await tx.user.findMany({
              where: { id: { in: targets.map((target) => target.id) } },
              select: userFields,
            });
            for (const target of targets) {
              const user = users.find((row) => row.id === target.id);
              if (!user || user.uuid !== target.uuid || user.locked || user.isPlatformManaged)
                throw invalid("An initial account changed or is unavailable; review the accounts again");
            }
            const roles = targets.map((target) => ({
              ...target,
              role: target.id === input.owner.id ? ("OWNER" as const) : ("MEMBER" as const),
            }));
            const previous = await tx.enterpriseAuditEvent.findUnique({
              where: { operationId: input.requestId },
              select: { action: true, actorUserId: true, operationHash: true, organizationId: true },
            });
            if (previous) {
              if (
                previous.action !== action ||
                previous.actorUserId !== checked.id ||
                previous.operationHash !== hash
              )
                throw invalid("This operation identifier was already used for another request");
              const org = await tx.team.findFirst({
                where: {
                  id: previous.organizationId,
                  slug: input.slug,
                  parentId: null,
                  isOrganization: true,
                  pendingPayment: false,
                },
                select: {
                  id: true,
                  members: { select: { userId: true, role: true, accepted: true, customRoleId: true } },
                  orgProfiles: { select: { userId: true } },
                },
              });
              if (
                !org ||
                roles.some(
                  (target) =>
                    !org.members.some(
                      (member) =>
                        member.userId === target.id &&
                        member.accepted &&
                        member.role === target.role &&
                        member.customRoleId === null
                    ) || !org.orgProfiles.some((profile) => profile.userId === target.id)
                )
              )
                throw invalid(
                  "The previously created organization or admission state changed; refresh rather than recreating it"
                );
              return { organizationId: org.id, replayed: true };
            }
            await this.requireUnusedSlug(tx, input.slug);
            const organization = await tx.team.create({
              data: {
                name: input.name,
                slug: input.slug,
                timeZone: input.timeZone,
                isOrganization: true,
                parentId: null,
                isPrivate: true,
                pendingPayment: false,
                organizationSettings: {
                  create: {
                    orgAutoAcceptEmail: "",
                    orgAutoJoinOnSignup: false,
                    isOrganizationConfigured: true,
                    isOrganizationVerified: false,
                    isAdminReviewed: false,
                    isAdminAPIEnabled: false,
                    allowSEOIndexing: false,
                    orgProfileRedirectsToVerifiedDomain: false,
                  },
                },
              },
              select: { id: true },
            });
            for (const target of roles) {
              const user = users.find((row) => row.id === target.id);
              if (!user) throw invalid("An initial account changed; review again");
              const username =
                user.username && slug.safeParse(user.username).success ? user.username : `member-${user.id}`;
              await tx.membership.create({
                data: { teamId: organization.id, userId: user.id, role: target.role, accepted: true },
                select: { id: true },
              });
              await tx.profile.create({
                data: { uid: randomUUID(), userId: user.id, organizationId: organization.id, username },
                select: { id: true },
              });
            }
            await tx.enterpriseAuditEvent.create({
              data: {
                operationId: input.requestId,
                operationHash: hash,
                actorUserId: checked.id,
                organizationId: organization.id,
                entityId: organization.id,
                action,
                details: {
                  version: 1,
                  ownerUserId: input.owner.id,
                  admissions: roles,
                  automaticDomainAdmission: false,
                  credentialsMoved: false,
                },
              },
              select: { id: true },
            });
            return { organizationId: organization.id, replayed: false };
          },
          { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 }
        );
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        if (attempt < 2 && (code === "P2034" || code === "P2002")) continue;
        if (code === "P2002")
          throw invalid(
            "The address or an organization profile conflicts with an existing record; review again"
          );
        throw error;
      }
    }
  }
}
