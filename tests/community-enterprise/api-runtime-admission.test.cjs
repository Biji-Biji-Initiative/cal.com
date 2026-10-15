// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const runner = path.resolve(__dirname, "../../scripts/run-community-enterprise-postgres.py");
const image = "sha256:" + "a".repeat(64);
for (const values of [
  [],
  ["--api-node-image", image],
  ["--api-node-image", "node:22", "--api-redis-image", image],
  ["--api-node-image", "sha256:" + "z".repeat(64), "--api-redis-image", image],
]) {
  test(`native API test refuses missing or mutable runtime selection: ${values.join(" ") || "none"}`, () => {
    const result = spawnSync("python3", [runner, "--suite", "api-assembled", ...values], {
      encoding: "utf8",
      timeout: 10000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires explicit local sha256 image IDs/);
    assert.ok(!result.stdout.includes("Schema CLI"));
  });
}
test("API runtime image selection cannot affect another database suite", () => {
  const result = spawnSync(
    "python3",
    [runner, "--suite", "hosts", "--api-node-image", image, "--api-redis-image", image],
    { encoding: "utf8", timeout: 10000 }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /require --suite api-assembled/);
  assert.ok(!result.stdout.includes("Schema CLI"));
});
