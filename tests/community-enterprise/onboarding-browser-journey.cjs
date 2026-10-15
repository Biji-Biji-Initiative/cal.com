// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const { chromium, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const origin = "http://127.0.0.1:38917";
const { sessionFor } = require("./invitation-browser-journey.cjs");

async function seedOnboardingBrowserFixture(pool) {
  await pool.query(
    'UPDATE users SET "completedOnboarding"=false,"emailVerified"=NOW(),"timeZone"=$1 WHERE id=7001',
    ["UTC"]
  );
  await pool.query(
    "INSERT INTO \"Feature\" (slug,enabled,type,description,\"createdAt\",\"updatedAt\") VALUES ('onboarding-v3',true,'OPERATIONAL','Synthetic stale flag',NOW(),NOW()) ON CONFLICT (slug) DO UPDATE SET enabled=true"
  );
  if (process.env.CAL_ONBOARDING_ACCEPTED_MEMBER === "true") {
    await pool.query(
      `INSERT INTO users (id,uuid,email,name,username,role,"completedOnboarding","emailVerified","timeZone") VALUES (7002,$1,'onboarding-operator@example.test','Synthetic Admission Operator','onboarding-operator','ADMIN',true,NOW(),'UTC')`,
      [require("node:crypto").randomUUID()]
    );
    return {
      acceptedOrganizationMember: true,
      identities: [
        { userId: 7001, email: "smoke@example.test", subject: "synthetic-staff-subject" },
        { userId: 7002, email: "onboarding-operator@example.test", subject: "synthetic-onboarding-operator" },
      ],
    };
  }
  return {};
}

