// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { chromium, expect } = require("@playwright/test");
const { createTRPCUntypedClient, httpBatchLink } = require("@trpc/client");
const superjson = require("superjson").default;
const origin = "http://127.0.0.1:38917";

async function seedInvitationBrowserFixture(pool) {
  await pool.query(
    'UPDATE users SET role=\'ADMIN\',"completedOnboarding"=true,"emailVerified"=NOW(),"timeZone"=\'UTC\' WHERE id=7001'
  );
  for (const [id, email] of [
    [7002, "invitee@example.test"],
    [7003, "colleague@example.test"],
  ]) {
    await pool.query(
      'INSERT INTO users (id,uuid,email,name,username,"completedOnboarding","emailVerified","timeZone") VALUES ($1,$2,$3,$4,$5,true,NOW(),\'UTC\')',
      [id, randomUUID(), email, `Synthetic Person ${id}`, `invitee-${id}`]
    );
  }
  return {
    identities: [
      { userId: 7001, email: "smoke@example.test", subject: "synthetic-staff-subject" },
      { userId: 7002, email: "invitee@example.test", subject: "synthetic-recipient-subject" },
      { userId: 7003, email: "colleague@example.test", subject: "synthetic-third-subject" },
    ],
  };
}
async function sessionFor(fixture, userId) {
  const jar = new Map();
  const request = async (route, options = {}) => {
    const response = await fetch(origin + route, {
      ...options,
      redirect: "manual",
      headers: {
        Cookie: Array.from(jar, ([name, value]) => `${name}=${value}`).join("; "),
        ...options.headers,
      },
      signal: AbortSignal.timeout(30000),
    });
    for (const line of response.headers.getSetCookie()) {
      const part = line.split(";", 1)[0];
      const at = part.indexOf("=");
      if (at !== -1) jar.set(part.slice(0, at), part.slice(at + 1));
    }
    return response;
  };
  const csrf = await (await request("/api/auth/csrf")).json();
  const start = await request("/api/auth/signin/authentik", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      csrfToken: csrf.csrfToken,
      callbackUrl: origin + "/settings/enterprise/teams",
      json: "true",
    }).toString(),
  });
  const url = start.headers.get("location") ?? (await start.json()).url;
  const callback = new URL(await fixture.oidc.authorize(url, userId));
  assert.equal(callback.origin, origin);
  assert.ok((await request(callback.pathname + callback.search)).status < 400);
  assert.equal((await (await request("/api/auth/session")).json()).user?.id, userId);
  return {
    jar,
    client: createTRPCUntypedClient({
      transformer: superjson,
      links: [
        httpBatchLink({
          url: origin + "/api/trpc/enterpriseTeams",
          headers: () => ({
            Origin: origin,
            Cookie: Array.from(jar, ([name, value]) => `${name}=${value}`).join("; "),
          }),
        }),
      ],
    }),
  };
}

