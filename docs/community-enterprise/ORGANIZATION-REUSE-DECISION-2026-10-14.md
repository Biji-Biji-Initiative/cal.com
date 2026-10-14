# Organization admission: reuse and extension boundary

Date: 2026-10-14. Baseline: d5760dbe3b9e11aba4c3e95a677f8c5d8bfdf4eb.
The existing repository, enterprise branch, 39-node graph and #78/#79 remain.
This is generic work on the current public candidate; private research material
and unaccepted proprietary plans are not republished.

## Reuse decision

| Existing asset | Decision |
| --- | --- |
| Team / OrganizationSettings / Membership | Reuse the existing hierarchy, roles and accepted-state model |
| Profile(userId, organizationId) | Add organization profiles without relocating personal identity |
| Current TeamService and permission checks | Reuse child-team and member administration |
| EnterpriseAuditEvent and transactional writes | Reuse exact-request replay and atomic administrative audit |
| Existing native session / tRPC / UI | Extend them, not another administration API or identity provider |
| ProfileRepository's empty org-filter stub | Repair it before supporting more tenants |
| Global static profile creation / relocation helper | Not suitable inside this transaction; relocation changes personal ownership |
| Hosted upgrade banner | Replace with the implemented organization-management destination |
| Inactive fake-success org hook | Do not reconnect it as a working provisioning implementation |

The current root and retained API platform licenses are MIT. Historical public
API contracts provide behavioral references for organization, team, membership
and role semantics. Restricted old implementations are not treated as reusable
merely because their functionality is desirable. No restricted implementation is
transplanted in this tranche. This is not a legal opinion on the whole product.
No application dependency, database schema or scheduling algorithm is changed.

## Bounded first-organization operation

An established active instance operator reviews exact existing accounts, then
creates one organization with one designated owner and up to 19 ordinary members.
The authenticated server actor ID/UUID and target identities are rechecked against
the primary database. Input cannot supply administrator authority. A review is
not a signed grant; current authorization still decides whether commit is allowed.

The UI calls this immediate admission, not an invitation that the recipient has
accepted. No login account, IdP binding, external notification or domain proof is
created. Automatic email-domain joining is disabled. The operator receives no
membership unless explicitly listed. Initial platform-operator identity setup,
external invitations/consent and later member lifecycle remain separate work.

Existing personal identity, profiles, bookings, credentials and memberships are
not moved. A new Profile is additive; a missing suitable username gets a neutral
member-ID fallback, not a public name derived from a private email localpart.
Collisions fail the whole transaction rather than overwriting someone else.

Root, settings, memberships, profiles and audit commit together. Serializable
transactions and consistent row locks recheck current operator/target state.
Retries use one audit operation ID; stale or changed requests do not recreate
removed organizations or regrant removed memberships. Root slug checks include
pending-payment rows hidden by the general query extension. The old NULL-parent
index still cannot constrain every other historical writer, so no new global
unique-index guarantee is claimed. Ambiguous root readers must fail closed.

## Human and agent architecture

The new privileged browser operations require the configured same origin. This
is not an agent API or an invitation to reuse an operator cookie. Future REST/MCP
adapters need verified clients, explicit delegated grants, organization/resource
scope and revocation, while calling shared domain commands rather than duplicating
business logic. A confirmation boolean is not approval authority.

Community rollout requires actual tenant isolation, invited-member lifecycle,
exports/offboarding, bounded resource use and operating support. Programme and
network features should compose retained event/availability models first. Cross-org
collaboration requires explicit sharing; it must not expose personal calendars
through unrestricted organization or agent search. Keep upstream updates tied to
behavioral contracts and migration/restore proof. The 2027/2028 horizon is an
extensible system and measurable outcomes, not a claim to predict every protocol.

Public source references inspected: current LICENSE, packages/prisma/schema.prisma,
ProfileRepository.ts, TeamService.ts, AuditedIdentityLinkService.ts, and published
Cal organization membership/access-control documentation. Execution results and
remaining acceptance are recorded separately; no deployment is claimed here.
