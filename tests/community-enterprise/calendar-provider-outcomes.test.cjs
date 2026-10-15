// SPDX-License-Identifier: MIT
// Actual retained manager/adapter methods and intercepted wire requests; no live account.
const assert = require("node:assert/strict");
const { test, before, after, beforeEach } = require("node:test");
const f = require("./calendar-provider-fixture.cjs");
const { wire, calls, credential, event, google, office, manager } = f;
before(() => wire.listen({ onUnhandledRequest: "error" }));
after(() => wire.close());
beforeEach(() => f.reset());
test("Google updates the stored calendar, not the newly configured default", async () => {
  await google.default(credential()).updateEvent("stored-event", event(), "original-calendar");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PUT");
  assert.match(calls[0].url.pathname, /\/calendars\/original-calendar\/events\/stored-event$/);
});
test("Google missing-resource response cannot prove deletion", async () => {
  f.status = 404;
  await assert.rejects(
    google.default(credential()).deleteEvent("stored-event", event(), "original-calendar")
  );
  assert.equal(calls.length, 1);
});
test("Google already-deleted response retains idempotent cleanup", async () => {
  f.status = 410;
  await google.default(credential()).deleteEvent("stored-event", event(), "original-calendar");
  assert.equal(calls.length, 1);
});
test("Google successful deletion supports an empty response body", async () => {
  f.status = 204;
  await google.default(credential()).deleteEvent("stored-event", event(), "original-calendar");
  assert.equal(calls.length, 1);
});
test("Microsoft update targets stored calendar with encoded opaque identifiers", async () => {
  await office
    .default(credential("office365_calendar"))
    .updateEvent("opaque/event?part", event(), "original/calendar");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[0].url.pathname, "/v1.0/me/calendars/original%2Fcalendar/events/opaque%2Fevent%3Fpart");
  assert.equal(calls[0].url.search, "");
});
test("Microsoft deletion uses the stored calendar instead of the default calendar", async () => {
  f.status = 204;
  await office
    .default(credential("office365_calendar"))
    .deleteEvent("stored-event", event(), "original-calendar");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "DELETE");
  assert.equal(calls[0].url.pathname, "/v1.0/me/calendars/original-calendar/events/stored-event");
});
test("missing calendar adapter is not successful event creation", async () => {
  assert.equal((await manager.createEvent(credential(), event())).success, false);
});
for (const value of [undefined, null, {}, { id: "" }, { id: "   " }, [], [{ id: "okay" }, {}]]) {
  test(`missing provider identity is not successful create/update: ${JSON.stringify(value)}`, async () => {
    f.adapter = { createEvent: async () => value, updateEvent: async () => value };
    assert.equal((await manager.createEvent(credential(), event())).success, false);
    assert.equal(
      (await manager.updateEvent(credential(), event(), "stored-event", "stored-calendar")).success,
      false
    );
  });
}
test("valid provider responses retain their identity and successful result", async () => {
  f.adapter = {
    createEvent: async () => ({ id: "stored-event" }),
    updateEvent: async () => ({ id: "stored-event" }),
  };
  const created = await manager.createEvent(credential(), event());
  const updated = await manager.updateEvent(credential(), event(), "stored-event", "stored-calendar");
  assert.equal(created.success, true);
  assert.equal(updated.success, true);
  assert.equal(created.createdEvent.id, "stored-event");
  assert.equal(updated.updatedEvent.id, "stored-event");
});
test("blank deletion reference fails before an adapter is loaded", async () => {
  await assert.rejects(manager.deleteEvent({ credential: credential(), event: event(), bookingRefUid: "" }));
  assert.equal(f.adapterLookups, 0);
});
test("missing deletion adapter cannot resolve as confirmed cleanup", async () => {
  await assert.rejects(
    manager.deleteEvent({ credential: credential(), event: event(), bookingRefUid: "stored-event" })
  );
});
for (const failure of [403, 404, 429, 500]) {
  test(`provider refusal ${failure} remains a failure without another resource target`, async () => {
    f.status = failure;
    await assert.rejects(
      google.default(credential()).deleteEvent("stored-event", event(), "original-calendar")
    );
    assert.equal(calls.length, 1);
    assert.match(calls[0].url.pathname, /original-calendar\/events\/stored-event$/);
  });
}
test("Microsoft Teams update reads and preserves the meeting body on the same stored resource", async () => {
  f.body = {
    id: "stored-event",
    isOnlineMeeting: true,
    body: { contentType: "html", content: "fixture-existing-meeting-block" },
    iCalUId: "retained-ical",
  };
  const result = await office
    .default(credential("office365_calendar"))
    .updateEvent("stored-event", { ...event(), location: "integrations:msteams" }, "original-calendar");
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET", "PATCH"]
  );
  assert.ok(
    calls.every((call) => call.url.pathname === "/v1.0/me/calendars/original-calendar/events/stored-event")
  );
  assert.match(calls[1].body.body.content, /fixture-existing-meeting-block/);
  assert.equal(result.iCalUID, "retained-ical");
});
for (const reference of ["", "   "]) {
  test(`empty reference ${JSON.stringify(reference)} causes no provider request`, async () => {
    await assert.rejects(google.default(credential()).updateEvent(reference, event(), "original-calendar"));
    await assert.rejects(google.default(credential()).deleteEvent(reference, event(), "original-calendar"));
    await assert.rejects(
      office.default(credential("office365_calendar")).updateEvent(reference, event(), "original-calendar")
    );
    await assert.rejects(
      office.default(credential("office365_calendar")).deleteEvent(reference, event(), "original-calendar")
    );
    assert.equal(calls.length, 0);
  });
}

