// SPDX-License-Identifier: MIT
import { OrganizationInvitationService } from "@calcom/features/community-enterprise/organizations/OrganizationInvitationService";
import { sendOrganizationInvitationNotice } from "@calcom/features/community-enterprise/organizations/sendOrganizationInvitationNotice";
import prisma from "@calcom/prisma";
import { TaskOutcomeUnknownError } from "../execution";

// Both cron and the request's opportunistic path run under an owned Task claim.
// Missing or stale identity is never repaired from an email address in a payload.
export async function organizationInvitation(payload: string, taskId?: string): Promise<void> {
  if (!taskId) throw new TaskOutcomeUnknownError();
  await new OrganizationInvitationService(prisma).consumeQueuedNotice(
    payload,
    taskId,
    sendOrganizationInvitationNotice
  );
}
