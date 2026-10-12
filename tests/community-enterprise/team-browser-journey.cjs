// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { chromium, expect } = require("@playwright/test");
const { createTRPCUntypedClient, httpBatchLink } = require("@trpc/client");
const superjson = require("superjson").default;
const origin = "http://127.0.0.1:38917";

async function seedTeamBrowserFixture(pool) {
  await pool.query(
    'UPDATE "users" SET "completedOnboarding"=true, "emailVerified"=NOW(), "timeZone"=$1 WHERE id=7001',
    ["UTC"]
  );
  await pool.query(
    'INSERT INTO "users" (id, uuid, email, name, username, "completedOnboarding", "emailVerified", "timeZone") VALUES ($1,$2,$3,$4,$5,true,NOW(),$6)',
    [7002, randomUUID(), "colleague@example.test", "Synthetic Colleague", "synthetic-colleague", "UTC"]
  );
  await pool.query(`INSERT INTO "Team" (id,name,slug,"isOrganization","timeZone") VALUES
    (700,'Preview Organization','preview-org',true,'UTC'),(701,'Other Organization','other-org',true,'UTC');
    INSERT INTO "Membership" ("userId","teamId",accepted,role) VALUES (7001,700,true,'OWNER'),(7002,700,true,'MEMBER');
    SELECT setval('"Team_id_seq"', 701, true);
    INSERT INTO "Schedule" (id,"userId",name,"timeZone") VALUES (9001,7001,'Preview schedule','UTC');
    INSERT INTO "Availability" ("userId","scheduleId",days,"startTime","endTime") VALUES (7001,9001,ARRAY[0,1,2,3,4,5,6],'09:00:00','17:00:00');
    UPDATE "users" SET "defaultScheduleId"=9001 WHERE id=7001;`);
  return {};
}

