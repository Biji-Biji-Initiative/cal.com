// SPDX-License-Identifier: MIT
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const inventory = JSON.parse(
  fs.readFileSync(path.join(root, "docs/community-enterprise/upstream-baseline.json"), "utf8")
);
const inventoryOnly = process.argv.includes("--inventory-only");
const allowed = "packages/features/community-enterprise/authorization/PermissionCheckService.ts";
const importPath = "@calcom/features/community-enterprise/authorization/PermissionCheckService";
const files = inventoryOnly
  ? inventory.permission_stub_files
  : execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
      .split("\0")
      .filter(
        (file) =>
          /\.[cm]?tsx?$/.test(file) &&
          !/(?:^|\/)(?:node_modules|generated|__tests__|__mocks__|tests)(?:\/|$)|\.(?:test|spec|generated)\./.test(
            file
          )
      );
const failures = [];
for (const relative of new Set([...files, ...inventory.permission_stub_files])) {
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(`${root}${path.sep}`)) throw new Error("Invalid inventory path");
  if (!fs.existsSync(absolute)) {
    failures.push(`${relative}: missing`);
    continue;
  }
  const text = fs.readFileSync(absolute, "utf8");
  const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) failures.push(`${relative}: TypeScript parse errors`);
  if (inventory.permission_stub_files.includes(relative)) {
    const connected = source.statements.some(
      (n) => ts.isImportDeclaration(n) && n.moduleSpecifier.text === importPath
    );
    if (!connected) failures.push(`${relative}: disconnected from shared policy`);
  }
  const visit = (node) => {
    if (ts.isClassDeclaration(node) && node.name?.text === "PermissionCheckService" && relative !== allowed) {
      failures.push(`${relative}: duplicate permission service`);
    }
    if (
      ts.isMethodDeclaration(node) &&
      ["checkPermission", "hasPermission"].includes(node.name?.getText(source))
    ) {
      const body = node.body?.statements;
      if (
        body?.length === 1 &&
        ts.isReturnStatement(body[0]) &&
        body[0].expression?.kind === ts.SyntaxKind.TrueKeyword
      ) {
        failures.push(`${relative}: unconditional permission grant`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
console.log(
  `Scope: ${inventoryOnly ? "declared integration inventory only" : "all tracked non-test TypeScript"}`
);
console.log(
  `Inspected ${files.length} source files; connected inventory: ${inventory.permission_stub_files.length}`
);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else console.log("PASS: no duplicate or allow-all permission service in inspected scope");
