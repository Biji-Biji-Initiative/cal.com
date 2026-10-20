// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { compile } = require("./booking-listing-fixture.cjs");
const { filterReqHeaders } = compile("apps/api/v2/src/lib/filterReqHeaders.ts");
const marker = "[REDACTED]";
/** @type {[string, import("node:http").IncomingHttpHeaders, string[]][]} */
const cases = [
  ["lowercase bearer", { authorization: "Bearer synthetic-only-bearer" }, ["synthetic-only-bearer"]],
  ["title-case basic", { Authorization: "Basic synthetic-only-basic" }, ["synthetic-only-basic"]],
  [
    "both casings",
    { Authorization: "Bearer synthetic-upper", authorization: "Bearer synthetic-lower" },
    ["synthetic-upper", "synthetic-lower"],
  ],
  [
    "multiple values",
    { Authorization: ["Bearer synthetic-first", "Bearer synthetic-second"] },
    ["synthetic-first", "synthetic-second"],
  ],
  ["empty credential", { authorization: "" }, []],
];
for (const [name, headers, values] of cases) {
  test(`native request header diagnostics redact ${name}`, () => {
    const before = structuredClone(headers);
    const output = filterReqHeaders(headers);
    assert.equal(output.Authorization, marker);
    for (const value of values) assert.equal(JSON.stringify(output).includes(value), false);
    assert.deepEqual(headers, before);
  });
}
test("native header diagnostics preserve absent authorization", () => {
  assert.equal(filterReqHeaders({}).Authorization, undefined);
});
test("native diagnostics retain selected context and omit other credential headers", () => {
  const output = filterReqHeaders({
    authorization: "Bearer synthetic-context-bearer",
    cookie: "synthetic-cookie",
    "x-cal-secret-key": "synthetic-client-secret",
    "x-request-id": "request-one",
    "x-cal-client-id": "client-one",
    "cal-api-version": "2024-08-13",
    "content-type": "application/json",
  });
  const serialized = JSON.stringify(output);
  for (const value of ["synthetic-context-bearer", "synthetic-cookie", "synthetic-client-secret"])
    assert.equal(serialized.includes(value), false);
  assert.equal(output["X-Request-Id"], "request-one");
  assert.equal(output["X-Cal-Client-Id"], "client-one");
  assert.equal(output["Cal-Api-Version"], "2024-08-13");
  assert.equal(output["Content-Type"], "application/json");
});
test("actual native TRPC error filter cannot copy bearer into its logger sink", () => {
  const { TRPCError } = require("@trpc/server");
  const { TRPCExceptionFilter } = compile("apps/api/v2/src/filters/trpc-exception.filter.ts", {
    "@/lib/extract-user-context": compile("apps/api/v2/src/lib/extract-user-context.ts"),
    "@/lib/filterReqHeaders": { filterReqHeaders },
    "@nestjs/common": require("@nestjs/common"),
    "@calcom/platform-constants": compile("packages/platform/constants/api.ts"),
    "@calcom/platform-libraries": { TRPCError },
  });
  const filter = new TRPCExceptionFilter(),
    logs = [];
  filter.logger.error = (...args) => {
    logs.push(args);
  };
  /** @type {{ code?: number, payload?: { error: { code: string } } }} */
  const responseState = {};
  const response = {
    setHeader() {},
    status(value) {
      responseState.code = value;
      return this;
    },
    json(value) {
      responseState.payload = value;
    },
  };
  const request = {
    headers: { authorization: "Bearer synthetic-native-filter-bearer" },
    body: {},
    url: "/v2/bookings",
    method: "GET",
  };
  filter.catch(new TRPCError({ code: "FORBIDDEN", message: "Scope unavailable" }), {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  });
  assert.equal(responseState.code, 403);
  assert.ok(responseState.payload);
  assert.equal(responseState.payload.error.code, "TRPCError");
  assert.equal(logs.length, 1);
  assert.equal(JSON.stringify(logs).includes("synthetic-native-filter-bearer"), false);
  assert.equal(logs[0][1].headers.Authorization, marker);
});
