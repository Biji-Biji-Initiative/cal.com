// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { inspect } = require("../../scripts/inventory-enterprise-token-readers.cjs");
test("aliased native cookie reader is classified by imported identity", () => {
  const result = inspect(
    "a.ts",
    'import { getToken as readCookie, type JWT } from "next-auth/jwt"; readCookie({});'
  );
  assert.deepEqual(
    result.bindings.map((row) => [row.imported, row.local, row.calls.map((call) => call.operation)]),
    [["getToken", "readCookie", ["getToken"]]]
  );
});
test("namespace and default reader calls are inventoried without counting signing", () => {
  const result = inspect(
    "a.ts",
    'import * as token from "jose"; import jwt from "jsonwebtoken"; token.jwtVerify(value,key); jwt.verify(value,key); jwt.sign({});'
  );
  assert.deepEqual(
    result.bindings.map((row) => row.calls.map((call) => call.operation)),
    [["jwtVerify"], ["verify"]]
  );
});
test("type-only token imports and strings/comments are not executable readers", () => {
  assert.equal(
    inspect(
      "a.ts",
      'import type { JWT } from "next-auth/jwt"; // getToken()\n const example = "jwt.verify(token)";'
    ),
    null
  );
});
test("unrelated names are not attributed to an imported token module", () => {
  assert.equal(inspect("a.ts", 'import { getToken } from "unrelated"; getToken({});'), null);
});
test("dynamic and CommonJS module loads remain explicit unresolved boundaries", () => {
  const result = inspect(
    "a.ts",
    'const jwt = require("jsonwebtoken"); await import("next-auth/jwt"); jwt.verify(x);'
  );
  assert.deepEqual(
    result.bindings.map((row) => row.type),
    ["dynamic-boundary", "dynamic-boundary"]
  );
});
test("re-exported readers are explicit boundaries rather than unobserved call claims", () => {
  assert.equal(
    inspect("a.ts", 'export { getToken as read } from "next-auth/jwt";').bindings[0].type,
    "reexport-boundary"
  );
});
test("Nest class injection stays visible even without inferred receiver calls", () => {
  const result = inspect(
    "a.ts",
    'import { JwtService } from "@nestjs/jwt"; class Guard { constructor(private jwt: JwtService) {} read(t:string){return this.jwt.verify(t)} }'
  );
  assert.equal(result.bindings[0].imported, "JwtService");
  assert.equal(result.bindings[0].calls.length, 0);
});
test("inventory retains accurate import and call line positions", () => {
  const result = inspect("a.ts", '\nimport { decode as read } from "next-auth/jwt";\n\nread({});');
  assert.equal(result.bindings[0].line, 2);
  assert.equal(result.bindings[0].calls[0].line, 4);
});
