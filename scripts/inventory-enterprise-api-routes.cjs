// SPDX-License-Identifier: MIT
// Read-only AST inventory for the API v2 authorization surface.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const sourceRoot = path.join(root, "apps/api/v2/src");
const routeDecorators = new Set(["Get", "Post", "Put", "Patch", "Delete", "Options", "Head", "All"]);
const mutationDecorators = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(absolute);
    return entry.isFile() && entry.name.endsWith(".controller.ts") ? [absolute] : [];
  });
}

function decorators(node) {
  return ts.canHaveDecorators(node) ? ts.getDecorators(node) || [] : [];
}

function decoratorName(decorator) {
  const expression = decorator.expression;
  if (ts.isCallExpression(expression)) {
    return expression.expression.getText();
  }
  return expression.getText();
}

function decoratorCall(decorator) {
  const expression = decorator.expression;
  return ts.isCallExpression(expression) ? expression : undefined;
}

function firstStringArgument(decorator) {
  const call = decoratorCall(decorator);
  const argument = call && call.arguments[0];
  return argument && ts.isStringLiteralLike(argument) ? argument.text : "";
}

function hasDecorator(node, expected) {
  return decorators(node).some((decorator) => decoratorName(decorator).endsWith(expected));
}

function hasPermissionsGuard(node) {
  return decorators(node).some((decorator) => {
    if (decoratorName(decorator) !== "UseGuards") return false;
    const call = decoratorCall(decorator);
    return Boolean(call && call.arguments.some((argument) => argument.getText().includes("PermissionsGuard")));
  });
}

function hasPermissions(node) {
  return decorators(node).some((decorator) => decoratorName(decorator) === "Permissions");
}

function joinPath(prefix, route) {
  return [prefix, route].filter(Boolean).join("/").replace(/\/+/g, "/").replace(/^\//, "");
}

function inventoryFile(file) {
  const source = fs.readFileSync(file, "utf8");
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const relative = path.relative(root, file);
  const directJwt = /(?:jwt\.verify|authorization|bearer|getRequest\s*\(|accessToken|id_token)/i.test(source);
  const result = [];
  function visit(node) {
    if (ts.isClassDeclaration(node) && node.name && hasDecorator(node, "Controller")) {
      const controller = firstStringArgument(decorators(node).find((decorator) => decoratorName(decorator).endsWith("Controller")));
      const classPermissionsGuard = hasPermissionsGuard(node);
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member) || !member.name) continue;
        const route = decorators(member).find((decorator) => routeDecorators.has(decoratorName(decorator)));
        if (!route) continue;
        const method = decoratorName(route).toUpperCase();
        result.push({
          file: relative,
          controller: node.name.text,
          methodName: member.name.getText(),
          method,
          path: joinPath(controller, firstStringArgument(route)),
          permissions: hasPermissions(member),
          permissionsGuard: classPermissionsGuard || hasPermissionsGuard(member),
          mutation: mutationDecorators.has(method),
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return { file: relative, directJwtReader: directJwt, routes: result };
}

const inventories = filesUnder(sourceRoot).map(inventoryFile);
const routes = inventories.flatMap((item) => item.routes);
const permissionRoutes = routes.filter((route) => route.permissions);
const missingPermissionsGuard = permissionRoutes.filter((route) => !route.permissionsGuard);
const directJwtReaders = inventories.filter((item) => item.directJwtReader).map((item) => item.file).sort();
const output = {
  schemaVersion: 1,
  sourceRoot: path.relative(root, sourceRoot),
  controllerFiles: inventories.length,
  controllerCount: new Set(routes.map((route) => route.controller)).size,
  routeCount: routes.length,
  mutationRouteCount: routes.filter((route) => route.mutation).length,
  permissionRouteCount: permissionRoutes.length,
  permissionRoutesWithoutGuard: missingPermissionsGuard,
  directJwtReaders,
  routes,
};
process.stdout.write(JSON.stringify(output, null, 2) + "\n");
