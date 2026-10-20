# Repeatable Cal.com Cloud worker admission

Use the existing Published cal.com Cloud environment and the configured person
account/model. Preserve its original consumers, current checkout, source history,
native credentials, managed proxy and CA trust. A new change does not require a
new environment, clone, worktree, account or tracker.

## Establish observations

Read the current `AGENTS.md`, then native `cloud_environment.environment_status`
and `/etc/codex/network-policy.json`. Record only instance/config revision,
`observations_current`, enforcement/readiness states and required-host booleans.
Do not dump environment values, headers, tokens or raw service responses.

Native status and actual execution are different observations. `unknown` is a
readiness gap; it does not prove shell execution is unavailable. Harmless `pwd`,
source/status/origin reads and approved fetches can establish backend execution.
Treat native policy as applied only when `enforced`, and individual bindings as
ready only with current observations and `ready`. Retain old failure receipts
when newer observations supersede them.

Fetch the existing branch without overwriting work:

```sh
git status --porcelain=v1
git remote get-url origin
git fetch --no-tags origin refs/heads/work/cal-diy-enterprise-20261010
git rev-parse HEAD FETCH_HEAD
```

The authoritative origin is `https://github.com/Biji-Biji-Initiative/cal.com.git`.
Preserve ancestors `167f457dfe` and `0aaaa24`. Reuse a qualified existing clean
workspace. For an initial isolated consumer only, select a noncolliding local
alias; preserve the old `work` branch because `work/cal-...` collides with it.
Never reset, stash or clean another consumer's work. Stop on an overlapping
dirty-source or non-fast-forward update and coordinate without discarding it.

## Canonical Agent Mail transport

The only endpoint is `https://agentmail.mereka.dev/mcp/`; the project key is
`/repos/github.com/biji-biji-initiative/cal.com` (canonical project 199).
After native admission, run the read-only source-owned transport probe:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/cloud-agent-mail.py
```

It uses the existing scoped `MCP_AGENT_MAIL_TOKEN` through validated in-memory
`curl --config -` stdin. Curl keeps its standard User-Agent and inherited HTTPS
proxy/CA trust; implicit curlrc overrides are disabled. There are no redirects,
retries, alternative endpoints or TLS-verification bypasses. Both request and
response sizes, header bytes, tool pagination and child execution time are bounded.
The CLI emits only stable error categories, status receipts and tool names.
It sends initialize, the initialized notification and tools/list in order,
preserving negotiated protocol and any returned session header.

Python urllib received Cloudflare 1010 while standard curl succeeded in the same
fresh consumer. This was a client-specific transport observation, not proof of a
missing password. If the approved curl probe is denied, preserve its sanitized
stage/status and report the owning edge-policy gap. Do not cycle User-Agents,
routes or credentials.

The module's `Client` is reusable by an authorized private controller. Tool
results may contain credentials: keep them in memory or private storage, never
print them. The helper has no registration or messaging CLI and saves no identity.
Resume an existing identity (JadeFrog for its current consumer); never borrow
PlumOriole/NavyMaple or silently register again. Initial registration must have a
durable private attempted/result ledger before its single request. An unknown
registration/send outcome is not permission to retry; inspect the existing
identity or idempotent delivery receipt first.

Read current canonical leases, own inbox and `docs/community-enterprise/TASK_GRAPH.json`
before choosing work. Reserve exact edited paths, honor owners and explicit
handoffs, and release only your own reservations. No active lease is not itself
a transfer of a task's ownership. NavyMaple retains graph/programme coordination.

## Dependencies and scoped service readiness

Use the source-required Node version and tracked `.yarn/releases/yarn-4.12.0.cjs`;
do not bootstrap external Corepack. Yarn needs its own proxy selectors mapped
for the command from the inherited managed values, with strict TLS enabled:
`YARN_HTTP_PROXY`, `YARN_HTTPS_PROXY` and `YARN_HTTPS_CA_FILE_PATH` from the
corresponding approved HTTP/HTTPS proxy and Node CA variables. Never echo values.
Use one bounded immutable install with private per-attempt logs and durable
actual exit/lock-hash receipts. Follow it with the source-owned `yarn prisma generate`
workspace command, which provides local generator binaries. Preserve caches and
failure receipts; correct a demonstrated cause instead of looping installations.

Qualified dependencies and generated custom-client paths are specific to a
source/lock revision. Reuse their actual receipts while those inputs are unchanged.
Do not repeat completed installs or unrelated graph/SCIM suites for each change.
Client-mode generation is not Rust-engine transport proof. For the locked Prisma
6.16.1 engine, separately verify gzip and published checksum at commit
`1c57fdcd7e44b29b9313256c76699e91c3ac3c43`, platform `debian-openssl-3.0.x`, on
`binaries.prisma.sh`. Standard curl later returned 200 for both and the verified
engine version matched that commit; earlier urllib 403 receipts remain failures.
This does not prove database/provider connectivity or deployment.

Infisical/dev-service access requires the controller's approved native scoped
machine-auth binding, exact existing project/environment and service selectors,
and current readiness evidence. No Infisical CLI or checked machine-auth/project
selectors were present in the fresh worker's observed revision-5 context. Report
that precise gate; Mail/GitHub success is not Infisical or development-service
authorization. Do not mint credentials, use another consumer's token, copy a VPS
home/Beads database, guess broader scopes or start interactive login. Once an
approved binding is ready, use its supported SDK/CLI without printing credentials
and qualify a read-only action against the specifically approved service.

## Validation and delivery

### Local PostgreSQL Tasker qualification without host PostgreSQL tools

`scripts/run-community-enterprise-cloud-tasker.py` adapts the existing canonical
PostgreSQL runner, with no application credentials, installs, migrations or native
service access. First verify the managed local Docker socket using the Cloud
runtime's explicit local-socket check. Keep registry credentials and proxy/CA
settings unchanged. Pull the source-required official PostgreSQL 18 image once:

```sh
env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
  docker --host=unix:///var/run/docker.sock pull postgres:18
