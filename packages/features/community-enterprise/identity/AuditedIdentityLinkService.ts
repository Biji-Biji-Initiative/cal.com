// SPDX-License-Identifier: MIT
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { Prisma, type PrismaClient } from "@calcom/prisma/client";
import { authentikAccountId } from "./AuthentikConfig";
import {
  digest,
  type IdentityLinkPlan,
  type IdentityLinkRequest,
  identityLinkRequest,
  LINK_PLAN_TTL,
  type LinkRow,
  type LinkTarget,
  linkPlanSchema,
} from "./IdentityLinkPlan";
import { linkAuthentikAccount } from "./LinkAuthentikAccount";

const invalid = (message: string) => new ErrorWithCode(ErrorCode.BadRequest, message);
const forbidden = () =>
  new ErrorWithCode(
    ErrorCode.Forbidden,
    "Identity linkage requires the reviewed active instance operator and organization members"
  );
const action = "identity.authentik.linked";

// Operator workflow, not a web endpoint. Organization administration alone must
// not allow a caller to attach a new identity to another person's sign-in.
export class AuditedIdentityLinkService {
  private readonly target: LinkTarget;
  constructor(
    private readonly db: PrismaClient,
    target: LinkTarget,
    private readonly now = Date.now
  ) {
    const issuer = new URL(target.issuer);
    const origin = new URL(target.webOrigin);
    if (
      issuer.protocol !== "https:" ||
      issuer.username ||
      issuer.password ||
      issuer.search ||
      issuer.hash ||
      origin.protocol !== "https:" ||
      origin.origin !== target.webOrigin ||
      !/^[a-f0-9]{64}$/.test(target.databaseFingerprint)
    ) {
      throw invalid("An explicit HTTPS issuer, application origin and database fingerprint are required");
    }
    this.target = {
      issuer: target.issuer.replace(/\/$/, ""),
      webOrigin: target.webOrigin,
      databaseFingerprint: target.databaseFingerprint,
    };
  }

  private request(input: unknown) {
    const parsed = identityLinkRequest.parse(input);
    parsed.links.sort((a, b) => a.userId - b.userId);
    return parsed;
  }

  private async snapshot(tx: Prisma.TransactionClient, request: IdentityLinkRequest) {
    const actor = await tx.user.findUnique({
      where: { id: request.actorUserId },
      select: { id: true, uuid: true, role: true, locked: true },
    });
    if (!actor || actor.uuid !== request.actorUuid || actor.role !== "ADMIN" || actor.locked !== false)
      throw forbidden();
    const organization = await tx.team.findUnique({
      where: { id: request.organizationId },
      select: { id: true, slug: true, isOrganization: true, parentId: true },
    });
    if (
      !organization?.isOrganization ||
      organization.parentId !== null ||
      organization.slug !== request.organizationSlug
    )
      throw forbidden();
    const users = await tx.user.findMany({
      where: { id: { in: request.links.map((link) => link.userId) } },
      select: { id: true, uuid: true, locked: true },
    });
    const memberships = await tx.membership.findMany({
      where: {
        teamId: request.organizationId,
        userId: { in: [request.actorUserId, ...request.links.map((link) => link.userId)] },
      },
      select: { userId: true, accepted: true },
    });
    if (!memberships.some((membership) => membership.userId === actor.id && membership.accepted))
      throw forbidden();
    const rows: LinkRow[] = [];
    for (const link of request.links) {
      const user = users.find((entry) => entry.id === link.userId);
      if (
        !user ||
        user.uuid !== link.userUuid ||
        user.locked !== false ||
        !memberships.some((membership) => membership.userId === user.id && membership.accepted)
      )
        throw forbidden();
      const accountId = authentikAccountId(this.target.issuer, link.subject);
      const otherBinding = await tx.account.findFirst({
        where: { userId: user.id, provider: "authentik", providerAccountId: { not: accountId } },
        select: { id: true },
      });
      if (otherBinding)
        throw invalid("The user already has another Authentik identity; explicit correction is required");
      const existing = await tx.account.findUnique({
        where: { provider_providerAccountId: { provider: "authentik", providerAccountId: accountId } },
        select: { id: true, userId: true, type: true },
      });
      if (existing && (existing.userId !== user.id || existing.type !== "oauth"))
        throw invalid("The subject is bound to a different account");
      rows.push({ userId: user.id, userUuid: user.uuid, accountId, bindingId: existing?.id ?? null });
    }
    return { rows, snapshotHash: digest({ actor, organization, rows }) };
  }

