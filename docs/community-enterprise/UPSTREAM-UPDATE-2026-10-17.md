# Bounded upstream-update rehearsal

Date: 17 October 2026. Scope: `CAL-08.UPDATE`, source and contract-test rehearsal
only. No production database, identity provider, domain, image, deployment or
provider account was changed.

## Incoming revision and review boundary

The recorded upstream baseline is `calcom/cal.diy` revision
`54343aa685ae8f33159d2f485ec4a57bad5c574a`, the immutable source named by
`docs/community-enterprise/upstream-baseline.json`. The incoming revision is
upstream pull request [#30296](https://github.com/calcom/cal.diy/pull/30296),
commit `b84a32150e34dd29caa46e69676a78c0d53f732a`, titled `fix: format timezone
offsets consistently` (5 October 2026). The pull request's review page records
that it has one commit on top of `54343aa`, five automated checks, and a review
observation that the fractional-offset behavior needed a focused assertion.
The pull request was still open/stale when inspected; this rehearsal does not
claim that it was merged into upstream `main`.

The explicit incoming patch changes one source line in
`packages/lib/timezone.ts`:

```diff
- offset.replace(/^([-+])(0)(\d):00$/, (_, sign, _zero, hour) => `${sign}${hour}:00`);
+ offset.replace(/^([-+])0(\d):(\d{2})$/, "$1$2:$3");
```

The patch removes the leading zero for one-digit hours while preserving
fractional minutes, for example `+05:30` becomes `+5:30`. The enterprise branch
replays this exact one-line change and adds the review-requested
`Asia/Kolkata` (`+5:30`) assertion in `apps/web/test/lib/getTimezone.test.ts`.
The source patch is intentionally kept separate from the upstream commit
identity; no claim is made that the branch contains an upstream merge object.

## Reproduction and evidence

Run the source-bound contract and the focused application test from the exact
branch checkout:

```sh
node --test tests/community-enterprise/upstream-update-contract.test.cjs
TZ=UTC vitest run apps/web/test/lib/getTimezone.test.ts --maxWorkers=1 --no-file-parallelism
```

Then rerun the registered enterprise source suite:

```sh
yarn test:community-enterprise
```

The contract test proves that the reviewed incoming revision and its exact
replacement are recorded once, that the legacy expression is gone, and that
the focused fractional-offset assertion is present. The Vitest test exercises
`handleOptionLabel` with the `Asia/Kolkata` fixture. These are source and local
test scopes; they are not a built-image, serving-preview, production, or
migration result.

## Acceptance boundary

This is a bounded update rehearsal: two immutable upstream revisions are
identified, the explicit one-line change is replayed, the reviewer-requested
enterprise-safe assertion is added, and the existing contract suite is rerun.
It does not close `CAL-08.UPDATE` by itself. A complete update still requires a
maintainer-reviewed incoming revision accepted against the current enterprise
integration map, a clean exact-source build, and the remaining migration,
preview, security and operational gates. The branch remains free of production
or live-identity changes.
