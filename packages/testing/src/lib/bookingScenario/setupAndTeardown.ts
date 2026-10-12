import { enableEmailFeature, mockNoTranslations } from "./bookingScenario";
import process from "node:process";
import { afterEach, beforeEach, vi } from "vitest";

// Prismock cannot model raw SQL or PostgreSQL row-lock isolation. This
// suite remains an engine/provider unit test. Real commit isolation is exercised
// by postgres-hosts.test.ts and the packaged booking-concurrency HTTP suite.
vi.mock("@calcom/features/community-enterprise/scheduling/BookingCommitGuard", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@calcom/features/community-enterprise/scheduling/BookingCommitGuard")
  >()),
  assertBookingCanCommit: vi.fn(async () => undefined),
}));

export function setupAndTeardown() {
  beforeEach(() => {
    // Required to able to generate token in email in some cases
    //@ts-expect-error - It is a readonly variable
    process.env.CALENDSO_ENCRYPTION_KEY = "abcdefghjnmkljhjklmnhjklkmnbhjui";
    //@ts-expect-error - It is a readonly variable
    process.env.STRIPE_WEBHOOK_SECRET = "MOCK_STRIPE_WEBHOOK_SECRET";
    // We are setting it in vitest.config.ts because otherwise it's too late to set it.
    // process.env.DAILY_API_KEY = "MOCK_DAILY_API_KEY";

    // Ensure that Rate Limiting isn't enforced for tests
    delete process.env.UNKEY_ROOT_KEY;
    mockNoTranslations();
    // mockEnableEmailFeature();
    enableEmailFeature();
    globalThis.testEmails = [];
    fetchMock.resetMocks();
  });
  afterEach(() => {
    //@ts-expect-error - It is a readonly variable
    delete process.env.CALENDSO_ENCRYPTION_KEY;
    //@ts-expect-error - It is a readonly variable
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.DAILY_API_KEY;
    globalThis.testEmails = [];
    fetchMock.resetMocks();
    // process.env.DAILY_API_KEY = "MOCK_DAILY_API_KEY";
  });
}
