# Existing-account organization invitations: reuse and consent contract

Baseline: df3c0e0ada125c132f7f5e09439a2c539bb7f64e. Date: 2026-10-14.
The repository, enterprise branch and single task graph remain unchanged.
This document describes the implemented boundary; executed artifact acceptance is
recorded separately. It is not an announcement of a deployed community platform.

## Reuse, not another identity or membership system

The implementation uses retained Membership.accepted, VerificationToken's team
and expiry fields, organization Profiles, Team/OrganizationSettings, the existing
transactional administrative audit, the native authenticated router and the
existing TeamInviteEmail renderer/transport. No schema, package dependency,
scheduler, tenant store, queue service or public MCP server is introduced.

Published Cal API documentation distinguishes direct admission from invitations
and keeps a membership pending until the existing user accepts. That behavior
is a useful contract reference, not permission to transplant restricted older
implementations or hosted subscription logic. This workflow retains that consent
boundary without cloud billing or email-domain automatic acceptance.

The retained joinAnyChildTeamOnOrgInvite helper changes the user's primary
organization and accepts all pending child memberships. It is not used here:
those side effects conflict with additive multi-organization membership and
consent to the specific invitation. Ordinary subteam assignment after acceptance
still uses the existing team administration. New-account enrollment, Authentik
linkage and external directory lifecycle remain separate work.

## State and authority

An active root-organization owner or administrator can invite an active existing
human account as MEMBER. A global platform role without that organization
membership, a child-team role, pending membership or a custom-role ADMIN hint is
not sufficient. Directory-managed roots are protected from these local writes.
The registered account's UUID, not a mutable email in a browser session, binds
acceptance. The email is only the initiating lookup and notification destination.

Issue creates an unaccepted ordinary Membership and a namespaced, expiring
VerificationToken row with the exact membership/recipient/issuer binding. No
organization Profile or booking authority is granted yet. The token field is
randomized and never emitted; it is not an email bearer capability. The emailed
link opens the authenticated invitation inbox, and only a same-origin POST by
the bound current recipient can accept or decline. Loading a URL grants nothing.

Acceptance rechecks the live issuer's authority, recipient identity, exact pending
membership, root policy and seven-day expiry. It adds the specific organization
Profile and accepts only that membership. It does not move personal identities,
calendars, prior profiles or pending child-team memberships. Decline and authorized
cancellation remove only the matching pending records. An old request, cancelled
record, replacement membership or altered role cannot resurrect an invitation.
Expired invites remain explicitly non-actionable until declined/cancelled; replay
cannot extend them. Pagination does not pretend a bounded first page is complete.

Creation, consent/cancellation and their audit records use bounded serializable
transactions. Database failures roll back the corresponding state transition.
The organization row coordinates competing invitation writers; other existing
writers retain their own verification requirements. An already in-flight request
can linearize before a concurrent authority change; this is not a proof of real
IdP propagation or universal cross-service revocation.

## Email is an external effect, not access

Notifications are submitted after commit and use the retained invitation template.
An opt-in strict error path in BaseEmail preserves legacy callers while allowing
this workflow to observe SMTP rejection. The email kill switch still prevents
submission. The self-hosted notice does not claim the upstream cloud vendor is
its support operator. No token or acceptance action is embedded in the URL.

A recorded attempt and bounded resend cooldown prevent accidental rapid retries.
The audit records an attempt, not guaranteed delivery. SMTP acceptance is not
proof of final inbox receipt. A lost response, process crash or uncertain transport
result is shown as unconfirmed; replay does not silently send another message.
A failed notice leaves the invitation pending and visible in the authenticated
inbox. Cancellation prevents future acceptance even when a notice is already in
transit. This is not a durable outbox or exactly-once email-delivery claim; that
broader delivery lifecycle remains under the existing programme.

## Verification and extension requirements

Tests must cover pending versus accepted access, wrong-user/admin/tenant requests,
expiry, changed issuer/recipient identity, cancellation and stale browser buttons,
replay, directory/custom-role restrictions, pagination, audit rollback and actual
SMTP failure. Time comparisons use database epoch milliseconds rather than an
adapter-dependent local timestamp conversion. The real operator and recipient
journeys require distinct verified native sessions, not one privileged test actor
pretending to be both parties.

Future external onboarding must add the authorized account/identity enrollment
and invitation-consent lifecycle, not enable public self-created administrators.
Agent adapters need scoped, revocable client/delegation authorization and must
call shared domain commands; an invitation identifier or confirmation boolean is
not an agent grant. Before an upstream update, validate the namespaced invitation
records against any changed generic VerificationToken consumers and migrations.

Primary public references checked 2026-10-14:
https://cal.com/docs/api-reference/v2/orgs-memberships/create-a-membership
https://nodemailer.com/usage/
Retained source inspected: schema.prisma; membership repositories/services;
auth/signup/utils/organization.ts; emails/templates/team-invite-email.ts;
emails/templates/_base-email.ts; TeamService.ts; native identity validation.
Private research material and restricted historical code were not copied here.
