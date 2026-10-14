// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, randomBytes, createHash } = require("node:crypto");
const { chromium, expect } = require("@playwright/test");
const { seedInvitationBrowserFixture, sessionFor } = require("./invitation-browser-journey.cjs");
const { createTRPCUntypedClient, httpBatchLink } = require("@trpc/client");
const superjson = require("superjson").default;
const origin = "http://127.0.0.1:38917";
async function seedMemberLifecycleFixture(pool) {
  return seedInvitationBrowserFixture(pool);
}
async function runMemberLifecycleJourney({ pool, fixture, t }) {
  const owner = await sessionFor(fixture, 7001),
    member = await sessionFor(fixture, 7002),
    successor = await sessionFor(fixture, 7003);
  const initial = await owner.client.mutation("reviewOrganization", {
    name: "Synthetic Member Workspace",
    slug: "member-workspace",
    timeZone: "UTC",
    ownerEmail: "smoke@example.test",
    memberEmails: ["invitee@example.test", "colleague@example.test"],
  });
  const org = await owner.client.mutation("provisionOrganization", initial.input);
  const otherPlan = await owner.client.mutation("reviewOrganization", {
    name: "Independent Community",
    slug: "independent-community",
    timeZone: "UTC",
    ownerEmail: "invitee@example.test",
    memberEmails: [],
  });
  const other = await owner.client.mutation("provisionOrganization", otherPlan.input);
  const child = await owner.client.mutation("create", {
    organizationId: org.organizationId,
    name: "Working team",
    slug: "working-team",
    timeZone: "UTC",
    requestId: randomUUID(),
  });
  for (const userId of [7002, 7003])
    await owner.client.mutation("setMember", {
      organizationId: org.organizationId,
      teamId: child.teamId,
      userId,
      role: "MEMBER",
      requestId: randomUUID(),
    });
  const subjects = (await pool.query("SELECT id,uuid FROM users WHERE id IN (7001,7002,7003)")).rows;
  const subject = (id) => subjects.find((row) => row.id === id);
  // Fixture-only personal records demonstrate preservation; they are not
  // claims of an external provider connection or a complete credential UI.
  await pool.query(
    'INSERT INTO "Credential" (id,type,key,"userId") VALUES (900,\'synthetic-calendar\',$1,7002)',
    [JSON.stringify({ ciphertext: "synthetic-not-live" })]
  );
  await pool.query(
    "INSERT INTO \"EventType\" (id,title,slug,length,\"userId\") VALUES (900,'Personal appointment','personal',30,7002)"
  );
  await pool.query(
    'INSERT INTO "Booking" (uid,title,"userId","eventTypeId","startTime","endTime") VALUES (\'personal-preserved\',\'Personal appointment\',7002,900,\'2030-01-01\',\'2030-01-02\')'
  );
  for (const [id, teamId] of [
    ["scoped-removal-key", child.teamId],
    ["personal-preserved-key", null],
  ])
    await pool.query('INSERT INTO "ApiKey" (id,"userId","teamId","hashedKey") VALUES ($1,7002,$2,$3)', [
      id,
      teamId,
      createHash("sha256").update(randomBytes(32)).digest("hex"),
    ]);
  await pool.query(
    "INSERT INTO \"EventType\" (id,title,slug,length,\"teamId\") VALUES (901,'Assigned host','handoff',30,$1)",
    [child.teamId]
  );
  await pool.query('INSERT INTO "Host" ("userId","eventTypeId") VALUES (7003,901)');
  await pool.query(
    `INSERT INTO "Webhook" (id,"teamId","subscriberUrl","eventTriggers") VALUES ('member-lifecycle-shared-hook',$1,'https://fixture.invalid/webhook',ARRAY['BOOKING_CREATED']::"WebhookTriggerEvents"[])`,
    [child.teamId]
  );
  const webhookClient = (session) =>
    createTRPCUntypedClient({
      transformer: superjson,
      links: [
        httpBatchLink({
          url: origin + "/api/trpc/webhook",
          headers: () => ({
            Origin: origin,
            Cookie: Array.from(session.jar, ([name, value]) => `${name}=${value}`).join("; "),
          }),
        }),
      ],
    });
  assert.equal(
    (await webhookClient(owner).query("get", { id: "member-lifecycle-shared-hook" })).id,
    "member-lifecycle-shared-hook"
  );
  await assert.rejects(
    webhookClient(member).query("get", { id: "member-lifecycle-shared-hook" }),
    (error) => error.data?.code === "FORBIDDEN"
  );
  const before = (
    await pool.query('SELECT id,uuid,role,email,"organizationId","movedToProfileId" FROM users WHERE id=7002')
  ).rows[0];
  const browser = await chromium.launch({ headless: true });
  const output = path.resolve(__dirname, "../../test-results/community-enterprise");
  fs.mkdirSync(output, { recursive: true });
  const pageFor = async (session) => {
    const context = await browser.newContext({ timezoneId: "UTC", locale: "en-US" });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
    );
    await context.addCookies(Array.from(session.jar, ([name, value]) => ({ name, value, url: origin })));
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    await page.goto(origin + "/settings/enterprise/teams", { waitUntil: "domcontentloaded" });
    return page;
  };
  try {
    const page = await pageFor(owner),
      memberPage = await pageFor(member),
      successorPage = await pageFor(successor);
    const row = page.getByTestId("organization-member-7002");
    await expect(row).toBeVisible();
    await row.getByTestId("review-role").click();
    await expect(page.getByTestId("member-change-review")).toBeVisible();
    assert.equal(
      (
        await pool.query('SELECT role FROM "Membership" WHERE "teamId"=$1 AND "userId"=7002', [
          org.organizationId,
        ])
      ).rows[0].role,
      "MEMBER"
    );
    await page.getByTestId("confirm-member-change").click();
    await expect
      .poll(
        async () =>
          (
            await pool.query('SELECT role FROM "Membership" WHERE "teamId"=$1 AND "userId"=7002', [
              org.organizationId,
            ])
          ).rows[0].role
      )
      .toBe("ADMIN");
    assert.equal(
      (await member.client.query("organizationMembers", { organizationId: org.organizationId })).actorRole,
      "ADMIN"
    );
    await assert.rejects(
      member.client.mutation("reviewMemberChange", {
        organizationId: org.organizationId,
        target: subject(7001),
        operation: "set-role",
        role: "MEMBER",
      }),
      (error) => error.data?.code === "FORBIDDEN"
    );
    await page.getByTestId("organization-member-7003").getByTestId("review-removal").click();
    await expect(page.getByTestId("member-change-blockers")).toBeVisible();
    await expect(page.getByTestId("confirm-member-change")).toBeDisabled();
    await expect(page.getByTestId("member-change-blockers")).toContainText("reassigned");
    await page.screenshot({ path: path.join(output, "member-handoff-blocked.png"), fullPage: true });
    await page
      .getByTestId("member-change-review")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await row.getByTestId("review-removal").click();
    await expect(page.getByTestId("member-change-review")).toBeVisible();
    const changed = await owner.client.mutation("reviewMemberChange", {
      organizationId: org.organizationId,
      target: subject(7002),
      operation: "set-role",
      role: "MEMBER",
    });
    await owner.client.mutation("commitMemberChange", changed.input);
    await page.getByTestId("confirm-member-change").click();
    await expect(page.getByRole("alert").filter({ hasText: "changed" })).toBeVisible();
    assert.equal(
      (
        await pool.query('SELECT count(*)::int AS n FROM "Membership" WHERE "teamId"=$1 AND "userId"=7002', [
          org.organizationId,
        ])
      ).rows[0].n,
      1
    );
    await page
      .getByTestId("member-change-review")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await row.getByTestId("review-removal").click();
    await expect(page.getByTestId("confirm-member-change")).toBeEnabled();
    await page.screenshot({ path: path.join(output, "member-removal-review.png"), fullPage: true });
    await page.getByTestId("confirm-member-change").click();
    await expect(row).toHaveCount(0);
    await assert.rejects(
      member.client.query("organizationMembers", { organizationId: org.organizationId }),
      (error) => error.data?.code === "FORBIDDEN"
    );
    await assert.rejects(
      webhookClient(member).query("get", { id: "member-lifecycle-shared-hook" }),
      (error) => error.data?.code === "FORBIDDEN"
    );
    const remaining = await member.client.query("overview");
    assert.deepEqual(
      remaining.map((entry) => entry.organization.id),
      [other.organizationId]
    );
    await memberPage.reload({ waitUntil: "domcontentloaded" });
    await expect(memberPage.getByTestId("organization-members")).toBeVisible();
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM "Membership" WHERE "userId"=7002 AND "teamId" IN ($1,$2)',
          [org.organizationId, child.teamId]
        )
      ).rows[0].n,
      0
    );
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM "Profile" WHERE "userId"=7002 AND "organizationId"=$1',
          [org.organizationId]
        )
      ).rows[0].n,
      0
    );
    assert.deepEqual(
      (
        await pool.query(
          'SELECT id,uuid,role,email,"organizationId","movedToProfileId" FROM users WHERE id=7002'
        )
      ).rows[0],
      before
    );
    assert.equal(
      (await pool.query('SELECT count(*)::int AS n FROM "Credential" WHERE id=900 AND "userId"=7002')).rows[0]
        .n,
      1
    );
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM \"Booking\" WHERE uid='personal-preserved'")).rows[0]
        .n,
      1
    );
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM \"ApiKey\" WHERE id='scoped-removal-key'")).rows[0].n,
      0
    );
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM \"ApiKey\" WHERE id='personal-preserved-key'"))
        .rows[0].n,
      1
    );
    await page.getByTestId("organization-member-7003").getByTestId("review-transfer").click();
    await expect(page.getByTestId("member-change-review")).toContainText(
      "You become an organization administrator"
    );
    await page.getByTestId("confirm-member-change").click();
    await expect
      .poll(
        async () =>
          (
            await pool.query('SELECT role FROM "Membership" WHERE "teamId"=$1 AND "userId"=7003', [
              org.organizationId,
            ])
          ).rows[0].role
      )
      .toBe("OWNER");
    await assert.rejects(
      owner.client.mutation("reviewMemberChange", {
        organizationId: org.organizationId,
        target: subject(7001),
        operation: "set-role",
        role: "MEMBER",
      }),
      (error) => error.data?.code === "FORBIDDEN"
    );
    await successorPage.reload({ waitUntil: "domcontentloaded" });
    await successorPage.getByTestId("organization-member-7003").getByTestId("review-removal").click();
    await expect(successorPage.getByTestId("member-change-blockers")).toContainText("retain an active owner");
    await expect(successorPage.getByTestId("confirm-member-change")).toBeDisabled();
    await successorPage.screenshot({
      path: path.join(output, "member-ownership-protected.png"),
      fullPage: true,
    });
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM \"EnterpriseAuditEvent\" WHERE action LIKE 'organization.member.%'"
        )
      ).rows[0].n,
      4
    );
    assert.equal(fixture.smtp.count(), 0);
    t.diagnostic(
      JSON.stringify({
        nativeIdentities: fixture.oidc.exchanges(),
        roleChange: true,
        staleReviewDenied: true,
        offboardingCommitted: true,
        unchangedSessionLostOrgAccess: true,
        otherOrganizationAndPersonalDataPreserved: true,
        scopedKeyRevoked: true,
        ownershipTransfer: true,
        lastOwnerProtected: true,
        schedulingHandoffRequired: true,
        externalSends: 0,
        scope:
          "actual local web, native sessions and primary database; fixture IdP, no provider or deployed offboarding acceptance",
      })
    );
  } finally {
    await browser.close();
  }
}
module.exports = { seedMemberLifecycleFixture, runMemberLifecycleJourney };