  async plan(input: unknown): Promise<IdentityLinkPlan> {
    const request = this.request(input);
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const { rows, snapshotHash } = await this.snapshot(tx, request);
        const issuedAt = this.now();
        const plan = {
          version: 1 as const,
          requestHash: digest(request),
          targetHash: digest(this.target),
          snapshotHash,
          issuedAt,
          expiresAt: issuedAt + LINK_PLAN_TTL,
          rows,
        };
        return { ...plan, planHash: digest(plan) };
      },
      { isolationLevel: "RepeatableRead", timeout: 10000, maxWait: 5000 }
    );
  }

  async apply(input: unknown, reviewed: unknown) {
    const request = this.request(input);
    const plan = linkPlanSchema.parse(reviewed);
    const { planHash, ...unsigned } = plan;
    if (
      digest(unsigned) !== planHash ||
      plan.requestHash !== digest(request) ||
      plan.targetHash !== digest(this.target) ||
      plan.expiresAt <= this.now() ||
      plan.issuedAt > this.now() ||
      plan.expiresAt - plan.issuedAt !== LINK_PLAN_TTL
    ) {
      throw invalid("The reviewed plan is expired, changed or belongs to another target");
    }
    const operationHash = digest({ action, requestHash: plan.requestHash, targetHash: plan.targetHash });
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            // Serialize duplicate operations, then user mutations in stable order.
            // A concurrent account lock or role update must wait for these rows.
            await tx.$queryRaw`SELECT true AS acquired FROM pg_advisory_xact_lock(hashtext('cal.identity.link'), hashtext(${request.operationId}))`;
            const ids = Array.from(
              new Set([request.actorUserId, ...request.links.map((link) => link.userId)])
            ).sort((a, b) => a - b);
            await tx.$queryRaw(
              Prisma.sql`SELECT id FROM "users" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`
            );
            await tx.$queryRaw`SELECT id FROM "Team" WHERE id = ${request.organizationId} FOR SHARE`;
            await tx.$queryRaw(
              Prisma.sql`SELECT id FROM "Membership" WHERE "teamId" = ${request.organizationId} AND "userId" IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`
            );
            const accountIds = request.links.map((link) =>
              authentikAccountId(this.target.issuer, link.subject)
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT id FROM "Account" WHERE provider = 'authentik' AND "providerAccountId" IN (${Prisma.join(accountIds)}) ORDER BY id FOR UPDATE`
            );
            if (plan.expiresAt <= this.now())
              throw invalid("The reviewed plan expired while waiting for its transaction");
            const current = await this.snapshot(tx, request);
            const prior = await tx.enterpriseAuditEvent.findUnique({
              where: { operationId: request.operationId },
              select: { operationHash: true, action: true, details: true },
            });
            if (prior) {
              const saved = prior.details as {
                bindings?: { userId: number; accountId: string; bindingId: string }[];
              } | null;
              if (
                prior.action !== action ||
                prior.operationHash !== operationHash ||
                !Array.isArray(saved?.bindings) ||
                saved.bindings.length !== current.rows.length ||
                !current.rows.every((row) =>
                  saved.bindings?.some(
                    (binding) =>
                      binding.userId === row.userId &&
                      binding.accountId === row.accountId &&
                      binding.bindingId === row.bindingId
                  )
                )
              ) {
                throw invalid("The recorded operation conflicts or a binding has since been revoked");
              }
              return {
                status: "replayed" as const,
                operationId: request.operationId,
                bindings: saved.bindings,
              };
            }
            if (current.snapshotHash !== plan.snapshotHash || digest(current.rows) !== digest(plan.rows))
              throw invalid("Account state changed after review; create a new plan");
            const bindings: { userId: number; accountId: string; bindingId: string; created: boolean }[] = [];
            for (const link of request.links) {
              const result = await linkAuthentikAccount(
                tx,
                { issuer: this.target.issuer },
                { userId: link.userId, expectedUserUuid: link.userUuid, subject: link.subject },
                true
              );
              if (result.status === "would_link") throw invalid("Link operation did not apply");
              bindings.push({
                userId: result.userId,
                accountId: result.accountId,
                bindingId: result.bindingId,
                created: result.status === "linked",
              });
            }
            await tx.enterpriseAuditEvent.create({
              data: {
                operationId: request.operationId,
                operationHash,
                actorUserId: request.actorUserId,
                organizationId: request.organizationId,
                action,
                details: { planHash, targetHash: plan.targetHash, bindings },
              },
              select: { id: true },
            });
            return { status: "applied" as const, operationId: request.operationId, bindings };
          },
          { isolationLevel: "ReadCommitted", timeout: 10000, maxWait: 5000 }
        );
      } catch (error) {
        if (
          attempt < 2 &&
          error &&
          typeof error === "object" &&
          "code" in error &&
          (error.code === "P2002" || error.code === "P2034")
        )
          continue;
        throw error;
      }
    }
  }
}
