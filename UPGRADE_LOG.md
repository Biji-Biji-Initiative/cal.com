# CAL-02.PREVIEW dependency upgrade log

## Nodemailer 7.0.12 → 10.1.7 (2026-10-19)

Status: local source qualification and root review are complete. All 22 focused tests and the genuine Cal import-closure typecheck pass; the strict installed-provider regression passes with the explicit declaration-only patch. Gitleaks passes; UBS remains nonzero with reviewed, unsuppressed dispositions below. No new candidate artifact or inbox-delivery claim is made.

Both direct owners (`@calcom/web` and `@calcom/feature-auth`) now request exactly 10.1.7. Remove the web workspace's obsolete `@types/nodemailer` 6.4.5 because the target ships declarations. The verification sender retains its awaited send and passes the original `serverConfig.transport` to the inferred native overload, preserving both SMTP configuration objects and URL strings.

The target requires Node >=20 and ships ESM and CommonJS builds. The observed qualifier host is Node 22.23.2. Existing deep `SendmailTransport.Options` and `SMTPConnection.Options` aliases are retained by upstream. Version 8 renames NoAuth to ENOAUTH; version 9 enables certificate validation for remote HTTPS content; version 10 adds bundled types and changes module packaging. No TLS relaxation or credential change is included.

### Explicit NextAuth compatibility decision

NextAuth **4.24.15** declares an optional Nodemailer peer of **^7.0.7**. Nodemailer 10.1.7 is outside that range, and 4.24.15 remains the latest stable NextAuth. This candidate intentionally tests that exact installed pair locally; it does **not** claim upstream semver support. No peer metadata override, ignored diagnostic, older nested mailer or Auth.js beta migration is included. Actual Yarn YN0060 warnings `p7fa752` and `pe5119d` remain visible and are preserved privately. The installed default provider and Cal custom sender are tested against the synthetic, non-relaying loopback sink.

The first strict check of actual `next-auth/providers/email.d.ts` with `skipLibCheck=false` failed with six TS2709 diagnostics. Its six namespace imports were used as instance types, incompatible with Nodemailer 10's bundled default-export classes. The normal Cal source check inherits the repository's existing `skipLibCheck=true`; that passing check did not establish declaration compatibility.

The explicit tracked patch `.yarn/patches/next-auth-npm-4.24.15-nodemailer10-types.patch`, selected by the pinned Yarn resolution in package.json, changes only those six declaration imports to default type imports. It does not alter the package version, declared peer range, runtime JavaScript, transport behavior or credentials. The permanent compatibility regression checks the actual installed provider declaration with `skipLibCheck=false` and genuine dependencies; it first reproduced all six errors before patch installation. No fake declarations or compiler suppression are used. This is a maintained local type bridge, to be removed only after a future supported stable NextAuth release supplies the compatible declarations and peer metadata and the same local tests pass.

### Qualification boundary

The new native compatibility suite checks CJS/ESM imports and bundled declaration resolution, object/URL verification sender submission and refusal, actual BaseEmail strict/legacy behavior and calendar MIME, and installed NextAuth default/custom sender behavior. The existing three verification and ten invitation regressions remain. Safety controls use an owned file, blocked outbound HTTP, an untrusted local TLS certificate, and small parser inputs in a memory/deadline-bounded child. Synthetic SMTP recipients are fixed by the existing sink allowlist; no provider/customer SMTP, auth route, token storage, shared database or inbox delivery is involved.

Actual local validation on the final source:

