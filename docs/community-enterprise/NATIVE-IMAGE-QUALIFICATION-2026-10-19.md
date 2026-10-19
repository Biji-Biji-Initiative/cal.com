# Current native image qualification

The newer source `69d8ad8d` local image now passes the isolated native HTTP/SSR fixture. The appended result below binds its own build, image and receipts; the original d8 checkpoint and failed attempts remain preserved. Neither candidate establishes live browser or release acceptance.

## Original d8 checkpoint

The exact d8 image builds and applies all 596 source migrations in an empty, isolated PostgreSQL 18 fixture. Replay leaves migration rows, catalog and user/account/booking counts unchanged. The sixth native HTTP attempt passes providers, staff login markup, the exact negative-callback redirect sequence, strict empty anonymous session and embedded manifest binding. The fifth failed attempt remains preserved. This isolated fixture does not prove the reported real-browser loop is resolved.

The [receipt](NATIVE-IMAGE-QUALIFICATION-RECEIPT-2026-10-19.json) binds the application source, build, OCI archive, native attempt and genuine raw scan. The image is local; it is neither a published registry artifact nor the image serving dev. Newer native-entry source 200c1709 and publisher source 69d8ad8d are absent from this d8 image. The publisher fix passes 157 focused and 1,073 registered source cases; those counts are not browser journeys.

| Check | Actual result | Scope |
| --- | --- | --- |
| Standalone build and OCI packaging | Complete; original bytes and digests retained | Source d8dae0cb, public origin https://cal.mereka.dev |
| Native migration and replay | 596 exact-source migrations; both exit 0 | Empty private PostgreSQL 18, generated fixture credentials |
| Providers and login | HTTP 200; exact public callback; staff button present; password form absent | Container-local HTTP, no real IdP or user |
| Callback rejection | HTTP 302; exact native error to signin to configured login sequence | Two manual intermediate fetches; exact public origin at each hop; final HTML not fetched |
| Anonymous session and manifest | HTTP 200; strict empty session object; manifest hash matches | Container-local negative admission and exact image binding |
| Raw Trivy scan | Exit 0; 56 HIGH; zero reported CRITICAL/secrets | Diagnostic image scan, not release acceptance |
| Physical dependency comparison | All 785 complete dependency path/name/version identities match | Another 82 metadata files remain explicitly unqualified |
| Existing dev preservation preflight | Accepted in a read-only PostgreSQL 17 transaction | No migrations, data writes, restore or version upgrade |

The login response contains one literal localhost URL inside the exact public `website_url_tooltip` translation. Attempt 4 proves every match belongs to that SHA-pinned serialized value, with no fixture secret or client identifier present. Attempt 5 permits only that exact login/status/content-type/count/pin case and continues rejecting other loopback text and fixture values. It does not claim zero literal loopback text. Earlier failed attempts are retained, including the Docker manifest/config-ID mismatch and scanner OCI archive/directory mismatch; corrected tooling does not relabel their results.

The completed raw scan finds 43 OS and 13 Node HIGH occurrences, all unresolved and unwaived. Its 785 dependency paths match the physical complete identities; the extra scan entry is the first-party web package. The remaining 82 package metadata files include 54 named versionless objects, 23 module boundaries and five other identityless objects. A parent package version is never substituted for a missing vendored dependency version. Zero reported secrets in this scan is not proof of all-layer or universal secret absence.

The native attempts use UID 1000, a read-only container filesystem, dropped capabilities, no container network and a private PostgreSQL Unix socket. Limits are 2 CPU / 12 GiB for the supervisor, 1 CPU / 4 GiB for migration/replay and 2 CPU / 8 GiB for web. All owned containers, PostgreSQL, socket and fixture directory are absent after the sixth attempt; the candidate image is retained. The raw scanner runs with 2 CPU / 8 GiB, zero swap and AF_UNIX only. Original/private archive, tool, database, metadata and copied OCI-layout hashes remain unchanged; its unit/cgroup are gone and the advisory slot is released.

