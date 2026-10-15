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
const seedCustomRoleFixture = seedInvitationBrowserFixture;
function clientFor(session, route, headers = {}) {
  return createTRPCUntypedClient({
    transformer: superjson,
    links: [
      httpBatchLink({
        url: `${origin}/api/trpc/${route}`,
        headers: () => ({
          Origin: origin,
          ...(session
            ? { Cookie: Array.from(session.jar, ([name, value]) => `${name}=${value}`).join("; ") }
            : {}),
          ...headers,
        }),
      }),
    ],
  });
}
async function runCustomRoleJourney({ pool, fixture, t }) {
  const owner = await sessionFor(fixture, 7001),
    reader = await sessionFor(fixture, 7002),
    other = await sessionFor(fixture, 7003);
  const initial = await owner.client.mutation("reviewOrganization", {
    name: "Scoped Access Workspace",
    slug: "scoped-access",
    timeZone: "UTC",
    ownerEmail: "smoke@example.test",
    memberEmails: ["invitee@example.test", "colleague@example.test"],
  });
  const organization = await owner.client.mutation("provisionOrganization", initial.input);
  const foreignPlan = await owner.client.mutation("reviewOrganization", {
    name: "Other Workspace",
    slug: "other-access",
    timeZone: "UTC",
    ownerEmail: "colleague@example.test",
    memberEmails: [],
  });
  const foreignOrg = await owner.client.mutation("provisionOrganization", foreignPlan.input);
  const teams = [];
  for (const slug of ["delegated", "sibling"]) {
    const team = await owner.client.mutation("create", {
      organizationId: organization.organizationId,
      name: `Team ${slug}`,
      slug,
      timeZone: "UTC",
      requestId: randomUUID(),
    });
    teams.push(team.teamId);
    for (const userId of [7002, 7003])
      await owner.client.mutation("setMember", {
        organizationId: organization.organizationId,
        teamId: team.teamId,
        userId,
        role: "MEMBER",
        requestId: randomUUID(),
      });
  }
  const foreign = await other.client.mutation("create", {
    organizationId: foreignOrg.organizationId,
    name: "Foreign team",
    slug: "foreign",
    timeZone: "UTC",
    requestId: randomUUID(),
  });
  const subjects = (await pool.query("SELECT id,uuid FROM users WHERE id IN (7001,7002,7003)")).rows;
  const target = subjects.find((person) => person.id === 7002);
  const scope = { organizationId: organization.organizationId, scopeId: teams[0] };
  const roles = clientFor(owner, "enterpriseRoles");
  await assert.rejects(
    clientFor(null, "enterpriseRoles").query("catalog", scope),
    (error) => error.data?.code === "UNAUTHORIZED"
  );
  await assert.rejects(
    clientFor(reader, "enterpriseRoles").mutation("create", {
      ...scope,
      name: "Denied",
      permissions: ["booking.readTeamBookings"],
      requestId: randomUUID(),
    }),
    (error) => error.data?.code === "FORBIDDEN"
  );
  await assert.rejects(
    clientFor(owner, "enterpriseRoles", { Origin: "https://untrusted.example.test" }).mutation("create", {
      ...scope,
      name: "Denied",
      permissions: ["booking.readTeamBookings"],
      requestId: randomUUID(),
    }),
    (error) => error.data?.code === "FORBIDDEN"
  );
  await assert.rejects(
    roles.mutation("create", {
      ...scope,
      name: "No privilege escalation",
      permissions: ["organization.update"],
      requestId: randomUUID(),
    }),
    (error) => error.data?.code === "BAD_REQUEST"
  );
  // Only the synthetic booking data is seeded. Role definition and assignment
  // below execute through the actual owner interface and primary transaction.
  const records = [
    [9101, teams[0], 7003, "delegated-booking"],
    [9102, teams[1], 7003, "sibling-booking"],
    [9103, foreign.teamId, 7003, "foreign-booking"],
    [9104, null, 7003, "coworker-private"],
    [9105, null, 7002, "own-personal"],
  ];
  for (const [id, teamId, userId, uid] of records) {
    await pool.query(
      'INSERT INTO "EventType" (id,title,slug,length,"teamId","userId") VALUES ($1,$2,$2,30,$3,$4)',
      [id, uid, teamId, userId]
    );
    await pool.query(
      'INSERT INTO "Booking" (id,uid,title,"userId","eventTypeId","startTime","endTime",status) VALUES ($1,$2,$2,$3,$1,\'2030-01-01T10:00:00Z\',\'2030-01-01T10:30:00Z\',\'ACCEPTED\')',
      [id, uid, userId]
    );
  }
  const bookings = clientFor(reader, "bookings");
  const list = async (filters = {}) =>
    bookings.query("get", { limit: 100, offset: 0, filters: { status: "upcoming", ...filters } });
  const uids = (result) => result.bookings.map((booking) => booking.uid).sort();
  assert.deepEqual(uids(await list()), ["own-personal"]);
  await assert.rejects(
    bookings.query("getBookingDetails", { uid: "delegated-booking" }),
    (error) => error.data?.code === "FORBIDDEN"
  );
  const before = (
    await pool.query('SELECT id,uuid,email,role,"organizationId","movedToProfileId" FROM users WHERE id=7002')
  ).rows[0];
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ timezoneId: "UTC", locale: "en-US" });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
    );
    await context.addCookies(Array.from(owner.jar, ([name, value]) => ({ name, value, url: origin })));
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    const response = await page.goto(origin + "/settings/enterprise/teams", {
      waitUntil: "domcontentloaded",
    });
    assert.equal(response.status(), 200);
    await expect(page.getByTestId("custom-roles")).toBeVisible();
    await page.getByTestId("custom-role-scope").selectOption(String(teams[0]));
    const create = page.getByTestId("create-custom-role");
    await create.locator('input[name="name"]').fill("Shared booking observer");
    await create
      .locator('input[name="description"]')
      .fill("Reviewed read access, no editing or administration");
    const bookingPermission = create.getByRole("checkbox", {
      name: "Read shared bookings in this scope",
      exact: true,
    });
    await bookingPermission.focus();
    await page.keyboard.press("Space");
    await expect(bookingPermission).toBeChecked();
    const eventPermission = create.getByRole("checkbox", {
      name: "Browse event types in this scope",
      exact: true,
    });
    await eventPermission.check();
    await create.getByRole("button", { name: "Create custom role", exact: true }).click();
    await expect(page.getByTestId("role-notice")).toHaveText("Role created. No member received access yet.");
    assert.deepEqual(uids(await list()), ["own-personal"]);
    const role = (
      await pool.query('SELECT id FROM "Role" WHERE "teamId"=$1 AND name=\'Shared booking observer\'', [
        teams[0],
      ])
    ).rows[0];
    assert.ok(role);
    const assign = page.getByTestId("assign-custom-role");
    await assign.locator('select[name="userId"]').selectOption("7002");
    await assign.locator('select[name="roleId"]').selectOption(role.id);
    await assign.getByRole("button", { name: "Review this assignment" }).click();
    await expect(page.getByTestId("custom-role-review")).toBeVisible();
    assert.deepEqual(uids(await list()), ["own-personal"]);
    await pool.query("UPDATE users SET name='Updated review subject' WHERE id=7002");
    await page.getByTestId("confirm-custom-role").click();
    await expect(page.getByRole("alert").filter({ hasText: "review again" })).toBeVisible();
    assert.deepEqual(uids(await list()), ["own-personal"]);
    await assign.getByRole("button", { name: "Review this assignment" }).click();
    await expect(page.getByTestId("custom-role-review")).toContainText("Updated review subject");
    const output = path.resolve(__dirname, "../../test-results/community-enterprise");
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, "custom-role-review.png"), fullPage: true });
    await page.getByTestId("confirm-custom-role").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("role-notice")).toHaveText(
      "Assignment recorded. Current membership has been refreshed."
    );
    assert.deepEqual(uids(await list()), ["delegated-booking", "own-personal"]);
    assert.equal((await list()).totalCount, 2);
    assert.ok(await bookings.query("getBookingDetails", { uid: "delegated-booking" }));
    for (const uid of ["sibling-booking", "foreign-booking", "coworker-private"])
      await assert.rejects(
        bookings.query("getBookingDetails", { uid }),
        (error) => error.data?.code === "FORBIDDEN"
      );
    const eventGroups = await clientFor(reader, "eventTypes").query("getUserEventGroups", {});
    assert.ok(eventGroups.eventTypeGroups.some((group) => group.teamId === teams[0]));
    assert.equal(eventGroups.teamPermissions[teams[0]].canCreateEventType, false);

    assert.deepEqual(uids(await list({ teamIds: [teams[1]] })), []);
    assert.deepEqual(uids(await list({ teamIds: [foreign.teamId] })), []);
    assert.deepEqual(uids(await list({ eventTypeIds: [9104] })), []);
    await assert.rejects(
      roles.mutation("review", { ...scope, scopeId: teams[1], target, roleId: role.id }),
      (error) => error.data?.code === "BAD_REQUEST"
    );
    const memberRow = (
      await pool.query(
        'SELECT role,accepted,"customRoleId" FROM "Membership" WHERE "userId"=7002 AND "teamId"=$1',
        [teams[0]]
      )
    ).rows[0];
    assert.deepEqual(memberRow, { role: "MEMBER", accepted: true, customRoleId: role.id });
    const after = (
      await pool.query(
        'SELECT id,uuid,email,role,"organizationId","movedToProfileId" FROM users WHERE id=7002'
      )
    ).rows[0];
    assert.deepEqual(after, before);
    await assign.locator('select[name="roleId"]').selectOption("");
    await assign.getByRole("button", { name: "Review this assignment" }).click();
    await expect(page.getByTestId("custom-role-review")).toBeVisible();
    await page.getByTestId("confirm-custom-role").click();
    await expect(page.getByTestId("role-notice")).toHaveText(
      "Assignment recorded. Current membership has been refreshed."
    );
    assert.deepEqual(uids(await list()), ["own-personal"]);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM \"EnterpriseAuditEvent\" WHERE action='custom-role.assigned'"
        )
      ).rows[0].count,
      2
    );
    await assert.rejects(
      bookings.query("getBookingDetails", { uid: "delegated-booking" }),
      (error) => error.data?.code === "FORBIDDEN"
    );
    // Removal of operator authority uses the existing reviewed ownership flow,
    // then the same browser/API cookie cannot create another custom role.
    const transfer = await owner.client.mutation("reviewMemberChange", {
      organizationId: organization.organizationId,
      target: subjects.find((person) => person.id === 7003),
      operation: "transfer-ownership",
    });
    await owner.client.mutation("commitMemberChange", transfer.input);
    assert.deepEqual(await roles.query("capability", scope), { canManageRoles: false });
    await assert.rejects(
      roles.mutation("create", {
        ...scope,
        name: "Stale owner",
        permissions: ["eventType.read"],
        requestId: randomUUID(),
      }),
      (error) => error.data?.code === "FORBIDDEN"
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("scoped-role-editor")).toHaveCount(0);
    assert.equal(fixture.smtp.count(), 0);
    t.diagnostic(
      JSON.stringify({
        nativeIdentities: 3,
        roleCreatedWithoutGrant: true,
        staleReviewDenied: true,
        explicitScopeOnly: true,
        privateAndSiblingBookingsExcluded: true,
        unchangedSessionRevocation: true,
        ownerLossDenied: true,
        keyboardConfirmation: true,
        messagesSent: 0,
        scope:
          "actual local role UI, router, native sessions and PostgreSQL; TLS test IdP, synthetic appointments, no live membership or provider change",
      })
    );
  } finally {
    await browser.close();
  }
}
module.exports = { seedCustomRoleFixture, runCustomRoleJourney };
