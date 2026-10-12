// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { z } from "zod";

const id = z.number().int().positive().safe();
export const identityLinkRequest = z
  .object({
    operationId: z.string().uuid(),
    actorUserId: id,
    actorUuid: z.string().uuid(),
    organizationId: id,
    organizationSlug: z.string().min(1).max(100),
    links: z
      .array(
        z.object({ userId: id, userUuid: z.string().uuid(), subject: z.string().min(1).max(1024) }).strict()
      )
      .min(1)
      .max(25),
  })
  .strict()
  .superRefine((request, ctx) => {
    if (
      new Set(request.links.map((link) => link.userId)).size !== request.links.length ||
      new Set(request.links.map((link) => link.subject)).size !== request.links.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate user or subject in identity-link request",
      });
    }
  });
export type IdentityLinkRequest = z.infer<typeof identityLinkRequest>;
export interface LinkTarget {
  issuer: string;
  webOrigin: string;
  databaseFingerprint: string;
}
export interface LinkRow {
  userId: number;
  userUuid: string;
  accountId: string;
  bindingId: string | null;
}
export interface IdentityLinkPlan {
  version: 1;
  requestHash: string;
  targetHash: string;
  snapshotHash: string;
  issuedAt: number;
  expiresAt: number;
  rows: LinkRow[];
  planHash: string;
}
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const LINK_PLAN_TTL = 15 * 60 * 1000;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const linkPlanSchema = z
  .object({
    version: z.literal(1),
    requestHash: hash,
    targetHash: hash,
    snapshotHash: hash,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    rows: z
      .array(
        z
          .object({
            userId: id,
            userUuid: z.string().uuid(),
            accountId: hash,
            bindingId: z.string().min(1).nullable(),
          })
          .strict()
      )
      .min(1)
      .max(25),
    planHash: hash,
  })
  .strict();
