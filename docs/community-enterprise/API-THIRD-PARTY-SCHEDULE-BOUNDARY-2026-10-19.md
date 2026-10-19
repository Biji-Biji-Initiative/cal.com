# Third-party OAuth boundary for Atoms schedule writes

CAL-05.API source slice, based on `04f8b5dbc66a1992e018140a57d5e5f593bf567a`.
The full API principal/scope/resource and deployed acceptance remain open.

A valid third-party OAuth JWT limited to `READ_PROFILE` or `READ_BOOKING`
could reach the retained Atoms schedule mutations. The API issuer defines only
these read scopes; they are distinct from platform access-token/client permission
masks and personal/team API keys. No new scope-to-permission mapping is inferred.

The three existing update/create/duplicate methods now use the existing
method-level `ApiAuthGuardOnlyAllow`. They preserve `OAUTH_CLIENT_CREDENTIALS`,
`API_KEY`, `ACCESS_TOKEN`, and `NEXT_AUTH`. Authentication freshness, resource
services, permission masks, booking contracts, and calendar-connect's explicit
third-party support are unchanged.

The already registered `api-session-boundary.test.cjs` executes real Nest
Reflector/controller metadata, production `ApiAuthGuard.getRequest`, strategy,
JWT verifier, permission guard/helper, and controller methods. Passport dispatch,
repositories, native-cookie decoding, and schedule writes are explicit doubles;
this is not native HTTP, current database, provider, or serving-image proof.

Before the policy, 116 cases ran: 110 passed and the six read-scope mutation
rejections failed. Afterward all 116 pass, including 39 added cases. Removing
method metadata or breaking guard propagation in memory reproduces admission.
All four supported methods pass each mutation; current managed-permission
denials, invalid JWT signatures, and locked-owner controls remain effective.

Reproduce from the shared checkout with its existing dependencies:

```sh
node --test --test-reporter=spec tests/community-enterprise/api-session-boundary.test.cjs
node node_modules/typescript/bin/tsc --project apps/api/v2/tsconfig.build.json --noEmit --incremental false --pretty false
```

The registered `test:community-enterprise` script body from `package.json`
passed all 800 source cases with zero failures or skips and at most four workers;
reproduce it with `yarn test:community-enterprise`. UBS exited 1 with six critical,
seven warning and 154 information findings. The critical labels concern the
existing trusted-source compilation loader, two older fixture comparisons, and
two public-method/synthetic-token comparisons in named doubles. JWT verification
and the production timing-safe client-secret helper remain real. Findings were
reviewed without suppressions; the UBS scan is not clean.

Both commands pass. The broader all-file API tsconfig initially reported TS2307
in the untouched legacy `test/mocks/calendars-service-mock.ts` import; its separate
fix and typing evidence belong to that fixture's owner. No package install, build, E2E, live request,
database mutation, provider action, or SCIM change belongs to this slice.
