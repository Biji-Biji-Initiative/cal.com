// SPDX-License-Identifier: MIT
// Import-bound syntax inventory, not a route reachability or authorization proof.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");
const sources = new Set(["next-auth/jwt", "jose", "jsonwebtoken", "@nestjs/jwt", "passport-jwt"]);
const readers = new Set([
  "getToken",
  "decode",
  "verify",
  "decodeJwt",
  "jwtVerify",
  "jwtDecrypt",
  "compactDecrypt",
  "verifyAsync",
  "Strategy",
]);
const exclude =
  /(^|\/)(test|tests|__tests__|playwright|dist|generated|fixtures|\.next)(\/|$)|\.(test|spec|e2e|e2e-spec|stories|generated)\.|\.d\.ts$/;
function inspect(file, text) {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const bindings = [];
  for (const node of ast.statements) {
    if (
      !ts.isImportDeclaration(node) ||
      !ts.isStringLiteral(node.moduleSpecifier) ||
      !sources.has(node.moduleSpecifier.text) ||
      node.importClause?.isTypeOnly
    )
      continue;
    const module = node.moduleSpecifier.text;
    const record = (local, imported, type) =>
      bindings.push({
        module,
        local,
        imported,
        type,
        line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
        calls: [],
      });
    if (node.importClause?.name) record(node.importClause.name.text, "default", "namespace");
    const named = node.importClause?.namedBindings;
    if (named && ts.isNamespaceImport(named)) record(named.name.text, "*", "namespace");
    else if (named)
      for (const element of named.elements)
        if (!element.isTypeOnly)
          record(element.name.text, element.propertyName?.text || element.name.text, "named");
    if (!node.importClause) record(null, null, "side-effect");
  }
  function visit(node) {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const target = node.expression;
      for (const binding of bindings) {
        let operation;
        if (ts.isIdentifier(target) && target.text === binding.local && readers.has(binding.imported))
          operation = binding.imported;
        if (
          ts.isPropertyAccessExpression(target) &&
          ts.isIdentifier(target.expression) &&
          target.expression.text === binding.local &&
          readers.has(target.name.text)
        )
          operation = target.name.text;
        if (operation)
          binding.calls.push({
            operation,
            line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
          });
      }
    }
    // Dynamic/CommonJS loads and re-exports are explicit review boundaries,
    // rather than silently being mistaken for complete ESM call resolution.
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0]) &&
      sources.has(node.arguments[0].text)
    ) {
      bindings.push({
        module: node.arguments[0].text,
        local: null,
        imported: null,
        type: "dynamic-boundary",
        line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
        calls: [],
      });
    }
    if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      sources.has(node.moduleSpecifier.text)
    ) {
      bindings.push({
        module: node.moduleSpecifier.text,
        local: null,
        imported: null,
        type: "reexport-boundary",
        line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
        calls: [],
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return bindings.length ? { file, bindings } : null;
}
function inventory(root) {
  const files = execFileSync("git", ["ls-files", "-z", "apps", "packages"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((file) => /\.[cm]?[jt]sx?$/.test(file) && !exclude.test(file));
  return {
    scope:
      "Tracked production apps/packages syntax; imported runtime token bindings and direct calls. Not indirect-call resolution, route reachability, all bearer handlers or runtime revocation proof.",
    filesInspected: files.length,
    entries: files
      .map((file) => inspect(file, fs.readFileSync(path.join(root, file), "utf8")))
      .filter(Boolean),
  };
}
if (require.main === module) console.log(JSON.stringify(inventory(path.resolve(__dirname, "..")), null, 2));
module.exports = { inspect, inventory };
