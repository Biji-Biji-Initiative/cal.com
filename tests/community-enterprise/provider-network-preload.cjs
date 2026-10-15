// SPDX-License-Identifier: MIT
// Test-process preload only: the application/SDK/auth/client code remains native.
// Provider HTTP is a deterministic, non-relaying fixture; no token is recorded.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { setupServer } = require("msw/node");
const { http, HttpResponse } = require("msw");
const directory = process.env.CAL_TEST_PROVIDER_DIRECTORY;
assert.ok(directory && path.isAbsolute(directory));
assert.match(path.basename(directory), /^cal-enterprise-/);
assert.equal(fs.realpathSync(directory), directory);
assert.equal(path.dirname(process.env.CAL_ENTERPRISE_TEST_SOCKET || ""), directory);
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.searchParams.get("host"), process.env.CAL_ENTERPRISE_TEST_SOCKET);
const receipt = path.join(directory, "provider-wire.json");
const resources = new Map(),
  calls = [];
let serial = 0;
const record = (item) => {
  calls.push(item);
  fs.writeFileSync(receipt, JSON.stringify({ calls, resources: Array.from(resources.keys()) }));
};
const server = setupServer(
  http.all(/https:\/\/(www.googleapis.com|graph.microsoft.com)\//, async ({ request }) => {
    const url = new URL(request.url),
      provider = url.hostname === "www.googleapis.com" ? "google" : "microsoft";
    const body = ["POST", "PUT", "PATCH"].includes(request.method) ? await request.json() : null;
    if (provider === "google" && url.pathname.endsWith("/freeBusy"))
      return HttpResponse.json({
        calendars: Object.fromEntries(body.items.map((item) => [item.id, { busy: [] }])),
      });
    if (provider === "microsoft" && url.pathname.endsWith("/$batch"))
      return HttpResponse.json({
        responses: body.requests.map((item) => ({
          id: item.id,
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: { value: [] },
        })),
      });
    if (url.pathname.endsWith("/calendarView")) return HttpResponse.json({ value: [] });
    if (provider === "google" && url.pathname.endsWith("/calendarList"))
      return HttpResponse.json({
        items: [
          { id: "google-original", summary: "Original fixture calendar", primary: true, accessRole: "owner" },
          { id: "google-new-default", summary: "New fixture calendar", accessRole: "owner" },
        ],
      });
    if (provider === "microsoft" && url.pathname === "/v1.0/me/calendars")
      return HttpResponse.json({
        value: [
          {
            id: "office-original",
            name: "Original fixture calendar",
            canEdit: true,
            isDefaultCalendar: true,
          },
          { id: "office-new-default", name: "New fixture calendar", canEdit: true },
        ],
      });
    if (provider === "microsoft" && url.pathname === "/v1.0/me")
      return HttpResponse.json({ id: "fixture-user", mail: "colleague@example.test" });
    const matched = url.pathname.match(/\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    const calendar = matched ? decodeURIComponent(matched[1]) : null;
    const id = matched?.[2] ? decodeURIComponent(matched[2]) : null;
    if (!calendar) {
      record({ provider, method: request.method, path: url.pathname, unexpected: true });
      return HttpResponse.json(
        { error: { code: 400, message: "Unsupported test resource" } },
        { status: 400 }
      );
    }
    if (request.method === "POST" && !id) {
      const eventId = `fixture${++serial}`;
      const key = `${provider}|${calendar}|${eventId}`;
      const result = {
        ...body,
        id: eventId,
        iCalUID: `${eventId}@fixture.test`,
        iCalUId: `${eventId}@fixture.test`,
      };
      resources.set(key, result);
      record({ provider, method: "POST", calendar, id: eventId });
      return HttpResponse.json(result, { status: 201 });
    }
    const key = `${provider}|${calendar}|${id}`;
    if (!resources.has(key)) {
      record({ provider, method: request.method, calendar, id, missing: true });
      return HttpResponse.json(
        { error: { code: 404, message: "Fixture event not in this calendar" } },
        { status: 404 }
      );
    }
    if (request.method === "DELETE") {
      resources.delete(key);
      record({ provider, method: "DELETE", calendar, id });
      return new HttpResponse(null, { status: 204 });
    }
    if (request.method === "PUT" || request.method === "PATCH") {
      const result = { ...resources.get(key), ...body };
      resources.set(key, result);
      record({ provider, method: request.method, calendar, id });
      return HttpResponse.json(result);
    }
    if (request.method === "GET") return HttpResponse.json(resources.get(key));
    throw new Error("Unexpected provider-fixture operation");
  })
);
server.listen({
  onUnhandledRequest(request) {
    const url = new URL(request.url);
    if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return;
    throw new Error(`External traffic refused by provider fixture: ${url.hostname}`);
  },
});
fs.writeFileSync(receipt, JSON.stringify({ calls: [], resources: [] }));
