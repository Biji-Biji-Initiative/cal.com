# Isolated preview: reviewed first operator

16 October 2026. Existing repository `Biji-Biji-Initiative/cal.com`, branch
`work/cal-diy-enterprise-20261010`. This implements a concrete prerequisite of
CAL-02.PREVIEW. It does not create a deployed preview, directory provisioner or
real staff account. The accompanying machine receipt binds the exact source,
executed commands, evidence hashes and remaining activation requirements.

## The gap and the delivered path

Native-only sign-in correctly requires an existing, explicitly linked identity.
The retained account-linking and organization-admission services also require an
existing operator. In a fresh preview database those prerequisites were circular.
Temporarily reopening public first-user setup or adding email-based promotion
would defeat the accepted identity policy.

The existing `scripts/link-enterprise-identity.cjs` now has two explicit modes:
`bootstrap-plan` and `bootstrap-apply`. Its original `plan` and `apply` account-link
modes remain. The new service is imported only by that privileged command-line
entrypoint and its tests, not by an HTTP route, public signup or authentication
callback. It reuses the existing Prisma models, identity encoding/link function,
plan digest/expiry contract, command-line file reader and audit table. There is
no new database migration, package dependency, daemon or alternate repository.

Planning does not write an account. A reviewed request names an operation UUID,
the intended operator UUID, exact IdP subject, name, email and username. Unknown
fields and caller-selected roles/passwords are refused. The 15-minute plan binds
the request and intended target and omits the raw subject, email and name. The
existing file writer creates it exclusively with mode 0600. Its hash detects
changes; it is not a digital signature or authorization for an untrusted caller.

Applying creates exactly one local ADMIN account, its native Authentik binding,
and the mandatory audit in one database transaction. It creates no password,
organization, membership, calendar credential, booking, invitation or session.
It does not claim the email was verified: `emailVerified` stays null. Personal
onboarding remains incomplete so the human still chooses their profile and
availability through the existing interface. SEO indexing and digest mail are
disabled on this initial preview account.

The instance-scope audit uses the existing zero-organization convention. It names
the new identity as the subject and explicitly records out-of-band database-
operator authority and the absence of a prior application actor. It does not
pretend the not-yet-existing user authenticated the command. After creation, the
existing organization review/provision service works normally; the bootstrap
itself never auto-joins an email domain or manufactures an organization.

## Safety and authority

The CLI rejects unsafe configuration before reading an input file or connecting:
`CAL_AUTHENTIK_ENABLED=true`, `CAL_AUTHENTIK_ONLY=true`, the exact preview origin
`https://cal.mereka.dev`, and a separate database name beginning with the allowed
`cal_enterprise_preview` pattern are mandatory. Production/lookalike/plain-HTTP
origins, legacy database names, unknown flags and implicit apply are refused.
The connected database must match the explicitly expected name; the service also checks current_database() itself before table locking, even when called directly. Existing database
metadata and URL identity form the password-free target fingerprint; provider
credentials are neither fetched nor needed by this tool.

These checks are accident-prevention fences, not a claim that a name proves
network or data isolation. The actual infra-owned isolated database, origin,
native client and sanctioned existing IdP subject must be admitted before any
non-test invocation. A database operator who can edit the tool and target data
already holds authority outside the application; a plan hash cannot restrict
that administrator. No such operational invocation occurred in this work.

The service reads physical tables, avoiding ORM filters that hide pending
organizations. It refuses any existing row in the 13 checked identity, team,
calendar/booking, integration or audit tables; reference and migration metadata
may remain. This is not a statement that every table in the schema must be empty.
The brief transaction locks those tables with NOWAIT, so a contending writer
causes visible refusal rather than bootstrap racing live activity. Changes since
planning and expired reviews are checked again before writing.

Idempotent replay returns the original result only while the exact binding and
active operator identity still match. Deleted/replaced bindings, locking and
demotion are not repaired by replay. A failed mandatory audit rolls back account
and identity creation. There is no force flag, automatic destructive cleanup or
infinite retry path. Once any normal application data exists, use the existing
reviewed account/organization tools rather than rerunning first-operator setup.

## Executed acceptance

The maintained private PostgreSQL runner exercises the actual service, CLI and
native generated schema. The suite retains every original account-link case.
Additional checks cover blank plans, all target fences, pending and orphaned
records, changed plans/targets, audit rollback, racing first operators, active
writer contention, revoked/demoted replay, no password/email-verification claim,
and the actual first-operator-to-organization service path.

