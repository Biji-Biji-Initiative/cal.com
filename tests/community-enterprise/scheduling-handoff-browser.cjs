// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { chromium, expect } = require("@playwright/test");
const { createTRPCUntypedClient, httpBatchLink } = require("@trpc/client");
const superjson = require("superjson").default;
const { seedInvitationBrowserFixture, sessionFor } = require("./invitation-browser-journey.cjs");
const origin = "http://127.0.0.1:38917";
async function seedHandoffFixture(pool) {
  return seedInvitationBrowserFixture(pool);
}
async function runHandoffJourney({ pool, fixture, t }) {
  const owner = await sessionFor(fixture, 7001),
    source = await sessionFor(fixture, 7002),
    successor = await sessionFor(fixture, 7003);
  const plan = await owner.client.mutation("reviewOrganization", {
    name: "Handoff workspace",
    slug: "handoff-workspace",
    timeZone: "UTC",
    ownerEmail: "smoke@example.test",
    memberEmails: ["invitee@example.test", "colleague@example.test"],
  });
  const org = await owner.client.mutation("provisionOrganization", plan.input);
  const team = await owner.client.mutation("create", {
    organizationId: org.organizationId,
    name: "Handoff team",
    slug: "handoff-team",
    timeZone: "UTC",
    requestId: randomUUID(),
  });
  for (const id of [7002, 7003])
    await owner.client.mutation("setMember", {
      organizationId: org.organizationId,
      teamId: team.teamId,
      userId: id,
      role: "MEMBER",
      requestId: randomUUID(),
    });
  const identities = (await pool.query("SELECT id,uuid FROM users WHERE id IN (7001,7002,7003)")).rows;
  const ref = (id) => identities.find((person) => person.id === id);
  // Only existing resource fixtures are seeded: the actual handoff, audit and
  // member removal must all happen through the built application's UI/services.
  for (const id of [7002, 7003]) {
    await pool.query('INSERT INTO "Schedule" (id,"userId",name,"timeZone") VALUES ($1,$2,$3,\'UTC\')', [
      id + 2000,
      id,
      `Availability ${id}`,
    ]);
    await pool.query(
      'INSERT INTO "Availability" ("userId","scheduleId",days,"startTime","endTime") VALUES ($1,$2,ARRAY[0,1,2,3,4,5,6],\'09:00:00\',\'17:00:00\')',
      [id, id + 2000]
    );
    await pool.query('UPDATE users SET "defaultScheduleId"=$1 WHERE id=$2', [id + 2000, id]);
  }
  const profileId = (
    await pool.query('SELECT id FROM "Profile" WHERE "userId"=7002 AND "organizationId"=$1', [
      org.organizationId,
    ])
  ).rows[0].id;
  const memberId = (
    await pool.query('SELECT id FROM "Membership" WHERE "userId"=7002 AND "teamId"=$1', [team.teamId])
  ).rows[0].id;
  await pool.query(
    'INSERT INTO "EventType" (id,title,slug,length,"teamId","userId","profileId","scheduleId","schedulingType","minimumBookingNotice","timeZone",locations) VALUES (9800,\'Community advice\',\'same-public-link\',30,$1,7002,$2,9002,\'roundRobin\',0,\'UTC\',$3)',
    [team.teamId, profileId, JSON.stringify([{ type: "inPerson", address: "Shared test meeting room" }])]
  );
  await pool.query(
    'INSERT INTO "Host" ("userId","eventTypeId","isFixed",priority,weight,"scheduleId","memberId") VALUES (7002,9800,false,2,100,9002,$1)',
    [memberId]
  );
  await pool.query('INSERT INTO "_user_eventtype" ("A","B") VALUES (9800,7002)');
  await pool.query(
    'INSERT INTO "Credential" (id,type,key,"userId") VALUES (9801,\'fixture-personal\',$1,7002)',
    [JSON.stringify({ encrypted: "synthetic-private-calendar" })]
  );
  await pool.query(
    'INSERT INTO "Booking" (uid,title,"userId","eventTypeId","startTime","endTime") VALUES (\'historic-booking-preserved\',\'Past appointment\',7002,9800,\'2020-01-01\',\'2020-01-02\')'
  );
  const past = (await pool.query("SELECT * FROM \"Booking\" WHERE uid='historic-booking-preserved'")).rows[0];
  const personBefore = (
    await pool.query(
      'SELECT id,uuid,email,role,"defaultScheduleId","organizationId","movedToProfileId" FROM users WHERE id=7002'
    )
  ).rows[0];
  assert.deepEqual(
    (await source.client.query("overview")).map((entry) => entry.organization.id),
    [org.organizationId]
  );
  const publicPath = `/org/handoff-workspace/team/handoff-team/same-public-link`;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ timezoneId: "UTC", locale: "en-US" });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
    );
    await context.addCookies(Array.from(owner.jar, ([name, value]) => ({ name, value, url: origin })));
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    assert.equal(
      (await page.goto(origin + "/settings/enterprise/teams", { waitUntil: "domcontentloaded" })).status(),
      200
    );
    const sourceRow = page.getByTestId("organization-member-7002");
    await sourceRow.getByTestId("review-removal").click();
    await expect(page.getByTestId("member-change-blockers")).toContainText("reassigned");
    await expect(page.getByTestId("confirm-member-change")).toBeDisabled();
    await sourceRow.getByTestId("open-scheduling-handoff").click();
    const panel = page.getByTestId("scheduling-handoff");
    await expect(panel).toBeVisible();
    await panel.getByTestId("handoff-event").selectOption("9800");
    await panel.getByTestId("handoff-successor").selectOption("7003");
    await panel.getByTestId("handoff-schedule").selectOption("9003");
    await panel.getByTestId("review-handoff").click();
    await expect(panel.getByTestId("handoff-review")).toBeVisible();
    await expect(panel.getByTestId("confirm-handoff")).toBeEnabled();
    assert.equal(
      (await pool.query('SELECT "userId" FROM "Host" WHERE "eventTypeId"=9800')).rows[0].userId,
      7002
    );
    // Stale review must not authorize a changed weighted assignment.
    await pool.query('UPDATE "Host" SET weight=101 WHERE "eventTypeId"=9800');
    await panel.getByTestId("confirm-handoff").click();
    await expect(panel.getByRole("alert")).toContainText("review the handoff again");
    assert.equal(
      (await pool.query('SELECT "userId" FROM "Host" WHERE "eventTypeId"=9800')).rows[0].userId,
      7002
    );
    await panel.getByTestId("review-handoff").click();
    await expect(panel.getByTestId("handoff-review")).toBeVisible();
    const output = path.resolve(__dirname, "../../test-results/community-enterprise");
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, "scheduling-handoff-review.png"), fullPage: true });
    assert.equal(fixture.smtp.count(), 0);
    await panel.getByTestId("confirm-handoff").click();
    await expect(panel.getByTestId("handoff-recorded")).toBeVisible();
    assert.equal(fixture.smtp.count(), 0, "Assignment configuration must not send appointment changes");
    const after = (
      await pool.query('SELECT id,slug,"teamId","userId","scheduleId" FROM "EventType" WHERE id=9800')
    ).rows[0];
    assert.deepEqual(after, {
      id: 9800,
      slug: "same-public-link",
      teamId: team.teamId,
      userId: 7003,
      scheduleId: 9003,
    });
    const host = (
      await pool.query('SELECT "userId","scheduleId",weight FROM "Host" WHERE "eventTypeId"=9800')
    ).rows[0];
    assert.deepEqual(host, { userId: 7003, scheduleId: 9003, weight: 101 });
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM \"EnterpriseAuditEvent\" WHERE action='organization.scheduling.handoff'"
        )
      ).rows[0].n,
      1
    );
    await sourceRow.getByTestId("review-removal").click();
    await expect(page.getByTestId("member-change-blockers")).toHaveCount(0);
    await expect(page.getByTestId("confirm-member-change")).toBeEnabled();
    await page.getByTestId("confirm-member-change").click();
    await expect(sourceRow).toHaveCount(0);
    assert.deepEqual(
      await source.client.query("overview"),
      [],
      "The unchanged source session no longer sees the removed organization"
    );
    await assert.rejects(
      source.client.query("handoffEvents", { organizationId: org.organizationId, source: ref(7003) }),
      (error) => error.data?.code === "FORBIDDEN"
    );
    assert.deepEqual(
      (
        await pool.query(
          'SELECT id,uuid,email,role,"defaultScheduleId","organizationId","movedToProfileId" FROM users WHERE id=7002'
        )
      ).rows[0],
      personBefore
    );
    assert.deepEqual(
      (await pool.query("SELECT * FROM \"Booking\" WHERE uid='historic-booking-preserved'")).rows[0],
      past
    );
    assert.equal((await pool.query('SELECT "userId" FROM "Credential" WHERE id=9801')).rows[0].userId, 7002);
    const guest = await browser.newContext({ timezoneId: "UTC", locale: "en-US" });
    await guest.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
    );
    const guestPage = await guest.newPage();
    assert.equal(
      (await guestPage.goto(origin + publicPath, { waitUntil: "domcontentloaded" })).status(),
      200
    );
    assert.ok(!guestPage.url().includes("/auth/"));
    const next = new Date();
    next.setUTCDate(next.getUTCDate() + 3);
    next.setUTCHours(10, 0, 0, 0);
    const from = new Date(next);
    from.setUTCHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + 1);
    const slots = createTRPCUntypedClient({
      transformer: superjson,
      links: [httpBatchLink({ url: origin + "/api/trpc/slots" })],
    });
    const query = {
      eventTypeId: 9800,
      eventTypeSlug: "same-public-link",
      usernameList: ["handoff-team"],
      isTeamEvent: true,
      orgSlug: "handoff-workspace",
      timeZone: "UTC",
      startTime: from.toISOString(),
      endTime: to.toISOString(),
    };
    assert.deepEqual((await slots.query("getSchedule", { ...query, routedTeamMemberIds: [7002] })).slots, {});
    const offered = await slots.query("getSchedule", { ...query, routedTeamMemberIds: [7003] });
    assert.ok(Object.values(offered.slots).flat().length > 0);
    // Use the retained loopback sink's synthetic-recipient contract, not a
    // widened SMTP allowlist. This browser has no native staff session; former
    // organization membership is not required to book as an anonymous guest.
    const bookingInput = {
      eventTypeId: 9800,
      eventTypeSlug: "same-public-link",
      start: next.toISOString(),
      end: new Date(next.getTime() + 1800000).toISOString(),
      timeZone: "UTC",
      language: "en",
      responses: {
        name: "Synthetic guest",
        email: "invitee@example.test",
        location: { value: "inPerson", optionValue: "Shared test meeting room" },
      },
      user: "handoff-team",
      metadata: {},
      orgSlug: "handoff-workspace",
      routedTeamMemberIds: [7003],
    };
    const mark = fixture.smtp.count();
    const booked = await guest.request.post(origin + "/api/book/event", { data: bookingInput });
    const body = await booked.json();
    assert.ok(booked.status() < 400, JSON.stringify(body).slice(0, 600));
    assert.equal(
      (await pool.query('SELECT "userId" FROM "Booking" WHERE uid=$1', [body.uid])).rows[0].userId,
      7003
    );
    await fixture.smtp.expectRecipientsSince(mark, ["colleague@example.test", "invitee@example.test"]);
    const csrf = await (await guest.request.get(origin + "/api/csrf")).json();
    const cancelMark = fixture.smtp.count();
    const cancelled = await guest.request.post(origin + "/api/cancel", {
      data: { uid: body.uid, csrfToken: csrf.csrfToken, cancellationReason: "Synthetic handoff acceptance" },
    });
    assert.equal(cancelled.status(), 200);
    await fixture.smtp.expectRecipientsSince(cancelMark, ["colleague@example.test", "invitee@example.test"]);
    await page.screenshot({ path: path.join(output, "scheduling-handoff-completed.png"), fullPage: true });
    await guest.close();
    t.diagnostic(
      JSON.stringify({
        nativeIdentities: fixture.oidc.exchanges(),
        staleHandoffDenied: true,
        sharedHostTransferred: true,
        plannedRemovalUnblocked: true,
        stablePublicPath: publicPath,
        successorBookingOwner: 7003,
        departedHostSlots: 0,
        capturedLocalMessages: fixture.smtp.count(),
        privateIdentityCredentialsHistoryPreserved: true,
        scope:
          "actual local web/domain/primary DB, native test-IdP sessions and SMTP sink; no real provider transfer, future-appointment reassignment or live deployment",
      })
    );
  } finally {
    await browser.close();
  }
}
module.exports = { seedHandoffFixture, runHandoffJourney };