- Pinned Yarn 4.12.0 `install --mode=skip-build` exits 0. The initial family lock update took 236.191 seconds; installation of the declaration patch took 11.291 seconds. Its only lock effects are the two direct Nodemailer pins, obsolete DT removal, target mailer checksum and explicit NextAuth patch locator/checksum; the upstream source locator remains as the patch input. Both NextAuth YN0060 warnings remain.
- `node --test --test-concurrency=1 tests/community-enterprise/auth-verification-mail.test.cjs tests/community-enterprise/invitation-mail.test.cjs tests/community-enterprise/nodemailer-compatibility.test.cjs` passes **22/22** in 14.829 seconds (including the actual held-open TLS response cancellation). The permanent provider regression first failed on all six TS2709 diagnostics without the patch, then passes with `skipLibCheck=false` and actual installed dependencies. The initial fixture-assumption failure and the strict declaration red receipts are preserved.
- Genuine `tsc --noEmit` import-closure check of the actual sender, BaseEmail and serverConfig passes: 1,659 files, 254,551 source TypeScript lines, existing strict configuration and real Window/Dayjs ambient files, no stubs or suppression. The normal Cal profile inherits its preexisting `skipLibCheck=true`; the separate permanent provider-declaration regression explicitly sets it false. No full app compile/build or full suite is claimed.
- Biome check exits 0 with **8 warnings and 5 infos**, preserved without suppressions or automatic lint fixes. Git diff whitespace check passes.
- UBS completes its three-source-file scan but exits **1**, with **3 critical, 13 warning and 61 info** findings, all unsuppressed. The critical findings are two duplicate rules on the controlled trusted-source test loader and one synthetic noncredential token literal. The warnings cover test-only synchronous fixture I/O, fail-fast installed-metadata JSON parsing and a native stream-fetch/AbortSignal mismatch. Each fetch consumes only its owned stream under an explicit three-second destroy timer, cleared on error/end; an actual held-open response proves deterministic cancellation and cleanup. Every finding has a line-specific disposition in the private receipt; this is not a clean UBS scan or a security-finding waiver.
- Gitleaks exact-file scan exits **0** with no findings. The final log is included in the repeated exact-source scan, with no exclusions, baseline or allowlist.
- All 262 installed NextAuth JavaScript files and package.json bytes match the unpatched upstream package, including version 4.24.15 and peer ^7.0.7. Both direct workspace origins and the native NextAuth provider resolve Nodemailer 10.1.7, and obsolete DT resolution fails as expected.

Private exact argv, full warnings, code/lock hashes, failed and successful receipts and UBS dispositions are retained at g2:/data/tmp/cal-nodemailer-qualification-aciz5j9p. No environment values, credentials, raw mail bodies or generated TLS keys belong in this log.

### Existing artifact findings remain open

The genuine d8 image scan found four HIGH Nodemailer occurrences: CVE-2026-82659 (fixed 9.0.1), CVE-2026-82662 (fixed 8.0.8), GHSA-2x7j-588g-ccc2 (fixed 9.1.0), and GHSA-v53p-9fqp-m79j (fixed 10.0.6). It also found eight MEDIUM and one LOW occurrence for the same package. No finding is waived. A target version above those listed fixed versions is not a replacement for a new exact artifact scan.

The d8 native-qualified image, completed 69d8 web context, newer awaited-mail source (`0e6c271f237c4c54f182c50aa0e76cf1f3b0f6a0`), and this dependency candidate are distinct proofs. No previous artifact is relabeled by source tests or lock changes.

### Primary provenance

- [10.1.7 release](https://github.com/nodemailer/nodemailer/releases/tag/v10.1.7), published 2026-10-18; exact [npm metadata](https://registry.npmjs.org/nodemailer/10.1.7) reports 2026-10-18T18:24:50.456Z.
- [Pinned target package](https://github.com/nodemailer/nodemailer/blob/v10.1.7/package.json) and [typed public API](https://github.com/nodemailer/nodemailer/blob/v10.1.7/src/nodemailer.ts).
- [Maintainer requirements](https://nodemailer.com/) document bundled types and removal of the old DefinitelyTyped package.
- [Pinned NextAuth manifest](https://raw.githubusercontent.com/nextauthjs/next-auth/next-auth%404.24.15/packages/next-auth/package.json) and [native email provider](https://raw.githubusercontent.com/nextauthjs/next-auth/next-auth%404.24.15/packages/next-auth/src/providers/email.ts).

Source-only registry archives were SHA512-integrity verified during inventory. Target archive SHA256: `b9163453a4bf2643f0f7fe398daeb39c4492e548c55c56b2517aec616d2a64cb`. The prior d8 raw scan SHA256 is `4c43bdabb76f2674985557557295294a9a10fef048eeebdc4bdf08971b1879d0`. The detailed read-only inventory and proposal are retained in `/data/tmp/cal-nodemailer-inventory-58u1kcs7` on g; they are not runtime qualification receipts.