The resulting binding is also checked using the actual native sign-in and token
refresh functions. That is function/database acceptance, not a real IdP browser
exchange or proof of a production user's identity. No IdP credentials, real
calendar API or outbound relay were used.

The first full test attempt retained its failure: 54 cases passed and the new
four-process CLI aggregate reached Vitest's default 30-second outer timeout.
Individual CLI invocations already had a 30-second bound. The new aggregate now
has a finite combined 150-second budget while every individual command keeps
its original bound. This is a harness budget for sequential subprocesses, not a
relaxed login performance target or swallowed application error. Later guard
coverage is included in the final recorded run, rather than labeling that first
invocation successful.

Strict TypeScript checks the real service/test import closure and generated
Prisma types, without substitute declarations. Biome and the registered source
suite run on the final owned files. Gitleaks covers those four files; UBS reports
zero critical findings and five unsuppressed synchronous-file warnings in the
existing one-shot CLI, plus five information findings. These limited source
scans do not waive any of the remaining image vulnerabilities.

## Operator usage, only after target admission

Prepare the private request file from the reviewed existing test identity. Do not
put its raw subject, email, database connection or client secrets into Git or
command arguments. Supply the already authorized database/issuer environment
through its normal owner-controlled mechanism, not a copied production `.env`.
Run from the exact checked source with its installed native dependencies:

```sh
node scripts/link-enterprise-identity.cjs bootstrap-plan --request /private/request.json --out /private/review.json --database cal_enterprise_preview
node scripts/link-enterprise-identity.cjs bootstrap-apply --request /private/request.json --plan /private/review.json --database cal_enterprise_preview
```

The paths above are illustrative private operator paths, not files created by
this work. Review the target and proposed identity between commands. Refusal
means inspect the mismatch or activity and create a fresh plan where appropriate;
it does not authorize deleting data, relaxing Authentik-only policy or guessing
a replacement subject. This command does not discover or create IdP accounts,
prove the subject belongs to a human, or bypass MFA.

## Image and deployment distinction

The completed security-qualified web image remains the separately built
`e3a79afbffc3d81973d6f299a59e154f154d7cf8` application, with local index
`sha256:0b3f92174bcb45eb7b7cdda0a23b98dc3262f13d342efc22103d36dd1dd4d4aa`.
This CLI-only addition does not relabel that image or prove a fresh build. The
bootstrap runs from the authorized source/operator environment; it is not an
advertised command inside the minimal application image.

The completed matched scan is recorded separately: 113 to 56 HIGH occurrences,
zero CRITICAL and zero detected secrets at that scan, with all 56 residuals still
open. Existing approved registry publication, native-client and guest-routing
cutover, actual isolated deployment and real staff-to-guest journey remain
CAL-02.PREVIEW/CAL-06.JOURNEY prerequisites. The source/graph count remains 12 of
29 executable tasks complete and 17 open. No milestone closes because a local
bootstrap fixture now succeeds.

No production, existing database, deployment, domain, user password, IdP identity,
provider account, registry/runner policy or secret scope changed. The test
supervisors stopped their owned PostgreSQL fixtures; no unattended process or
additional agent was launched. The final publication and per-file readback are
recorded in issue #78.

Agent: ChatGPT-CalPreviewBootstrap-20261016

## Final verified source checkpoint

Implementation commit: `14e300e348cb4afb2675f27c18d079b11e0f009b`. The paired native test
and evidence commit follows it without relabeling the application image. All
**59 real PostgreSQL/CLI cases pass**: the retained 28 account-link cases plus 31
new preview-bootstrap cases. The registered source suite passes **594 tests, zero
failures or skips**, including the unchanged staff-signup/password-denial contract.
These counts describe different test scopes, not deployed journeys.

A final defense checks the service's actual connected database name, not merely
a caller-supplied target label. Its first native run exposed PostgreSQL's `name`
result type, which Prisma's raw reader does not decode: 45 cases passed and 14
failed. Casting that metadata result explicitly to text fixed the real adapter
error; the complete 59-case native run then passed. Neither the failure nor the
prior successful 58-case run is substituted for this final exact-source result.

All four owned database invocations, including failed attempts, have stop receipts
and absent temporary directories. Fresh narrow source scans report zero secrets
and zero critical findings; five existing synchronous-file CLI warnings and five
information items remain unsuppressed. The full application/image security ledger
is unchanged by this operator-tool acceptance.
