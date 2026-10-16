// SPDX-License-Identifier: MIT
import { randomUUID } from "node:crypto";
import type { Prisma } from "@calcom/prisma/client";
import { z } from "zod";

const id = z.number().int().positive().safe();
export const invitationNoticeType = "organizationInvitation" as const;
export const invitationNoticePayload = z
  .object({
    version: z.literal(1),
    actor: z.object({ id, uuid: z.string().uuid() }).strict(),
    organizationId: id,
    invitationId: id,
    requestId: z.string().uuid(),
  })
  .strict();
export type InvitationNoticePayload = z.infer<typeof invitationNoticePayload>;
export const invitationNoticePrefix = (invitationId: number) => `organization-invitation:${invitationId}:`;
export const invitationNoticeReference = (payload: InvitationNoticePayload) =>
  `${invitationNoticePrefix(payload.invitationId)}${payload.requestId}`;
export const noticeOutcomeId = (taskId: string) => `organization-invitation:${taskId}:outcome`;

// Use the caller's mutation transaction. The task holds identity references,
// never an email address, provider secret or an invitation bearer capability.
export async function enqueueInvitationNotice(tx: Prisma.TransactionClient, raw: InvitationNoticePayload) {
  const payload = invitationNoticePayload.parse(raw);
  const task = await tx.task.create({
    data: {
      id: randomUUID(),
      type: invitationNoticeType,
      payload: JSON.stringify(payload),
      referenceUid: invitationNoticeReference(payload),
      maxAttempts: 3,
    },
    select: { id: true },
  });
  return task.id;
}
