import { defineConfig } from "vitest/config";

// This suite executes the real generated TypeScript Prisma client and service.
// It intentionally does not load the application's global mocked-DB setup.
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/community-enterprise/postgres-identity-link.test.ts",
      "tests/community-enterprise/postgres-teams.test.ts",
      "tests/community-enterprise/postgres-organizations.test.ts",
      "tests/community-enterprise/postgres-invitations.test.ts",
      "tests/community-enterprise/postgres-hosts.test.ts",
    ],
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 180000,
    passWithNoTests: false,
    server: { deps: { inline: [/@calcom\/.*/] } },
  },
});