const { findResultForReference } = f.eventManagerModule({});
test("provider display metadata matches its exact reference, not array position or provider alone", () => {
  const reference = {
    type: "google_calendar",
    uid: "provider-event",
    credentialId: 7,
    externalCalendarId: "calendar-seven",
  };
  const wrong = {
    type: "google_calendar",
    success: true,
    credentialId: 8,
    externalId: "calendar-eight",
    createdEvent: { id: "wrong", hangoutLink: "https://wrong.invalid" },
  };
  const right = {
    type: "google_calendar",
    success: true,
    credentialId: 7,
    externalId: "calendar-seven",
    createdEvent: { id: "right", hangoutLink: "https://right.invalid" },
  };
  assert.equal(findResultForReference([{ ...wrong, success: false }, wrong, right], reference), right);
  assert.equal(findResultForReference([wrong], reference), undefined);
  assert.equal(findResultForReference([right, { ...right }], reference), undefined);
  assert.equal(findResultForReference([right], undefined), undefined);
});
test("delegation identity retains precedence without crossing provider type", async () => {
  const Manager = f.eventManager({});
  const manager = new Manager({ credentials: [], destinationCalendar: null });
  manager.calendarCredentials = [{ ...credential(), id: 10, delegatedToId: "delegated-identity" }];
  const matched = await manager.getCalendarCredential(99, "google_calendar", "delegated-identity");
  assert.equal(matched.id, 10);
  assert.equal(await manager.getCalendarCredential(99, "office365_calendar", "delegated-identity"), null);
});
for (const calendar of [".", "..", "   "])
  test(`Microsoft invalid calendar path ${JSON.stringify(calendar)} is rejected before any request`, async () => {
    await assert.rejects(
      office.default(credential("office365_calendar")).updateEvent("event", event(), calendar)
    );
    await assert.rejects(
      office.default(credential("office365_calendar")).deleteEvent("event", event(), calendar)
    );
    assert.equal(calls.length, 0);
  });
test("Microsoft legacy reference uses the user's all-calendar event endpoint", async () => {
  await office.default(credential("office365_calendar")).updateEvent("opaque/event?part", event());
  assert.equal(calls[0].url.pathname, "/v1.0/me/events/opaque%2Fevent%3Fpart");
  assert.equal(calls[0].url.search, "");
});
test("update result retains account and external calendar for later reference persistence", async () => {
  f.adapter = { updateEvent: async () => ({ id: "event" }) };
  const result = await manager.updateEvent(credential(), event(), "event", "original-calendar");
  assert.equal(result.credentialId, 7);
  assert.equal(result.externalId, "original-calendar");
});

