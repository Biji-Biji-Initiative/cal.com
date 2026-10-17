const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const timezoneSource = fs.readFileSync(path.join(root, "packages/lib/timezone.ts"), "utf8");
const receipt = fs.readFileSync(
  path.join(root, "docs/community-enterprise/UPSTREAM-UPDATE-2026-10-17.md"),
  "utf8"
);

test("rehearsed upstream timezone patch is present exactly once", () => {
  const incoming = 'offset.replace(/^([-+])0(\\d):(\\d{2})$/, "$1$2:$3");';
  const legacy = "offset.replace(/^([-+])(0)(\\d):00$/, (_, sign, _zero, hour) => `${sign}${hour}:00`);";

  assert.equal(timezoneSource.split(incoming).length - 1, 1);
  assert.equal(timezoneSource.includes(legacy), false);
});

test("upstream update receipt binds the reviewed base and incoming revisions", () => {
  assert.match(receipt, /54343aa685ae8f33159d2f485ec4a57bad5c574a/);
  assert.match(receipt, /b84a32150e34dd29caa46e69676a78c0d53f732a/);
  assert.match(receipt, /packages\/lib\/timezone\.ts/);
  assert.match(receipt, /Asia\/Kolkata/);
});
