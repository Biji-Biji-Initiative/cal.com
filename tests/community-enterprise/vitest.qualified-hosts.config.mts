import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/community-enterprise/qualified-hosts.test.ts"],
    maxWorkers: 1,
    passWithNoTests: false,
    server: { deps: { inline: [/@calcom\/.*/] } },
  },
});
