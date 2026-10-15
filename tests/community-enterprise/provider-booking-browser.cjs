// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, randomUUID } = require("node:crypto");
const { chromium, expect } = require("@playwright/test");
const { seedTeamBrowserFixture } = require("./team-browser-journey.cjs");
const { sessionFor } = require("./invitation-browser-journey.cjs");
const origin = "http://127.0.0.1:38917";
async function seedProviderFixture(pool) {
  const fixture = await seedTeamBrowserFixture(pool);
  fixture.redactions = [];
  for (const [id, slug, dirName, type, userId, calendar] of [
    [77, "google-calendar", "googlecalendar", "google_calendar", 7001, "google-original"],
    [78, "office365-calendar", "office365calendar", "office365_calendar", 7002, "office-original"],
  ]) {
    const access = randomBytes(24).toString("hex"),
      secret = randomBytes(24).toString("hex");
    fixture.redactions.push(access, secret);
    await pool.query('INSERT INTO "App" (slug,"dirName",enabled,keys) VALUES ($1,$2,true,$3)', [
      slug,
      dirName,
      JSON.stringify({
        client_id: "synthetic-client",
        client_secret: secret,
        redirect_uris: [origin + "/unused-fixture-callback"],
      }),
    ]);
    await pool.query('INSERT INTO "Credential" (id,type,"appId","userId",key) VALUES ($1,$2,$3,$4,$5)', [
      id,
      type,
      slug,
      userId,
      JSON.stringify({ access_token: access, token_type: "Bearer", expiry_date: Date.now() + 86400000 }),
    ]);
    await pool.query(
      'INSERT INTO "DestinationCalendar" (integration,"externalId","userId","credentialId") VALUES ($1,$2,$3,$4)',
      [type, calendar, userId, id]
    );
    await pool.query(
      'INSERT INTO "SelectedCalendar" (id,integration,"externalId","userId","credentialId") VALUES ($1,$2,$3,$4,$5)',
      [randomUUID(), type, calendar, userId, id]
    );
  }
  await pool.query(
    'INSERT INTO "Schedule" (id,"userId",name,"timeZone") VALUES (9002,7002,\'Office availability\',\'UTC\'); INSERT INTO "Availability" ("userId","scheduleId",days,"startTime","endTime") VALUES (7002,9002,ARRAY[0,1,2,3,4,5,6],\'09:00\',\'17:00\'); UPDATE users SET "defaultScheduleId"=9002 WHERE id=7002'
  );
  return fixture;
}
async function runProviderJourney({ pool, fixture, t }) {
  const session = await sessionFor(fixture, 7001);
  const created = await session.client.mutation("create", {
    organizationId: 700,
    name: "Provider fixtures",
    slug: "provider-team",
    timeZone: "UTC",
    requestId: randomUUID(),
  });
  await session.client.mutation("setMember", {
    organizationId: 700,
    teamId: created.teamId,
    userId: 7002,
    role: "MEMBER",
    requestId: randomUUID(),
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const guest = await browser.newContext({ timezoneId: "UTC", locale: "en-US" });
    await guest.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
    );
    for (const [id, provider, type, userId, calendar, mail] of [
      [8101, "google", "google_calendar", 7001, "google-original", "smoke@example.test"],
      [8102, "microsoft", "office365_calendar", 7002, "office-original", "colleague@example.test"],
    ]) {
      const slug = provider + "-calendar";
      await pool.query(
        'INSERT INTO "EventType" (id,title,slug,length,"teamId","schedulingType","minimumBookingNotice","timeZone",locations) VALUES ($1,\'Provider-backed appointment\',$2,30,$3,\'roundRobin\',0,\'UTC\',$4)',
        [id, slug, created.teamId, JSON.stringify([{ type: "inPerson", address: "Fixture room" }])]
      );
      await pool.query('INSERT INTO "Host" ("userId","eventTypeId","isFixed") VALUES ($1,$2,false);', [
        userId,
        id,
      ]);
      await pool.query('INSERT INTO "_user_eventtype" ("A","B") VALUES ($1,$2)', [id, userId]);
      const page = await guest.newPage();
      const loaded = await page.goto(`${origin}/org/preview-org/team/provider-team/${slug}`, {
        waitUntil: "domcontentloaded",
      });
      assert.equal(loaded.status(), 200);
      await expect(page.getByTestId("public-team-booker")).toBeVisible({ timeout: 45000 });
      const start = new Date();
      start.setUTCDate(start.getUTCDate() + 4);
      start.setUTCHours(12, 0, 0, 0);
      const input = {
        eventTypeId: id,
        eventTypeSlug: slug,
        start: start.toISOString(),
        end: new Date(start.getTime() + 1800000).toISOString(),
        user: "provider-team",
        timeZone: "UTC",
        language: "en",
        metadata: {},
        responses: {
          name: "Synthetic Invitee",
          email: "invitee@example.test",
          location: { value: "inPerson", optionValue: "Fixture room" },
        },
      };
      let mark = fixture.smtp.count();
      const response = await guest.request.post(origin + "/api/book/event", { data: input });
      const booking = await response.json();
      assert.ok(response.status() < 400, JSON.stringify(booking).slice(0, 500));
      const original = (
        await pool.query(
          'SELECT r.id,r.uid,r."externalCalendarId",r."credentialId" FROM "BookingReference" r JOIN "Booking" b ON b.id=r."bookingId" WHERE b.uid=$1 AND r.type=$2',
          [booking.uid, type]
        )
      ).rows;
      assert.equal(original.length, 1);
      assert.equal(original[0].externalCalendarId, calendar);
      assert.ok(original[0].uid);
      await fixture.smtp.expectRecipientsSince(mark, [mail, "invitee@example.test"]);
      // Simulate an independently saved destination preference. Existing resources
      // must retain their recorded calendar rather than following this preference.
      await pool.query('UPDATE "DestinationCalendar" SET "externalId"=$1 WHERE "userId"=$2', [
        provider === "google" ? "google-new-default" : "office-new-default",
        userId,
      ]);
      const movedStart = new Date(start.getTime() + 86400000);
      mark = fixture.smtp.count();
      const move = await guest.request.post(origin + "/api/book/event", {
        data: {
          ...input,
          rescheduleUid: booking.uid,
          start: movedStart.toISOString(),
          end: new Date(movedStart.getTime() + 1800000).toISOString(),
        },
      });
      const moved = await move.json();
      assert.ok(move.status() < 400, JSON.stringify(moved).slice(0, 500));
      const persisted = (
        await pool.query(
          'SELECT r.uid,r."externalCalendarId",r."credentialId" FROM "BookingReference" r JOIN "Booking" b ON b.id=r."bookingId" WHERE b.uid=$1 AND r.type=$2',
          [moved.uid, type]
        )
      ).rows;
      assert.equal(persisted.length, 1);
      assert.equal(persisted[0].uid, original[0].uid);
      assert.equal(persisted[0].externalCalendarId, calendar);
      assert.equal(persisted[0].credentialId, original[0].credentialId);
      await fixture.smtp.expectRecipientsSince(mark, [mail, "invitee@example.test"]);
      const csrf = await (await guest.request.get(origin + "/api/csrf")).json();
      mark = fixture.smtp.count();
      const cancel = await guest.request.post(origin + "/api/cancel", {
        data: {
          uid: moved.uid,
          csrfToken: csrf.csrfToken,
          cancellationReason: "Synthetic provider acceptance",
        },
      });
      assert.equal(cancel.status(), 200);
      await fixture.smtp.expectRecipientsSince(mark, [mail, "invitee@example.test"]);
      assert.equal(
        (await pool.query('SELECT status FROM "Booking" WHERE uid=$1', [moved.uid])).rows[0].status,
        "cancelled"
      );
      const receipt = JSON.parse(
        fs.readFileSync(
          path.join(path.dirname(process.env.CAL_ENTERPRISE_TEST_SOCKET), "provider-wire.json"),
          "utf8"
        )
      );
      const calls = receipt.calls.filter((call) => call.provider === provider);
      assert.deepEqual(
        calls.map((call) => call.method),
        ["POST", provider === "google" ? "PUT" : "PATCH", "DELETE"]
      );
      assert.ok(calls.every((call) => call.calendar === calendar && !call.missing && !call.unexpected));
      assert.equal(receipt.resources.filter((key) => key.startsWith(provider + "|")).length, 0);
      await page.close();
    }
    const output = path.resolve(__dirname, "../../test-results/community-enterprise");
    fs.mkdirSync(output, { recursive: true });
    fs.copyFileSync(
      path.join(path.dirname(process.env.CAL_ENTERPRISE_TEST_SOCKET), "provider-wire.json"),
      path.join(output, "provider-wire.json")
    );
    t.diagnostic(
      JSON.stringify({
        nativeOidcExchanges: fixture.oidc.exchanges(),
        providers: ["google", "microsoft"],
        lifecycles: "create-change-default-reschedule-cancel",
        resourceBindingPreserved: true,
        capturedSmtp: fixture.smtp.count(),
        scope:
          "actual built web/bookings/database/auth and retained provider adapters; intercepted provider network, synthetic OAuth tokens and test issuer; no live provider or deployment acceptance",
      })
    );
  } finally {
    await browser.close();
  }
}
module.exports = { seedProviderFixture, runProviderJourney };
