// SPDX-License-Identifier: MIT
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { Prisma, PrismaClient } from "@calcom/prisma/client";
import { z } from "zod";
import { authentikAccountId } from "./AuthentikConfig";
import { digest, LINK_PLAN_TTL, type LinkTarget, linkPlanSchema } from "./IdentityLinkPlan";
import { linkAuthentikAccount } from "./LinkAuthentikAccount";

const purpose = "existing-instance-operator-self-link";
const action = "identity.authentik.operator-self-linked";
const requestSchema = z
  .object({
    operationId: z.string().uuid(),
    actorUserId: z.number().int().positive().safe(),
    actorUuid: z.string().uuid(),
    subject: z.string().min(1).max(1024),
  })
  .strict();
const planSchema = linkPlanSchema.extend({ purpose: z.literal(purpose) });
type Request = z.infer<typeof requestSchema>;
interface Target extends LinkTarget {
  databaseName: string;
  nativeOnly: boolean;
}
const refused = () =>
  new ErrorWithCode(
    ErrorCode.Forbidden,
    "Self-link requires the reviewed existing dev instance operator before organization admission"
  );

export async function existingOperatorDatabaseIdentity(db: Pick<Prisma.TransactionClient, "$queryRaw">) {
  const [identity] = await db.$queryRaw<
    {
      database: string;
      databaseOid: string;
      role: string;
      address: string | null;
      serverPort: number | null;
      serverStarted: string;
    }[]
  >`SELECT current_database()::text AS database,
    (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS "databaseOid",
    current_user::text AS role, inet_server_addr()::text AS address, inet_server_port() AS "serverPort",
    extract(epoch FROM pg_postmaster_start_time())::text AS "serverStarted"`;
  if (!identity) throw refused();
  return { database: identity.database, fingerprint: digest(identity) };
}

// Database-operator CLI only. This preserves an existing ADMIN; it cannot create
// the first user, promote a user, or link anybody other than that same operator.
export class ExistingOperatorSelfLinkService {
  private readonly target: Target;
  constructor(
    private readonly db: PrismaClient,
    target: Target,
    private readonly now = Date.now
  ) {
    const issuer = new URL(target.issuer);
    if (
      target.webOrigin !== "https://cal.mereka.dev" ||
      target.nativeOnly !== true ||
      !/^[A-Za-z0-9_-]{1,63}$/.test(target.databaseName) ||
      !/^[a-f0-9]{64}$/.test(target.databaseFingerprint) ||
      issuer.protocol !== "https:" ||
      issuer.username ||
      issuer.password ||
      issuer.search ||
      issuer.hash ||
      issuer.pathname === "/"
    )
      throw refused();
    this.target = { ...target, issuer: target.issuer.replace(/\/$/, "") };
  }

  private async snapshot(tx: Prisma.TransactionClient, request: Request) {
    const identity = await existingOperatorDatabaseIdentity(tx);
    if (
      identity.database !== this.target.databaseName ||
      identity.fingerprint !== this.target.databaseFingerprint
    )
      throw refused();
    const actor = await tx.user.findUnique({
      where: { id: request.actorUserId },
      select: { id: true, uuid: true, role: true, locked: true, isPlatformManaged: true },
    });
    if (
      !actor ||
      actor.uuid !== request.actorUuid ||
      actor.role !== "ADMIN" ||
      actor.locked !== false ||
      actor.isPlatformManaged !== false
    )
      throw refused();
    if ((await tx.team.count({ where: { isOrganization: true } })) !== 0) throw refused();
    const accountId = authentikAccountId(this.target.issuer, request.subject);
    const other = await tx.account.findFirst({
      where: { userId: actor.id, provider: "authentik", providerAccountId: { not: accountId } },
      select: { id: true },
    });
    if (other) throw refused();
    const binding = await tx.account.findUnique({
      where: { provider_providerAccountId: { provider: "authentik", providerAccountId: accountId } },
      select: { id: true, userId: true, type: true },
    });
    if (binding && (binding.userId !== actor.id || binding.type !== "oauth")) throw refused();
    const row = { userId: actor.id, userUuid: actor.uuid, accountId, bindingId: binding?.id ?? null };
    return { row, snapshotHash: digest({ actor, organizations: 0, row }) };
  }

