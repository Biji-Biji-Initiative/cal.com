// SPDX-License-Identifier: MIT
// Bounded source inventory for the enterprise SCIM/revocation boundary.
// This records what is (and is not) wired in the tracked source tree. It is
// deliberately not an HTTP, Authentik, database, or deployment acceptance.
const fs = require("node:fs");
const path = require("node:path");

const CONTRACT = "packages/features/community-enterprise/identity/ScimProvisioningContract.ts";
const IDENTITY_ROOT = "packages/features/community-enterprise/identity";
const API_ROOT = "apps/api/v2/src";

function sourceFiles(root, prefix) {
  const absolute = path.join(root, prefix);
  return fs
    .readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) => {
      const relative = path.join(prefix, entry.name);
      if (entry.isDirectory()) return sourceFiles(root, relative);
      return entry.isFile() && /\.[cm]?[jt]sx?$/.test(relative) ? [relative] : [];
    })
    .sort();
}

function sourceEntries(root, prefix) {
  return sourceFiles(root, prefix).map((file) => ({
    file,
    text: fs.readFileSync(path.join(root, file), "utf8"),
  }));
}

function matches(entries, pattern) {
  return entries
    .filter(({ text }) => pattern.test(text))
    .map(({ file }) => file)
    .sort();
}

function inventory(root) {
  const identity = sourceEntries(root, IDENTITY_ROOT);
  const api = sourceEntries(root, API_ROOT);
  const contract = identity.find(({ file }) => file === CONTRACT);
  if (!contract) throw new Error(`Missing tracked SCIM contract: ${CONTRACT}`);
  const runtimeIdentity = identity.filter(({ file }) => file !== CONTRACT);

  // These patterns are intentionally narrow. They identify a direct source
  // adapter, not every possible dynamic implementation.
  const directWrites =
    /\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert|executeRaw|queryRaw)\s*\(/;
  const directHttp = /\b(?:fetch|axios)\s*\(|https?\.request\s*\(/;
  const httpRoute = /@(?:Controller|Get|Post|Put|Patch|Delete)\s*\(|NextResponse|Request\s*\(/;
  const scimMarker = /SCIM|Scim|scim|deprovision|directory.?sync/i;

  return {
    scope:
      "Tracked apps/api/v2 source and community-enterprise identity source. " +
      "This inventory classifies direct static markers only; it does not resolve dynamic imports, module registration, HTTP dispatch, Authentik behavior, database writes in other packages, or runtime revocation.",
    contract: {
      file: CONTRACT,
      hasUserAndGroupSchemas:
        /SCIM_USER_SCHEMA/.test(contract.text) && /SCIM_GROUP_SCHEMA/.test(contract.text),
      hasReconciliationPlan: /planScimMembershipReconciliation/.test(contract.text),
      directDatabaseWrites: directWrites.test(contract.text),
      directHttpCalls: directHttp.test(contract.text),
      routeDecorators: httpRoute.test(contract.text),
    },
    apiScimRouteCandidates: api
      .filter(({ file, text }) => scimMarker.test(file) || scimMarker.test(text))
      .map(({ file }) => file),
    identityRuntimeScimMarkers: matches(runtimeIdentity, scimMarker),
    identityRuntimeDirectHttp: matches(runtimeIdentity, directHttp),
    localSessionRevocationMarkers: matches(
      runtimeIdentity,
      /(?:locked|bindingId|no longer authorized|session identity mismatch)/i
    ),
    sourceFiles: { apiV2: api.length, identity: identity.length },
  };
}

if (require.main === module) console.log(JSON.stringify(inventory(path.resolve(__dirname, "..")), null, 2));

module.exports = { inventory };