test("provider exception payloads do not become routine mutation logs or status text", async () => {
  const marker = "fixture-sensitive-" + require("node:crypto").randomUUID();
  const failure = Object.assign(new Error(marker), {
    calError: marker,
    config: { headers: { Authorization: marker } },
    response: { data: { message: marker } },
  });
  f.adapter = {
    createEvent: async () => {
      throw failure;
    },
    updateEvent: async () => {
      throw failure;
    },
  };
  const created = await manager.createEvent(credential(), event());
  const updated = await manager.updateEvent(credential(), event(), "stored-event", "stored-calendar");
  assert.equal(created.success, false);
  assert.equal(updated.success, false);
  assert.ok(!JSON.stringify([created, updated, f.messages]).includes(marker));
  assert.match(created.calError, /not confirm/);
  assert.match(updated.calError, /not confirm/);
});
test("reference metadata uses the explicit delegation identity rather than an obsolete numeric credential", () => {
  const reference = {
    type: "google_calendar",
    uid: "provider-event",
    credentialId: 99,
    delegationCredentialId: "delegated-identity",
    externalCalendarId: "same-calendar",
  };
  const result = {
    type: "google_calendar",
    success: true,
    credentialId: 10,
    delegatedToId: "delegated-identity",
    externalId: "same-calendar",
  };
  assert.equal(findResultForReference([result], reference), result);
  assert.equal(
    findResultForReference([{ ...result, delegatedToId: "another-identity" }], reference),
    undefined
  );
});

// An online-meeting body is part of the provider resource, not optional UI text.
// A failed read must not be followed by a blind write that removes that content.
for (const status of [403, 404]) {
  test(`Microsoft meeting body read ${status} blocks PATCH and calendar fallback`, async () => {
    f.status = status;
    await assert.rejects(
      office
        .default(credential("office365_calendar"))
        .updateEvent("stored-event", { ...event(), location: "integrations:msteams" }, "original-calendar")
    );
    assert.deepEqual(
      calls.map((call) => call.method),
      ["GET"]
    );
    assert.equal(calls[0].url.pathname, "/v1.0/me/calendars/original-calendar/events/stored-event");
  });
  test(`Microsoft cleanup refusal ${status} cannot probe another calendar`, async () => {
    f.status = status;
    await assert.rejects(
      office
        .default(credential("office365_calendar"))
        .deleteEvent("stored-event", event(), "original-calendar")
    );
    assert.deepEqual(
      calls.map((call) => call.method),
      ["DELETE"]
    );
    assert.equal(calls[0].url.pathname, "/v1.0/me/calendars/original-calendar/events/stored-event");
  });
}
test("Google failed stored-calendar update does not fall back to the new preference", async () => {
  f.status = 404;
  await assert.rejects(
    google.default(credential()).updateEvent("stored-event", event(), "original-calendar")
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PUT");
  assert.match(calls[0].url.pathname, /\/calendars\/original-calendar\/events\/stored-event$/);
});
test("Microsoft legacy deletion uses the all-calendar endpoint and accepts no-content success", async () => {
  f.status = 204;
  await office.default(credential("office365_calendar")).deleteEvent("opaque/event?part", event());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "DELETE");
  assert.equal(calls[0].url.pathname, "/v1.0/me/events/opaque%2Fevent%3Fpart");
  assert.equal(calls[0].url.search, "");
});
test("nonfinite and nonpositive numeric IDs cannot become provider success", async () => {
  for (const id of [0, -1, NaN, Infinity, -Infinity]) {
    f.adapter = { createEvent: async () => ({ id }), updateEvent: async () => ({ id }) };
    assert.equal((await manager.createEvent(credential(), event())).success, false);
    assert.equal(
      (await manager.updateEvent(credential(), event(), "stored-event", "stored-calendar")).success,
      false
    );
  }
  f.adapter = { createEvent: async () => ({ id: 42 }), updateEvent: async () => [{ id: 42 }] };
  assert.equal((await manager.createEvent(credential(), event())).success, true);
  assert.equal(
    (await manager.updateEvent(credential(), event(), "stored-event", "stored-calendar")).success,
    true
  );
});
