// SPDX-License-Identifier: MIT
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { Prisma, PrismaClient } from "@calcom/prisma/client";
import { z } from "zod";
import { authentikAccountId } from "./AuthentikConfig";
import { digest, LINK_PLAN_TTL, type LinkTarget } from "./IdentityLinkPlan";
import { linkAuthentikAccount } from "./LinkAuthentikAccount";

const action = "identity.preview.operator.bootstrapped";
const invalid = () =>
  new ErrorWithCode(ErrorCode.Forbidden, "Preview bootstrap requires the reviewed empty isolated target");
export const previewOperatorRequest = z
  .object({
    operationId: z.string().uuid(),
    operatorUuid: z.string().uuid(),
    subject: z.string().min(1).max(1024),
    name: z.string().trim().min(1).max(100),
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    username: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const planSchema = z
  .object({
    version: z.literal(1),
    purpose: z.literal("isolated-preview-first-operator"),
    requestHash: hash,
    targetHash: hash,
    issuedAt: z.number().int().nonnegative().safe(),
    expiresAt: z.number().int().positive().safe(),
    rows: z.array(z.object({ userUuid: z.string().uuid(), accountId: hash }).strict()).length(1),
    planHash: hash,
  })
  .strict();
export interface PreviewBootstrapTarget extends LinkTarget {
  databaseName: string;
  nativeOnly: boolean;
}

// Invoked only by the privileged operator CLI, never a sign-in/setup route.
// Account creation must precede existing-account linking and org admission on a
// fresh preview, without temporarily reopening password signup or first-login promotion.
export class PreviewOperatorBootstrap {
  private readonly target: PreviewBootstrapTarget;
  constructor(
    private readonly db: PrismaClient,
    target: PreviewBootstrapTarget,
    private readonly now = Date.now
  ) {
    const issuer = new URL(target.issuer);
    if (
      target.webOrigin !== "https://cal.mereka.dev" ||
      target.nativeOnly !== true ||
      !/^cal_enterprise_preview(?:_[a-z0-9]+)*$/.test(target.databaseName) ||
      !/^[a-f0-9]{64}$/.test(target.databaseFingerprint) ||
      issuer.protocol !== "https:" ||
      issuer.username ||
      issuer.password ||
      issuer.search ||
      issuer.hash
    )
      throw invalid();
    this.target = { ...target, issuer: target.issuer.replace(/\/$/, "") };
  }

  private async requireTarget(tx: Prisma.TransactionClient) {
    const [identity] = await tx.$queryRaw<
      { database: string }[]
    >`SELECT current_database()::text AS database`;
    if (identity?.database !== this.target.databaseName) throw invalid();
  }

  private async requireEmpty(tx: Prisma.TransactionClient) {
    // Query physical tables: ORM filters must not hide pending organizations or
    // orphaned application data from the first-operator safety decision.
    const [state] = await tx.$queryRaw<{ occupied: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM "users") OR EXISTS(SELECT 1 FROM "Account")
        OR EXISTS(SELECT 1 FROM "Team") OR EXISTS(SELECT 1 FROM "Membership")
        OR EXISTS(SELECT 1 FROM "Profile") OR EXISTS(SELECT 1 FROM "Credential")
        OR EXISTS(SELECT 1 FROM "EventType") OR EXISTS(SELECT 1 FROM "Booking")
        OR EXISTS(SELECT 1 FROM "ApiKey") OR EXISTS(SELECT 1 FROM "EnterpriseAuditEvent")
        OR EXISTS(SELECT 1 FROM "Webhook") OR EXISTS(SELECT 1 FROM "DestinationCalendar")
        OR EXISTS(SELECT 1 FROM "DelegationCredential") AS occupied`;
    if (state?.occupied !== false) throw invalid();
  }

  async plan(raw: unknown) {
    const request = previewOperatorRequest.parse(raw);
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await this.requireTarget(tx);
        await this.requireEmpty(tx);
        const issuedAt = this.now();
        const plan = {
          version: 1 as const,
          purpose: "isolated-preview-first-operator" as const,
          requestHash: digest(request),
          targetHash: digest(this.target),
          issuedAt,
          expiresAt: issuedAt + LINK_PLAN_TTL,
          rows: [
            {
              userUuid: request.operatorUuid,
              accountId: authentikAccountId(this.target.issuer, request.subject),
            },
          ],
        };
        return { ...plan, planHash: digest(plan) };
      },
      { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 10000 }
    );
  }

  async apply(raw: unknown, reviewed: unknown) {
    const request = previewOperatorRequest.parse(raw);
    const plan = planSchema.parse(reviewed);
    const { planHash, ...unsigned } = plan;
    const accountId = authentikAccountId(this.target.issuer, request.subject);
    if (
      digest(unsigned) !== planHash ||
      plan.requestHash !== digest(request) ||
      plan.targetHash !== digest(this.target) ||
      plan.expiresAt <= this.now() ||
      plan.issuedAt > this.now() ||
      plan.expiresAt - plan.issuedAt !== LINK_PLAN_TTL ||
      plan.rows[0].userUuid !== request.operatorUuid ||
      plan.rows[0].accountId !== accountId
    )
      throw invalid();
    const operationHash = digest({ action, requestHash: plan.requestHash, targetHash: plan.targetHash });
    return this.db.$transaction(
      async (tx) => {
        // Check the actual connection even when invoked directly as a service.
        await this.requireTarget(tx);
        // Empty-table checks alone race another signup or bootstrap. These brief
        // preview-only locks block writers; NOWAIT refuses contention rather than
        // waiting behind or deadlocking a live application's transaction.
        await tx.$executeRaw`LOCK TABLE "Team", "users", "Membership", "Profile", "Account",
        "Credential", "EventType", "Booking", "ApiKey", "EnterpriseAuditEvent",
        "Webhook", "DestinationCalendar", "DelegationCredential"
        IN SHARE ROW EXCLUSIVE MODE NOWAIT`;
        if (plan.expiresAt <= this.now()) throw invalid();
        const prior = await tx.enterpriseAuditEvent.findUnique({
          where: { operationId: request.operationId },
          select: { action: true, operationHash: true, actorUserId: true, details: true },
        });
        if (prior) {
          const details = z
            .object({ bindingId: z.string(), operatorUuid: z.string() })
            .safeParse(prior.details);
          const binding = await tx.account.findUnique({
            where: { provider_providerAccountId: { provider: "authentik", providerAccountId: accountId } },
            select: {
              id: true,
              type: true,
              userId: true,
              user: {
                select: {
                  uuid: true,
                  locked: true,
                  role: true,
                  email: true,
                  username: true,
                  isPlatformManaged: true,
                },
              },
            },
          });
          if (
            prior.action !== action ||
            prior.operationHash !== operationHash ||
            !details.success ||
            !binding?.user ||
            binding.type !== "oauth" ||
            binding.id !== details.data.bindingId ||
            binding.userId !== prior.actorUserId ||
            details.data.operatorUuid !== request.operatorUuid ||
            binding.user.uuid !== request.operatorUuid ||
            binding.user.locked ||
            binding.user.role !== "ADMIN" ||
            binding.user.isPlatformManaged ||
            binding.user.email !== request.email ||
            binding.user.username !== request.username
          )
            throw invalid();
          return {
            status: "replayed" as const,
            operationId: request.operationId,
            userId: binding.userId,
            userUuid: request.operatorUuid,
          };
        }
        await this.requireEmpty(tx);
        const user = await tx.user.create({
          data: {
            uuid: request.operatorUuid,
            name: request.name,
            email: request.email,
            username: request.username,
            role: "ADMIN",
            locked: false,
            isPlatformManaged: false,
            timeZone: "UTC",
            completedOnboarding: false,
            allowSEOIndexing: false,
            receiveMonthlyDigestEmail: false,
          },
          select: { id: true, uuid: true },
        });
        const binding = await linkAuthentikAccount(
          tx,
          this.target,
          {
            userId: user.id,
            expectedUserUuid: user.uuid,
            subject: request.subject,
          },
          true
        );
        if (binding.status !== "linked") throw invalid();
        await tx.enterpriseAuditEvent.create({
          data: {
            operationId: request.operationId,
            operationHash,
            action,
            actorUserId: user.id,
            entityId: user.id,
            organizationId: 0,
            details: {
              version: 1,
              authority: "out-of-band-database-operator",
              operatorUuid: user.uuid,
              bindingId: binding.bindingId,
              accountId,
              requestHash: plan.requestHash,
              targetHash: plan.targetHash,
              priorApplicationActor: false,
              passwordCreated: false,
              emailVerificationAsserted: false,
            },
          },
          select: { id: true },
        });
        return {
          status: "applied" as const,
          operationId: request.operationId,
          userId: user.id,
          userUuid: user.uuid,
        };
      },
      { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 }
    );
  }
}
