// SPDX-License-Identifier: MIT
import TeamInviteEmail from "@calcom/emails/templates/team-invite-email";
import { getTranslation } from "@calcom/i18n/server";
import { WEBAPP_URL } from "@calcom/lib/constants";
import type { InvitationNotification } from "./OrganizationInvitationService";

// Reuse the existing organization invitation email and configured transport.
// The link is an authenticated inbox, not a credential or an accept-on-GET URL.
export const sendOrganizationInvitationNotice: InvitationNotification = async (notice) => {
  const language = await getTranslation(notice.locale, "common");
  const mail = new TeamInviteEmail({
    language,
    from: notice.from,
    to: notice.to,
    teamName: notice.organizationName,
    joinLink: `${WEBAPP_URL}/settings/enterprise/teams`,
    isCalcomMember: true,
    isAutoJoin: false,
    hideHostedSupport: true,
    isOrg: true,
    parentTeamName: undefined,
    isExistingUserMovedToOrg: false,
    prevLink: null,
    newLink: null,
  });
  const result = await mail.sendEmail({ throwOnError: true });
  // The base sender's kill switch and test bypass deliberately do not submit
  // mail. SMTP acceptance itself is still not proof of final inbox delivery.
  return result === "send mail async" ? "submitted" : "not_sent";
};