The executed supervisors and exact argument templates remain with the hash-bound receipts: `native_image_qualification_v6.py --execute` under `g2:/data/tmp/cal-native-qualification-prep-Q5UPM1/`, and `raw_trivy.py --run --output /data/tmp/cal-image-security-RzCzHd/raw-run-d8-v3 --reviewed-plan-sha256 9b8aa19de69576a1080f9aa0ca0a664f59074b241d5dde06416112f875837243`. A fresh run requires fresh ownership, a new output directory and its own receipt; retained receipts are evidence, not authority to reuse a slot.

Live Google Calendar still rejects `https://cal.mereka.dev/api/integrations/googlecalendar/callback` with HTTP 302 `redirect_uri_mismatch` at 08:04 UTC; the redirect remains unaccepted. No consent or provider configuration write was performed. Native Authentik identity admission, account linkage, live native-entry and cutover acceptance, approved image publication, existing-data recovery/migration, routing cutover and actual staff-to-guest journeys remain open. Every existing programme task state is preserved.

## Newer 69d8 native HTTP/SSR pass

The exact source `69d8ad8d40095ce0847377e90414173a71692727`, build `G411IOJbMbx1Q-GJY6ROX`, passes the actual isolated native qualification in 53.399 seconds. Its own raw receipt has SHA-256 `3a1e66bd5aaf2c999e8533a46435b769bd11978d182e936c9ee30f018c3b80a8`; the independent terminal verification has SHA-256 `5a49e212d81212e975477119c559fe342d7944620aae0e9f572aa8ca7c81709b`. The appended receipt object binds packaging receipt `e38da5f8…`, OCI archive `c5ad7d17…`, image manifest `c0276a2f…` and config `38aa7e3e…`, with full hashes and retained private paths.

| Check | Actual newer image result |
| --- | --- |
| Migration, replay and post-HTTP invariant | All 596 exact-source migrations apply; replay and final readback preserve migration/catalog state; users/accounts/bookings stay zero |
| Providers, login and session | HTTP 200; exact public provider callback, staff login markup and strict empty anonymous session |
| Rejected callback | Exact same-origin native error → native signin → configured auth login sequence; two intermediate requests; final HTML not fetched |
| Explicit entry SSR | HTTP 200 with exact ready props for the canonical return; foreign and auth return paths each serialize only invalid-callback state |
| Response boundaries | All nine response-header checks pass; no fixture secret/client ID or loopback URL in headers, with 128-header / 64 KiB-total / 8 KiB-per-header caps |
| HTML bodies | Login and all three entry pages each contain only the same single SHA-pinned public tooltip loopback exception; strict fixture/body rejection remains active |
| Cleanup | All three owned containers, PostgreSQL, socket and fixture directory absent; unit not found, supervisor PID zero and cgroup absent; image retained |

Independent source review caught an inherited body-only test gap: a same-origin redirect header could previously carry fixture values without failing. The corrected probe checks all bounded headers before consuming bodies, applies no tooltip exception to headers and aborts validation failures. All 75 pure mock controls passed before this execution. This correction and the pinned public translation exception are not secret waivers.

The actual root build slot was released at `2026-10-19T08:34:34.620447569Z`. This image predates verification-mail fix `0e6c271f` and the pending Nodemailer upgrade. Its HTTP/SSR pass executes no client JavaScript and proves no real IdP, staff identity/account linkage, Google consent/calendar connection, live browser loop, booking journey or existing-data migration/restore. The older d8 diagnostic's 56 HIGH occurrences and 107 unwaived all-layer secret candidates are not scan results for this newer image. Newer image security, publication and deployment remain unproved; no programme task state changes.

The latest Google Calendar provider-only recheck at `2026-10-19T08:04:37.168001Z` still returns HTTP 302 `redirect_uri_mismatch`, accepted=false, for the exact dev Calendar callback. Its separate receipt is referenced under liveGoogle; temporary auth material is absent, with no consent, code exchange or configuration write. This Google observation does not qualify the native OIDC callback flow.
