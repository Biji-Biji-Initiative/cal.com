import { IdentityProvider } from "@calcom/prisma/enums";
import { expect } from "@playwright/test";
import { test } from "./lib/fixtures";

test.describe.configure({ mode: "parallel" });
test.afterEach(({ users }) => users.deleteAll());

test.describe("Self-hosted onboarding", () => {
  const testOnboarding = (identityProvider: IdentityProvider) => {
    test(`Retained setup flow - ${identityProvider} user`, async ({ page, users }) => {
      const user = await users.create({ completedOnboarding: false, name: null, identityProvider });
      await user.apiLogin();
      await page.goto("/onboarding/getting-started");
      await page.waitForURL(/.*\/getting-started(?:\?|$)/);
      await expect(page.getByText("Select plan", { exact: true })).toHaveCount(0);
      await expect(page.getByTestId("onboarding-continue-btn")).toHaveCount(0);

      await test.step("Profile and timezone", async () => {
        await page.locator('input[name="name"]').fill("new user 2");
        await page.getByTestId("connect-calendar-button").click();
        await page.waitForURL(/.*\/getting-started\/connected-calendar/);
        expect((await user.self()).name).toBe("new user 2");
      });
      await test.step("Optional calendar and conferencing", async () => {
        await page.getByTestId("skip-step").click();
        await page.waitForURL(/.*\/getting-started\/connected-video/);
        await page.getByTestId("skip-step").click();
        await page.waitForURL(/.*\/getting-started\/setup-availability/);
      });
      await test.step("Availability and completion", async () => {
        await page.getByTestId("save-availability").click();
        await page.waitForURL(/.*\/getting-started\/user-profile/);
        expect((await user.self()).completedOnboarding).toBe(false);
        await page.getByTestId("finish-onboarding").click();
        await page.waitForURL("/event-types**");
        expect((await user.self()).completedOnboarding).toBe(true);
      });
    });
  };
  testOnboarding(IdentityProvider.GOOGLE);
  testOnboarding(IdentityProvider.CAL);
  testOnboarding(IdentityProvider.SAML);
  testOnboarding(IdentityProvider.AZUREAD);
});
