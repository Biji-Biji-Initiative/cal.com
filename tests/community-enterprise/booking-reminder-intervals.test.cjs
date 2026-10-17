// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "../..");
const routePath = path.join(root, "apps/web/app/api/cron/bookingReminder/route.ts");

test("booking reminder cron checks the exact elapsed threshold", () => {
  const source = fs.readFileSync(routePath, "utf8");

  assert.match(source, /elapsedMinutes:\s*interval/);
  assert.doesNotMatch(source, /elapsedMinutes:\s*\{\s*gte:\s*interval/);
  assert.match(source, /hasReminderForInterval\(reminders, booking\.id, interval\)/);
});
