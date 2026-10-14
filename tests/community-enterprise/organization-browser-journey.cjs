// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { chromium, expect } = require("@playwright/test");
const { createTRPCUntypedClient, httpBatchLink } = require("@trpc/client");
const superjson = require("superjson").default;
const origin = "http://127.0.0.1:38917";

async function seedOrganizationBrowserFixture(pool) {
  await pool.query(
    'UPDATE users SET role=\'ADMIN\',"completedOnboarding"=true,"emailVerified"=NOW() WHERE id=7001'
  );
  await pool.query(
    'INSERT INTO users (id,uuid,email,name,username,"completedOnboarding","emailVerified") VALUES (7002,$1,$2,$3,$4,true,NOW())',
    [randomUUID(), "member@example.test", "Synthetic New Member", "new-member"]
  );
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM "Team"')).rows[0].count, 0);
  return {};
}

async function runOrganizationBrowserJourney({ pool, fixture, t }) {
  const jar = new Map();
  const request = async (route, options = {}) => {
    const response = await fetch(origin + route, {
      ...options,
      redirect: "manual",
      headers: {
        Cookie: Array.from(jar, ([key, value]) => `${key}=${value}`).join("; "),
        ...options.headers,
      },
      signal: AbortSignal.timeout(45000),
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
      callbackUrl: origin + "/settings/enterprise/teams",
      json: "true",
    }).toString(),
  });
  assert.ok(login.status < 400);
  const url = login.headers.get("location") ?? (await login.json()).url;
  const callback = new URL(await fixture.oidc.authorize(url));
  assert.equal(callback.origin, origin);
  assert.ok((await request(callback.pathname + callback.search)).status < 400);
  assert.equal((await (await request("/api/auth/session")).json()).user?.id, 7001);
  const client = createTRPCUntypedClient({
    transformer: superjson,
    links: [
      httpBatchLink({
        url: origin + "/api/trpc/enterpriseTeams",
        headers: () => ({
          Origin: origin,
          Cookie: Array.from(jar, ([key, value]) => `${key}=${value}`).join("; "),
        }),
      }),
    ],
  });
  assert.deepEqual(await client.query("provisioningCapabilities"), { canProvision: true });
  const readOnlyReview = {
    name: "Denied",
    slug: "denied",
    timeZone: "UTC",
    ownerEmail: "smoke@example.test",
    memberEmails: [],
  };
  const anonymous = createTRPCUntypedClient({
    transformer: superjson,
    links: [
      httpBatchLink({
        url: origin + "/api/trpc/enterpriseTeams",
        headers: () => ({ Origin: origin }),
      }),
    ],
  });
  await assert.rejects(
    anonymous.mutation("reviewOrganization", readOnlyReview),
    (error) => error.data?.code === "UNAUTHORIZED"
  );
  const wrongOrigin = createTRPCUntypedClient({
    transformer: superjson,
    links: [
      httpBatchLink({
        url: origin + "/api/trpc/enterpriseTeams",
        headers: () => ({
          Origin: "https://untrusted.example.test",
          Cookie: Array.from(jar, ([key, value]) => `${key}=${value}`).join("; "),
        }),
      }),
    ],
  });
  await assert.rejects(
    wrongOrigin.mutation("reviewOrganization", readOnlyReview),
    (error) => error.data?.code === "FORBIDDEN"
  );

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ timezoneId: "UTC", locale: "en-US" });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
    );
    await context.addCookies(Array.from(jar, ([name, value]) => ({ name, value, url: origin })));
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    const response = await page.goto(origin + "/settings/enterprise/teams", {
      waitUntil: "domcontentloaded",
    });
    assert.equal(response.status(), 200);
    await expect(page.getByTestId("organization-provisioning")).toBeVisible();
    const form = page.getByTestId("review-organization");
    await form.locator('input[name="name"]').fill("Synthetic Community Workspace");
    await form.locator('input[name="slug"]').fill("synthetic-community");
    await form.locator('input[name="timeZone"]').fill("Asia/Kuala_Lumpur");
    await form.locator('input[name="ownerEmail"]').fill("smoke@example.test");
    await form.locator('textarea[name="memberEmails"]').fill("member@example.test");
    await form.locator('button[type="submit"]').click();
    await expect(page.getByTestId("organization-review")).toBeVisible();
    assert.equal(
      (await pool.query('SELECT count(*)::int AS count FROM "Team"')).rows[0].count,
      0,
      "Review is not a mutation"
    );
    await form.locator('input[name="name"]').fill("Synthetic Reviewed Community");
    await expect(page.getByTestId("organization-review")).toHaveCount(0);
    await form.locator('button[type="submit"]').click();
    await expect(page.getByTestId("organization-review")).toBeVisible();
    await expect(page.getByTestId("organization-review").getByText(/member@example.test/)).toBeVisible();
    const output = path.resolve(__dirname, "../../test-results/community-enterprise");
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, "organization-review.png"), fullPage: true });
    await page.getByTestId("confirm-organization").click();
    await expect(page.getByTestId("organization-created")).toBeVisible();
    const organizations = (await pool.query('SELECT id,name,slug,"isOrganization","parentId" FROM "Team"'))
      .rows;
    assert.equal(organizations.length, 1);
    const org = organizations[0];
    assert.equal(org.name, "Synthetic Reviewed Community");
    assert.equal(org.isOrganization, true);
    assert.equal(org.parentId, null);
    const members = (
      await pool.query(
        'SELECT "userId",role,accepted FROM "Membership" WHERE "teamId"=$1 ORDER BY "userId"',
        [org.id]
      )
    ).rows;
    assert.deepEqual(members, [
      { userId: 7001, role: "OWNER", accepted: true },
      { userId: 7002, role: "MEMBER", accepted: true },
    ]);
    assert.equal(
      (await pool.query('SELECT count(*)::int AS count FROM "Profile" WHERE "organizationId"=$1', [org.id]))
        .rows[0].count,
      2
    );
    const settings = (
      await pool.query(
        'SELECT "orgAutoAcceptEmail","orgAutoJoinOnSignup","isOrganizationVerified","isAdminReviewed" FROM "OrganizationSettings" WHERE "organizationId"=$1',
        [org.id]
      )
    ).rows[0];
    assert.deepEqual(settings, {
      orgAutoAcceptEmail: "",
      orgAutoJoinOnSignup: false,
      isOrganizationVerified: false,
      isAdminReviewed: false,
    });
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM \"EnterpriseAuditEvent\" WHERE action='organization.provisioned'"
        )
      ).rows[0].count,
      1
    );
    const createTeam = page.getByTestId("create-team");
    await expect(createTeam).toBeVisible();
    await createTeam.locator('input[name="name"]').fill("Mentoring team");
    await createTeam.locator('input[name="slug"]').fill("mentors");
    await createTeam.locator('input[name="timeZone"]').fill("Asia/Kuala_Lumpur");
    await createTeam.locator('button[type="submit"]').click();
    await expect(page.getByRole("heading", { name: "Mentoring team", exact: true })).toBeVisible();
    const team = (await pool.query('SELECT id FROM "Team" WHERE "parentId"=$1', [org.id])).rows[0];
    const membership = page.getByTestId(`team-member-form-${team.id}`);
    await membership.locator('select[name="userId"]').selectOption("7002");
    await membership.getByRole("button", { name: "Save membership" }).click();
    await expect
      .poll(
        async () =>
          (
            await pool.query(
              'SELECT count(*)::int AS count FROM "Membership" WHERE "teamId"=$1 AND "userId"=7002 AND accepted',
              [team.id]
            )
          ).rows[0].count
      )
      .toBe(1);
    const originalUser = (
      await pool.query('SELECT role,"organizationId","movedToProfileId" FROM users WHERE id=7002')
    ).rows[0];
    assert.deepEqual(originalUser, { role: "USER", organizationId: null, movedToProfileId: null });
    await page.screenshot({ path: path.join(output, "organization-created.png"), fullPage: true });
    // Same authenticated cookie, committed local role downgrade. Organization
    // ownership does not substitute for instance-wide provisioning authority.
    await pool.query("UPDATE users SET role='USER' WHERE id=7001");
    await assert.rejects(
      client.mutation("reviewOrganization", {
        name: "Forbidden",
        slug: "forbidden",
        timeZone: "UTC",
        ownerEmail: "smoke@example.test",
        memberEmails: [],
      }),
      (error) => error.data?.code === "FORBIDDEN"
    );
    assert.deepEqual(await client.query("provisioningCapabilities"), { canProvision: false });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("organization-provisioning")).toHaveCount(0);
    await expect(page.getByTestId("create-team")).toBeVisible();
    assert.equal(
      (await pool.query('SELECT count(*)::int AS count FROM "Team" WHERE "isOrganization"')).rows[0].count,
      1
    );
    assert.equal(fixture.smtp.count(), 0, "Explicit admission is not an external invitation send");
    t.diagnostic(
      JSON.stringify({
        nativeOidcExchanges: fixture.oidc.exchanges(),
        createdOrganizations: 1,
        initialMemberships: 2,
        childTeams: 1,
        childMembershipAdded: true,
        unchangedSessionDemotionDenied: true,
        externalMessages: 0,
        scope:
          "actual local UI/domain/primary DB and TLS test issuer; existing human accounts; no live IdP, calendar provider or agent grant",
      })
    );
  } finally {
    await browser.close();
  }
}
module.exports = { seedOrganizationBrowserFixture, runOrganizationBrowserJourney };