async function runInvitationBrowserJourney({ pool, fixture, t }) {
  const owner = await sessionFor(fixture, 7001);
  const member = await sessionFor(fixture, 7002);
  const colleague = await sessionFor(fixture, 7003);
  const review = await owner.client.mutation("reviewOrganization", {
    name: "Synthetic Invitation Workspace",
    slug: "invitation-workspace",
    timeZone: "UTC",
    ownerEmail: "smoke@example.test",
    memberEmails: [],
  });
  const org = await owner.client.mutation("provisionOrganization", review.input);
  await pool.query('UPDATE users SET "emailVerified"=NULL WHERE id=7002');
  await assert.rejects(
    owner.client.mutation("inviteMember", {
      organizationId: org.organizationId,
      email: "invitee@example.test",
      requestId: randomUUID(),
    }),
    (error) => error.data?.code === "BAD_REQUEST"
  );
  assert.equal(
    (await pool.query('SELECT count(*)::int AS count FROM "Membership" WHERE "userId"=7002')).rows[0].count,
    0
  );
  assert.equal(fixture.smtp.count(), 0);
  await pool.query('UPDATE users SET "emailVerified"=NOW() WHERE id=7002');
  const memberBefore = (
    await pool.query('SELECT role,"organizationId","movedToProfileId" FROM users WHERE id=7002')
  ).rows[0];
  const browser = await chromium.launch({ headless: true });
  const output = path.resolve(__dirname, "../../test-results/community-enterprise");
  fs.mkdirSync(output, { recursive: true });
  try {
    const pageFor = async (session) => {
      const context = await browser.newContext({ timezoneId: "UTC", locale: "en-US" });
      await context.route("**/*", (route) =>
        new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
      );
      await context.addCookies(Array.from(session.jar, ([name, value]) => ({ name, value, url: origin })));
      const page = await context.newPage();
      page.setDefaultTimeout(45000);
      const response = await page.goto(origin + "/settings/enterprise/teams", {
        waitUntil: "domcontentloaded",
      });
      assert.equal(response.status(), 200);
      return page;
    };
    const inboxTimings = [];
    const responseData = async (response) => {
      assert.equal(response.status(), 200, "The actual invitation operation must succeed");
      const body = await response.json();
      return (Array.isArray(body) ? body : [body])
        .filter((item) => item.result?.data)
        .map((item) => superjson.deserialize(item.result.data));
    };
    const isOperation = (response, operation, method) => {
      const url = new URL(response.url());
      return (
        url.origin === origin &&
        url.pathname.startsWith("/api/trpc/enterpriseTeams/") &&
        response.request().method() === method &&
        url.pathname.split("/").at(-1).split(",").includes(operation)
      );
    };
    const reloadInbox = async (page, invitationId) => {
      const started = performance.now();
      const completed = page.waitForResponse((response) => isOperation(response, "invitations", "GET"));
      await page.reload({ waitUntil: "domcontentloaded" });
      const data = await responseData(await completed);
      assert.ok(
        data.some(
          (result) => Array.isArray(result.items) && result.items.some((item) => item.id === invitationId)
        ),
        "The real inbox response must contain the exact committed invitation"
      );
      inboxTimings.push(Math.round(performance.now() - started));
      // Keep the original five-second render assertion after the data response.
      await expect(page.getByTestId(`invitation-${invitationId}`)).toBeVisible();
    };
    const ownerPage = await pageFor(owner);
    const memberPage = await pageFor(member);
    const colleaguePage = await pageFor(colleague);
    const form = ownerPage.getByTestId("invite-organization-member");
    const invite = async (email) => {
      await form.locator('input[name="email"]').fill(email);
      const completed = ownerPage.waitForResponse((response) =>
        isOperation(response, "inviteMember", "POST")
      );
      await form.getByRole("button", { name: "Send invitation", exact: true }).click();
      const data = await responseData(await completed);
      const committed = data.find((result) => Number.isInteger(result.invitationId));
      assert.ok(committed, "The invitation identifier must come from the actual completed UI mutation");
      const pending = ownerPage.getByTestId("organization-invitations");
      await expect(pending.getByText(email, { exact: true })).toBeVisible({ timeout: 30000 });
      const rows = await owner.client.query("invitations", { organizationId: org.organizationId });
      const item = rows.items.find(
        (row) => row.id === committed.invitationId && row.recipient.email === email
      );
      assert.ok(item, "Read back the exact UI mutation, not an older row with the same email");
      return item;
    };
    const first = await invite("invitee@example.test");
    await expect(
      ownerPage.getByRole("status").filter({ hasText: "submitted to the mail server" })
    ).toBeVisible();
    await fixture.smtp.expectRecipientsSince(0, ["invitee@example.test"]);
    assert.equal(
      (
        await pool.query('SELECT accepted FROM "Membership" WHERE "userId"=7002 AND "teamId"=$1', [
          org.organizationId,
        ])
      ).rows[0].accepted,
      false
    );
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM "Profile" WHERE "userId"=7002 AND "organizationId"=$1',
          [org.organizationId]
        )
      ).rows[0].count,
      0
    );
    assert.deepEqual(await member.client.query("overview"), []);
    await assert.rejects(
      owner.client.mutation("respondToInvitation", {
        invitationId: first.id,
        decision: "accept",
        requestId: randomUUID(),
      }),
      (error) => error.data?.code === "FORBIDDEN"
    );
    await memberPage.reload({ waitUntil: "domcontentloaded" });
    await pool.query('UPDATE users SET "emailVerified"=NULL WHERE id=7002');
    await assert.rejects(
      member.client.mutation("respondToInvitation", {
        invitationId: first.id,
        decision: "accept",
        requestId: randomUUID(),
      }),
      (error) => error.data?.code === "BAD_REQUEST"
    );
    assert.equal(
      (
        await pool.query('SELECT accepted FROM "Membership" WHERE "userId"=7002 AND "teamId"=$1', [
          org.organizationId,
        ])
      ).rows[0].accepted,
      false
    );
    await pool.query('UPDATE users SET "emailVerified"=NOW() WHERE id=7002');
    await reloadInbox(memberPage, first.id);
    const invitation = memberPage.getByTestId(`invitation-${first.id}`);
    await expect(invitation).toBeVisible();
    await expect(invitation.getByText("Synthetic Invitation Workspace", { exact: true })).toBeVisible();
    await expect(invitation.locator("time")).toHaveAttribute(
      "datetime",
      new Date(first.expires).toISOString()
    );
    assert.ok(
      !(await invitation.locator("time").innerText()).includes("&#"),
      "Expiry must be readable text, not double-escaped HTML entities"
    );
    await memberPage.screenshot({ path: path.join(output, "invitation-consent.png"), fullPage: true });
    await invitation.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await expect(invitation).toHaveCount(0);
    await expect.poll(async () => (await member.client.query("overview")).length).toBe(1);
    assert.equal((await member.client.query("overview"))[0].canManage, false);
    const after = (
      await pool.query('SELECT role,"organizationId","movedToProfileId" FROM users WHERE id=7002')
    ).rows[0];
    assert.deepEqual(after, memberBefore);
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM "Profile" WHERE "userId"=7002 AND "organizationId"=$1',
          [org.organizationId]
        )
      ).rows[0].count,
      1
    );
    await assert.rejects(
      member.client.mutation("inviteMember", {
        organizationId: org.organizationId,
        email: "colleague@example.test",
        requestId: randomUUID(),
      }),
      (error) => error.data?.code === "FORBIDDEN"
    );
    await ownerPage.reload({ waitUntil: "domcontentloaded" });
    const declined = await invite("colleague@example.test");
    await reloadInbox(colleaguePage, declined.id);
    await colleaguePage
      .getByTestId(`invitation-${declined.id}`)
      .getByRole("button", { name: "Decline invitation", exact: true })
      .click();
    await expect(colleaguePage.getByTestId(`invitation-${declined.id}`)).toHaveCount(0);
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM "Membership" WHERE "userId"=7003 AND "teamId"=$1',
          [org.organizationId]
        )
      ).rows[0].count,
      0
    );
    await ownerPage.reload({ waitUntil: "domcontentloaded" });
    const revoked = await invite("colleague@example.test");
    // A DOM load is not completion of the native inbox query. This controlled
    // slow read exceeds the default assertion timeout but stays within the
    // already-declared 45-second browser operation budget.
    let delayedInboxRead = false;
    const inboxRoute = origin + "/api/trpc/enterpriseTeams/**";
    const delayedRead = async (route) => {
      const operations = new URL(route.request().url()).pathname.split("/").at(-1).split(",");
      if (!delayedInboxRead && route.request().method() === "GET" && operations.includes("invitations")) {
        delayedInboxRead = true;
        await new Promise((resolve) => setTimeout(resolve, 6000));
      }
      await route.continue();
    };
    await colleaguePage.route(inboxRoute, delayedRead);
    await reloadInbox(colleaguePage, revoked.id);
    assert.equal(delayedInboxRead, true, "The delayed native read must actually execute");
    await colleaguePage.unroute(inboxRoute, delayedRead);
    await expect(colleaguePage.getByTestId(`invitation-${revoked.id}`)).toBeVisible();
    await ownerPage
      .getByTestId(`invitation-${revoked.id}`)
      .getByRole("button", { name: "Cancel invitation", exact: true })
      .click();
    await expect(ownerPage.getByTestId(`invitation-${revoked.id}`)).toHaveCount(0);
    // Deliberately keep the recipient's stale screen: a button rendered before
    // cancellation is not authority to complete the now-revoked invitation.
    await colleaguePage
      .getByTestId(`invitation-${revoked.id}`)
      .getByRole("button", { name: "Accept invitation", exact: true })
      .click();
    await expect(colleaguePage.getByRole("alert").filter({ hasText: "cannot act" })).toBeVisible();
    assert.deepEqual(await colleague.client.query("overview"), []);
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM "Profile" WHERE "userId"=7003 AND "organizationId"=$1',
          [org.organizationId]
        )
      ).rows[0].count,
      0
    );
    await expect.poll(() => fixture.smtp.count()).toBe(3);
    fixture.smtp.setRejecting(true);
    await ownerPage.reload({ waitUntil: "domcontentloaded" });
    const mailFailed = await invite("colleague@example.test");
    await expect(
      ownerPage.getByRole("status").filter({ hasText: "email submission was not confirmed" })
    ).toBeVisible();
    assert.equal(fixture.smtp.count(), 3);
    const pending = (
      await pool.query('SELECT accepted FROM "Membership" WHERE "userId"=7003 AND "teamId"=$1', [
        org.organizationId,
      ])
    ).rows[0];
    assert.equal(pending.accepted, false);
    await reloadInbox(colleaguePage, mailFailed.id);
    await expect(colleaguePage.getByTestId(`invitation-${mailFailed.id}`)).toBeVisible();
    await colleaguePage
      .getByTestId(`invitation-${mailFailed.id}`)
      .getByRole("button", { name: "Decline invitation", exact: true })
      .click();
    await expect(colleaguePage.getByTestId(`invitation-${mailFailed.id}`)).toHaveCount(0);
    await ownerPage.screenshot({ path: path.join(output, "invitation-mail-failure.png"), fullPage: true });
    fixture.smtp.setRejecting(false);
    assert.equal(fixture.oidc.exchanges(), 3);
    t.diagnostic(
      JSON.stringify({
        nativeIdentities: 3,
        actualMutationAndInboxReadback: true,
        inboxResponseMilliseconds: inboxTimings,
        controlledInboxDelayMilliseconds: 6000,
        verifiedEmailRequiredAtIssueAndAccept: true,
        accepted: 1,
        declined: 2,
        cancelled: 1,
        staleAcceptDenied: true,
        deliveredToLocalSmtp: 3,
        smtpFailurePreservesPending: true,
        personalIdentityUnmoved: true,
        scope:
          "built web, PostgreSQL and real encrypted sessions against TLS fixture; existing users only; no live IdP, external inbox delivery or community enrollment",
      })
    );
  } finally {
    fixture.smtp.setRejecting(false);
    await browser.close();
  }
}
module.exports = { seedInvitationBrowserFixture, runInvitationBrowserJourney, sessionFor };