  async plan(raw: unknown) {
    const request = requestSchema.parse(raw);
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const current = await this.snapshot(tx, request);
        const issuedAt = this.now();
        const plan = {
          version: 1 as const,
          requestHash: digest(request),
          targetHash: digest(this.target),
          snapshotHash: current.snapshotHash,
          issuedAt,
          expiresAt: issuedAt + LINK_PLAN_TTL,
          rows: [current.row],
          purpose,
        };
        return { ...plan, planHash: digest(plan) };
      },
      { isolationLevel: "RepeatableRead", timeout: 10000, maxWait: 5000 }
    );
  }

  async apply(raw: unknown, reviewed: unknown) {
    const request = requestSchema.parse(raw);
    const plan = planSchema.parse(reviewed);
    const { planHash, ...unsigned } = plan;
    if (
      digest(unsigned) !== planHash ||
      plan.requestHash !== digest(request) ||
      plan.targetHash !== digest(this.target) ||
      plan.expiresAt <= this.now() ||
      plan.issuedAt > this.now() ||
      plan.expiresAt - plan.issuedAt !== LINK_PLAN_TTL ||
      plan.rows.length !== 1
    )
      throw refused();
    const accountId = authentikAccountId(this.target.issuer, request.subject);
    const operationHash = digest({ action, requestHash: plan.requestHash, targetHash: plan.targetHash });
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT true AS acquired FROM pg_advisory_xact_lock(hashtext('cal.identity.self-link'), hashtext(${request.operationId}))`;
        // Refuse an active organization writer instead of racing the no-org guard.
        // Keep Team-before-user ordering consistent with organization operations.
        await tx.$executeRaw`LOCK TABLE "Team" IN SHARE MODE NOWAIT`;
        await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${request.actorUserId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "Account" WHERE provider = 'authentik' AND "providerAccountId" = ${accountId} FOR UPDATE`;
        if (plan.expiresAt <= this.now()) throw refused();
        const current = await this.snapshot(tx, request);
        const prior = await tx.enterpriseAuditEvent.findUnique({
          where: { operationId: request.operationId },
          select: {
            action: true,
            operationHash: true,
            actorUserId: true,
            organizationId: true,
            details: true,
          },
        });
        if (prior) {
          const saved = z
            .object({
              version: z.literal(1),
              purpose: z.literal(purpose),
              authority: z.literal("existing-instance-database-operator"),
              planHash: z.string().regex(/^[a-f0-9]{64}$/),
              requestHash: z.string(),
              targetHash: z.string(),
              bindingId: z.string().min(1),
              accountId: z.string(),
            })
            .strict()
            .safeParse(prior.details);
          if (
            prior.action !== action ||
            prior.operationHash !== operationHash ||
            prior.actorUserId !== request.actorUserId ||
            prior.organizationId !== 0 ||
            !saved.success ||
            saved.data.planHash !== planHash ||
            saved.data.requestHash !== plan.requestHash ||
            saved.data.targetHash !== plan.targetHash ||
            saved.data.accountId !== accountId ||
            current.row.accountId !== accountId ||
            current.row.bindingId !== saved.data.bindingId
          )
            throw refused();
          return {
            status: "replayed" as const,
            operationId: request.operationId,
            bindings: [{ userId: request.actorUserId, accountId, bindingId: saved.data.bindingId }],
          };
        }
        if (current.snapshotHash !== plan.snapshotHash || digest([current.row]) !== digest(plan.rows))
          throw refused();
        const binding = await linkAuthentikAccount(
          tx,
          this.target,
          { userId: request.actorUserId, expectedUserUuid: request.actorUuid, subject: request.subject },
          true
        );
        if (binding.status === "would_link") throw refused();
        await tx.enterpriseAuditEvent.create({
          data: {
            operationId: request.operationId,
            operationHash,
            actorUserId: request.actorUserId,
            organizationId: 0,
            entityId: request.actorUserId,
            action,
            details: {
              version: 1,
              purpose,
              authority: "existing-instance-database-operator",
              planHash,
              requestHash: plan.requestHash,
              targetHash: plan.targetHash,
              accountId,
              bindingId: binding.bindingId,
            },
          },
          select: { id: true },
        });
        return {
          status: "applied" as const,
          operationId: request.operationId,
          bindings: [{ userId: request.actorUserId, accountId, bindingId: binding.bindingId }],
        };
      },
      { isolationLevel: "ReadCommitted", timeout: 10000, maxWait: 5000 }
    );
  }
}