CAL_CLOUD_PG_IMAGE="$(env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
  docker --host=unix:///var/run/docker.sock image inspect postgres:18 --format '{{.Id}}')"
PYTHONDONTWRITEBYTECODE=1 python3 scripts/run-community-enterprise-cloud-tasker.py \
  --image "$CAL_CLOUD_PG_IMAGE" --node "$CAL_CLOUD_NODE20" \
  --schema-engine "$CAL_CLOUD_SCHEMA_ENGINE" \
  --receipt-dir /workspace/scratch/cal-tasker-first-run
```

Set `CAL_CLOUD_NODE20` to the already-qualified Node20 executable and
`CAL_CLOUD_SCHEMA_ENGINE` to the separately checksum-verified public schema engine.
These are public tool paths, not credentials. The canonical runner checks that
an explicit engine's version matches the installed Prisma engine commit before
using it in its clean child environment. If the normal installed engine cache is
already qualified, omit `--schema-engine`. No dependency reinstall or generation
is part of this check.

The receipt directory must be new; use a different path for a subsequent attempt.
The adapter refuses mutable image tags, images without official Postgres origin,
Node versions outside 20 and PostgreSQL versions outside 18. It never pulls an
image itself. The fixture uses an unprivileged UID, bounded CPU/memory/PIDs, no
network, a read-only root filesystem and only its newly created scratch mount
plus synthetic account metadata. It mounts no host home, source or credentials.
Short scratch roots avoid PostgreSQL's 107-byte Unix-socket path limit.

The unchanged Tasker suite connects over that private Unix socket. PostgreSQL and
test logs stay in the private receipt directory; stdout contains only lifecycle,
exit/count and cleanup evidence. Removal is fenced by the exact created container
ID and ownership label, including reconciliation after an unknown start response.
Do not replace a cleanup error with an absence claim. Coordinate the integration
slot before a run and release it after actual cleanup. A 49-test native PostgreSQL
fixture pass proves that fixture's SQL/client behavior; it does not prove serving
application, existing-data migration, Infisical, Kubernetes or provider acceptance.

Run the helper's offline controls without any real credential:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tests/community-enterprise/cloud-agent-mail.test.py
```

Run meaningful checks for the actual source change and the repository's applicable
type/format checks. Fixtures do not establish real calendar, database, provider,
native environment or release acceptance. Do not close graph criteria from a
smaller proof. Record unsupported check languages or missing runtime prerequisites
truthfully instead of silently relabeling them green.

Verify the authenticated GitHub person (`lifeofgurpreet`) and actual repository
push permission separately. Deliver a small Gurpreet commit with the actual
`Agent:` trailer to `work/cal-diy-enterprise-20261010` through a normal fast-forward
person push, safely refreshing first. Never force push or rebase shared history.
Read back remote author/login, commit parent and changed blob IDs. Send NavyMaple
the exact source, commands/exits, remaining gates and lease-release receipt through
canonical Mail. Keep the existing graph and other consumers' work intact.