async function runOnboardingBrowserJourney({ pool, fixture, t }) {
  let admittedOrganizationId = null;
  if (fixture.acceptedOrganizationMember) {
    const operator = await sessionFor(fixture, 7002);
    const review = await operator.client.mutation("reviewOrganization", {
      name: "Existing Staff Organization",
      slug: "existing-staff",
      timeZone: "UTC",
      ownerEmail: "onboarding-operator@example.test",
      memberEmails: ["smoke@example.test"],
    });
    const admitted = await operator.client.mutation("provisionOrganization", review.input);
    admittedOrganizationId = admitted.organizationId;
    assert.deepEqual(
      (
        await pool.query('SELECT role,accepted FROM "Membership" WHERE "userId"=7001 AND "teamId"=$1', [
          admittedOrganizationId,
        ])
      ).rows,
      [{ role: "MEMBER", accepted: true }]
    );
  }
  const jar = new Map();
  const request = async (route, options = {}) => {
    const response = await fetch(`${origin}${route}`, {
      ...options,
      redirect: "manual",
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
      callbackUrl: `${origin}/getting-started`,
      json: "true",
    }).toString(),
  });
  assert.ok(login.status < 400);
  const authorization = login.headers.get("location") ?? (await login.json()).url;
  const callback = new URL(await fixture.oidc.authorize(authorization));
  assert.equal(callback.origin, origin);
  assert.ok((await request(callback.pathname + callback.search)).status < 400);
  assert.equal(fixture.oidc.exchanges(), fixture.acceptedOrganizationMember ? 2 : 1);
  assert.equal((await (await request("/api/auth/session")).json()).user?.id, 7001);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ timezoneId: "UTC", locale: "en-US" });
    const checkoutAttempts = [];
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      if (/checkout|billing|stripe/i.test(url.hostname + url.pathname))
        checkoutAttempts.push(url.origin + url.pathname);
      return route.abort();
    });
    await context.addCookies(Array.from(jar, ([name, value]) => ({ name, value, url: origin })));
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    await page.goto(`${origin}/auth/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      const persisted = JSON.stringify({
        version: 1,
        state: {
          selectedPlan: "organization",
          organizationDetails: { name: "Old purchase draft", link: "old-purchase" },
          teamDetails: { name: "Old team draft", slug: "old-team" },
        },
      });
      localStorage.setItem("cal-onboarding-storage", persisted);
      localStorage.setItem("onBoardingRedirect", "/onboarding/organization/billing");
      await new Promise((resolve, reject) => {
        const open = indexedDB.open("cal-onboarding-idb", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("keyval");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction("keyval", "readwrite");
          transaction.objectStore("keyval").put(persisted, "cal-onboarding-storage");
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => {
            database.close();
            reject(transaction.error);
          };
        };
      });
    });
    const entered = await page.goto(`${origin}/onboarding/getting-started?plan=organization&bp=a`, {
      waitUntil: "domcontentloaded",
    });
    assert.equal(entered.status(), 200, "The real first-run page must render successfully");
    await expect(page).toHaveURL(/\/getting-started(?:\?|$)/);
    await expect(page.getByText("Set up your calendar", { exact: true })).toBeVisible();
    await expect(page.getByText("Select plan", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("onboarding-continue-btn")).toHaveCount(0);
    assert.ok(!(await page.locator("body").innerText()).match(/\$(15|37)\/user/));
    const output = path.resolve(__dirname, "../../test-results/community-enterprise");
    fs.mkdirSync(output, { recursive: true });
    await expect(page.locator('input[name="name"]')).toBeVisible();
    const timezone = page.getByRole("combobox", { name: "Timezone Select" });
    await expect(timezone).toBeEnabled({ timeout: 60000 });
    await timezone.fill("Kuala Lumpur");
    // The retained custom React Select option renders its city label as text;
    // older versions do not expose an option role. Assert the actual rendered
    // row and verify the canonical timezone from the database after saving.
    const timezoneRow = page.getByText(/^Kuala Lumpur GMT \+8:00$/, { exact: true });
    await expect(timezoneRow).toBeVisible();
    await timezoneRow.click();
    await page.screenshot({ path: path.join(output, "onboarding-start.png"), fullPage: true });
    await page.locator('input[name="name"]').fill("Synthetic Onboarded Staff");
    await page.getByTestId("connect-calendar-button").click();
    await expect(page).toHaveURL(/\/getting-started\/connected-calendar/);
    await page.getByTestId("skip-step").click();
    await expect(page).toHaveURL(/\/getting-started\/connected-video/);
    await page.getByTestId("skip-step").click();
    await expect(page).toHaveURL(/\/getting-started\/setup-availability/);
    await page.getByTestId("save-availability").click();
    await expect(page).toHaveURL(/\/getting-started\/user-profile/);
    const before = (await pool.query('SELECT "completedOnboarding" FROM users WHERE id=7001')).rows[0];
    assert.equal(before.completedOnboarding, false);
    await page.getByTestId("finish-onboarding").click();
    await expect(page).toHaveURL(/\/event-types(?:\?|$)/);
    const user = (
      await pool.query(
        'SELECT name,"timeZone","completedOnboarding",role,"defaultScheduleId" FROM users WHERE id=7001'
      )
    ).rows[0];
    assert.equal(user.name, "Synthetic Onboarded Staff");
    assert.equal(user.timeZone, "Asia/Kuala_Lumpur");
    assert.equal(user.completedOnboarding, true);
    assert.equal(user.role, "USER");
    assert.ok(user.defaultScheduleId);
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM "Availability" a JOIN "Schedule" s ON a."scheduleId"=s.id WHERE s.id=$1 AND s."userId"=7001',
          [user.defaultScheduleId]
        )
      ).rows[0].count > 0,
      true
    );
    assert.deepEqual(
      (await pool.query('SELECT slug FROM "EventType" WHERE "userId"=7001 ORDER BY slug')).rows.map(
        (row) => row.slug
      ),
      ["15min", "30min", "secret"]
    );
    assert.equal(
      (await pool.query('SELECT count(*)::int AS count FROM "Membership" WHERE "userId"=7001')).rows[0].count,
      fixture.acceptedOrganizationMember ? 1 : 0
    );
    if (fixture.acceptedOrganizationMember) {
      assert.deepEqual(
        (
          await pool.query('SELECT role,accepted FROM "Membership" WHERE "userId"=7001 AND "teamId"=$1', [
            admittedOrganizationId,
          ])
        ).rows,
        [{ role: "MEMBER", accepted: true }]
      );
      assert.equal(
        (
          await pool.query(
            'SELECT count(*)::int AS count FROM "Profile" WHERE "userId"=7001 AND "organizationId"=$1',
            [admittedOrganizationId]
          )
        ).rows[0].count,
        1
      );
      assert.equal(
        (
          await pool.query(
            'SELECT count(*)::int AS count FROM "EventType" WHERE "userId"=7001 AND "teamId" IS NOT NULL'
          )
        ).rows[0].count,
        0
      );
    }
    assert.deepEqual(checkoutAttempts, []);
    for (const alias of ["/onboarding/teams/details", "/onboarding/organization/details?bp=a"]) {
      await page.goto(origin + alias, { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/settings\/enterprise\/teams/);
      await expect(page.getByText("Select plan", { exact: true })).toHaveCount(0);
    }
    const guest = await browser.newContext();
    const guestPage = await guest.newPage();
    await guestPage.goto(`${origin}/onboarding/getting-started`, { waitUntil: "domcontentloaded" });
    await expect(guestPage).toHaveURL(/\/auth\/login/);
    await guest.close();
    t.diagnostic(
      JSON.stringify({
        nativeOidcExchanges: fixture.oidc.exchanges(),
        acceptedOrganizationMember: !!fixture.acceptedOrganizationMember,
        admissionUsesActualService: !!fixture.acceptedOrganizationMember,
        setupSteps: 5,
        hostedCheckoutRequests: 0,
        membershipChanges: 0,
        defaultEvents: 3,
        scope:
          "built local web and real PostgreSQL; TLS test IdP; calendars/conferencing explicitly skipped, not provider-verified",
      })
    );
  } finally {
    await browser.close();
  }
}
module.exports = { seedOnboardingBrowserFixture, runOnboardingBrowserJourney };
