// SPDX-License-Identifier: MIT
// Bounded source inventory for the enterprise SCIM/revocation boundary.
// This records what is (and is not) wired in the tracked source tree. It is
// deliberately not an HTTP, Authentik, database, or deployment acceptance.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const CONTRACT = "packages/features/community-enterprise/identity/ScimProvisioningContract.ts";
const IDENTITY_ROOT = "packages/features/community-enterprise/identity";
const API_ROOT = "apps/api/v2/src";
const CONTRACTS = [CONTRACT, `${IDENTITY_ROOT}/ScimRequestContract.ts`];

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

function unexpectedModuleCode(file, text) {
  const diagnostics = ts.transpileModule(text, { fileName: file, reportDiagnostics: true }).diagnostics;
  if (diagnostics?.some(({ category }) => category === ts.DiagnosticCategory.Error)) return true;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  return source.statements.some((statement) => {
    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement)
    )
      return false;
    if (ts.isImportDeclaration(statement)) return !statement.importClause?.isTypeOnly;
    if (ts.isExportDeclaration(statement)) return !statement.isTypeOnly;
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const))
      return true;
    return statement.declarationList.declarations.some(
      ({ name, initializer }) =>
        !ts.isIdentifier(name) ||
        !initializer ||
        !(
          ts.isLiteralExpression(initializer) ||
          [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(
            initializer.kind
          )
        )
    );
  });
}

function inventory(root) {
  const identity = sourceEntries(root, IDENTITY_ROOT);
  const api = sourceEntries(root, API_ROOT);
  const contracts = CONTRACTS.map((file) => {
    const entry = identity.find((candidate) => candidate.file === file);
    if (!entry) throw new Error(`Missing tracked SCIM contract: ${file}`);
    return entry;
  });
  const contract = contracts[0];

  // These patterns are intentionally narrow. They identify a direct source
  // adapter, not every possible dynamic implementation.
  const directWrites =
    /\.\$?(?:create|createMany|update|updateMany|delete|deleteMany|upsert|executeRaw|queryRaw)(?:Unsafe)?\s*(?:\(|`)/;
  const directHttp = /\b(?:fetch|axios)\s*\(|https?\.request\s*\(/;
  const httpRoute =
    /@(?:Controller|Get|Post|Put|Patch|Delete)\s*\(|\bNextResponse\b|\bRequest\s*\(|\bexport\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(|\bexport\s+(?:const|let|var)\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/;
  const scimMarker = /SCIM|Scim|scim|deprovision|directory.?sync/i;
  const contractReports = contracts.map(({ file, text }) => {
    const checks = {
      file,
      directDatabaseWrites: directWrites.test(text),
      directHttpCalls: directHttp.test(text),
      routeDecorators: httpRoute.test(text),
      unexpectedModuleCode: unexpectedModuleCode(file, text),
    };
    return {
      ...checks,
      sourceOnly:
        !checks.directDatabaseWrites &&
        !checks.directHttpCalls &&
        !checks.routeDecorators &&
        !checks.unexpectedModuleCode,
    };
  });
  const sourceContracts = new Set(
    contractReports.filter(({ sourceOnly }) => sourceOnly).map(({ file }) => file)
  );
  const runtimeIdentity = identity.filter(({ file }) => !sourceContracts.has(file));

  return {
    scope:
      "Tracked apps/api/v2 source and community-enterprise identity source. " +
      "Known contracts require bounded source checks; this is not transitive purity or runtime proof. " +
      "This inventory classifies direct static markers only; it does not resolve dynamic imports, module registration, HTTP dispatch, Authentik behavior, database writes in other packages, or runtime revocation.",
    contracts: contractReports,
    contract: {
      ...contractReports[0],
      hasUserAndGroupSchemas:
        /SCIM_USER_SCHEMA/.test(contract.text) && /SCIM_GROUP_SCHEMA/.test(contract.text),
      hasReconciliationPlan: /planScimMembershipReconciliation/.test(contract.text),
    },
    apiScimRouteCandidates: api
      .filter(({ file, text }) => scimMarker.test(file) || scimMarker.test(text))
      .map(({ file }) => file),
    identityRuntimeScimMarkers: runtimeIdentity
      .filter(({ file, text }) => scimMarker.test(file) || scimMarker.test(text))
      .map(({ file }) => file),
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