async function runTeamBrowserJourney({ pool, fixture, t }) {
  const jar = new Map();
  const request = async (route, options = {}) => {
    const response = await fetch(`${origin}${route}`, {
      redirect: "manual",
      ...options,
      headers: {
        Cookie: Array.from(jar, ([key, value]) => `${key}=${value}`).join("; "),
        ...options.headers,
      },
      signal: AbortSignal.timeout(30000),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      const at = pair.indexOf("=");
      if (at !== -1) jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return response;
  };
  const csrf = await (await request("/api/auth/csrf")).json();
  const login = await request("/api/auth/signin/authentik", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      csrfToken: csrf.csrfToken,
      callbackUrl: `${origin}/settings/enterprise/teams`,
      json: "true",
    }).toString(),
  });
  assert.ok(login.status < 400, "Native Authentik sign-in must start");
  const authorizeUrl = login.headers.get("location") ?? (await login.json()).url;
  const callback = new URL(await fixture.oidc.authorize(authorizeUrl));
  assert.equal(callback.origin, origin);
  const completed = await request(`${callback.pathname}${callback.search}`);
  assert.ok(completed.status < 400);
  assert.equal(fixture.oidc.exchanges(), 1, "The real application must exchange one OIDC authorization code");
  const session = await (await request("/api/auth/session")).json();
  assert.equal(session.user?.id, 7001, "Use an issued native session, never a manufactured cookie");
  const client = createTRPCUntypedClient({
    transformer: superjson,
    links: [
      httpBatchLink({
        url: `${origin}/api/trpc/enterpriseTeams`,
        headers: () => ({ Cookie: Array.from(jar, ([key, value]) => `${key}=${value}`).join("; ") }),
      }),
    ],
  });
  let organizations;
  try {
    organizations = await client.query("overview");
  } catch (error) {
    // This runner uses only synthetic identities. Do not emit cookies or headers.
    console.error(
      "TEAM_RESPONSE_SHAPE",
      JSON.stringify({
        status: error.meta?.response?.status,
        response: error.meta?.responseJSON,
      })
    );
    throw error;
  }
  assert.deepEqual(
    organizations.map((entry) => entry.organization.id),
    [700]
  );
  await assert.rejects(
    client.mutation("create", {
      organizationId: 701,
      name: "Forbidden",
      slug: "forbidden",
      timeZone: "UTC",
      requestId: randomUUID(),
    }),
    (error) => error.data?.code === "FORBIDDEN"
  );
  assert.equal(
    (await pool.query('SELECT count(*)::int AS count FROM "Team" WHERE "parentId"=701')).rows[0].count,
    0
  );
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ timezoneId: "UTC", locale: "en-US" });
    // Browser traffic is local only. Calendar and mail delivery are not part of
    // this synthetic test; live-provider acceptance remains a separate gate.
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
    );
    await context.addCookies(Array.from(jar, ([name, value]) => ({ name, value, url: origin })));
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    await page.goto(`${origin}/settings/enterprise/teams`, { waitUntil: "domcontentloaded" });
    const form = page.getByTestId("create-team");
    await expect(form).toBeVisible({ timeout: 30000 });
    await form.locator('input[name="name"]').fill("Preview advisory");
    await form.locator('input[name="slug"]').fill("advisory");
    await form.locator('input[name="timeZone"]').fill("UTC");
    const dialog = page.getByRole("dialog");
    if (await dialog.count()) {
      console.error("INITIAL_DIALOG", JSON.stringify(await dialog.allTextContents()));
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible({ timeout: 5000 });
    }
    console.error("TEAM_FORM_BUTTONS", JSON.stringify(await form.getByRole("button").allTextContents()));
    console.error("TEAM_FORM_TEXT", (await form.innerText()).slice(0, 1000));
    const nextResponse = page.waitForResponse((response) =>
      response.url().includes("/enterpriseTeams/create")
    );
    await form.locator('button[type="submit"]').click();
    const response = await nextResponse;
    console.error("TEAM_MUTATION_STATUS", response.status());
    console.error("TEAM_MUTATION_BODY", (await response.text()).slice(0, 2000));

    await expect(page.getByRole("heading", { name: "Preview advisory", exact: true })).toBeVisible({
      timeout: 15000,
    });
    const teamId = (await pool.query('SELECT id FROM "Team" WHERE "parentId"=700 AND slug=$1', ["advisory"]))
      .rows[0].id;
    const membershipForm = page.getByTestId(`team-member-form-${teamId}`);
    await membershipForm.locator('select[name="userId"]').selectOption("7002");
    const savingMember = page.waitForResponse((response) =>
      response.url().includes("/enterpriseTeams/setMember")
    );
    await membershipForm.getByRole("button", { name: "Save membership" }).click();
    const savedMember = await savingMember;
    assert.equal(savedMember.status(), 200, "Membership mutation must complete successfully");
    const savedPayload = await savedMember.json();
    assert.ok(savedPayload[0]?.result, JSON.stringify(savedPayload));
    const teamSection = page.locator("section").filter({ has: page.locator(`#team-${teamId}`) });
    await expect(teamSection.locator("ul li").filter({ hasText: "Synthetic Colleague" })).toBeVisible({
      timeout: 15000,
    });
    const storedMember = await pool.query(
      'SELECT role, accepted FROM "Membership" WHERE "teamId"=$1 AND "userId"=7002',
      [teamId]
    );
    assert.deepEqual(storedMember.rows, [{ role: "MEMBER", accepted: true }]);
    const audits = await pool.query('SELECT action FROM "EnterpriseAuditEvent" ORDER BY "createdAt"');
    assert.deepEqual(
      audits.rows.map((row) => row.action),
      ["team.created", "team.member.set"]
    );
    await pool.query(
      'INSERT INTO "EventType" (id,title,slug,length,"teamId","schedulingType","minimumBookingNotice","timeZone",locations) VALUES ($1,$2,$3,30,$4,$5,0,$6,$7)',
      [
        8001,
        "Preview advisory call",
        "consult",
        teamId,
        "roundRobin", // Prisma maps the public ROUND_ROBIN enum to this DB value.
        "UTC",
        JSON.stringify([{ type: "inPerson", address: "Synthetic test meeting room" }]),
      ]
    );
    await pool.query('INSERT INTO "Host" ("userId","eventTypeId","isFixed") VALUES (7001,8001,false)');
    await pool.query('INSERT INTO "_user_eventtype" ("A","B") VALUES (8001,7001)');
    const guest = await browser.newContext({ timezoneId: "UTC", locale: "en-US" });
    await guest.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
    );
    const bookingPage = await guest.newPage();
    const loaded = await bookingPage.goto(`${origin}/org/preview-org/team/advisory/consult`, {
      waitUntil: "domcontentloaded",
    });
    assert.equal(loaded.status(), 200);
    await expect(bookingPage.getByTestId("public-team-booker")).toBeVisible({ timeout: 30000 });
    await expect(bookingPage.getByText("Preview advisory call", { exact: true }).first()).toBeVisible();
    const foreign = await guest.request.get(`${origin}/org/other-org/team/advisory/consult`);
    assert.equal(foreign.status(), 404);
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 3);
    start.setUTCHours(14, 0, 0, 0);
    const bookingInput = {
      eventTypeId: 8001,
      eventTypeSlug: "consult",
      start: start.toISOString(),
      end: new Date(start.getTime() + 1800000).toISOString(),
      user: "advisory",
      timeZone: "UTC",
      language: "en",
      metadata: {},
      responses: {
        name: "Synthetic Invitee",
        email: "invitee@example.test",
        location: { value: "inPerson", optionValue: "Synthetic test meeting room" },
      },
    };
    const connections = await pool.query(
      "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database()"
    );
    assert.ok(
      connections.rows[0].count < 36,
      "Application pools must leave test DB capacity for the booking transaction"
    );
    t.diagnostic(
      `Pre-booking application/test DB connections: ${connections.rows[0].count} (fixture maximum 40)`
    );
    const createdMailIndex = fixture.smtp.count();
    const booked = await guest.request.post(`${origin}/api/book/event`, { data: bookingInput });
    const bookingBody = await booked.json();
    assert.ok(booked.status() < 400, `Guest booking failed: ${JSON.stringify(bookingBody).slice(0, 800)}`);
    assert.equal(typeof bookingBody.uid, "string");
    const stored = (
      await pool.query('SELECT id, "userId", "eventTypeId", status FROM "Booking" WHERE uid=$1', [
        bookingBody.uid,
      ])
    ).rows[0];
    assert.equal(stored.userId, 7001);
    assert.equal(stored.eventTypeId, 8001);
    assert.equal(stored.status, "accepted");
    await fixture.smtp.expectDeliverySince(createdMailIndex, "scheduled");
    const rescheduledStart = new Date(start.getTime() + 86400000);
    const rescheduledMailIndex = fixture.smtp.count();
    const rescheduled = await guest.request.post(`${origin}/api/book/event`, {
      data: {
        ...bookingInput,
        rescheduleUid: bookingBody.uid,
        start: rescheduledStart.toISOString(),
        end: new Date(rescheduledStart.getTime() + 1800000).toISOString(),
      },
    });
    const moved = await rescheduled.json();
    assert.ok(rescheduled.status() < 400, `Reschedule failed: ${JSON.stringify(moved).slice(0, 800)}`);
    assert.equal(typeof moved.uid, "string");
    await fixture.smtp.expectDeliverySince(rescheduledMailIndex, "rescheduled");
    const refused = await guest.request.post(`${origin}/api/cancel`, {
      data: { uid: moved.uid, csrfToken: "0".repeat(64) },
    });
    assert.equal(refused.status(), 403, "Cancellation without the application CSRF token must remain denied");
    const guestCsrf = await (await guest.request.get(`${origin}/api/csrf`)).json();
    const cancelledMailIndex = fixture.smtp.count();
    const cancelled = await guest.request.post(`${origin}/api/cancel`, {
      data: {
        uid: moved.uid,
        csrfToken: guestCsrf.csrfToken,
        cancellationReason: "Synthetic acceptance test",
      },
    });
    assert.equal(cancelled.status(), 200, `Cancel failed: ${(await cancelled.text()).slice(0, 600)}`);
    assert.equal(
      (await pool.query('SELECT status FROM "Booking" WHERE uid=$1', [moved.uid])).rows[0].status,
      "cancelled"
    );
    await fixture.smtp.expectDeliverySince(cancelledMailIndex, "cancelled");
    t.diagnostic(
      JSON.stringify({
        scope:
          "Built browser UI, native OIDC session via TLS test issuer, real team API/audit and guest booking lifecycle with synthetic data; no deployed Authentik or external calendar/mail delivery",
        teamId,
        bookingLifecycle: "book-reschedule-cancel",
        capturedSmtpMessages: fixture.smtp.count(),
      })
    );
    await guest.close();
    await context.close();
  } finally {
    await browser.close();
  }
}
module.exports = { seedTeamBrowserFixture, runTeamBrowserJourney };
