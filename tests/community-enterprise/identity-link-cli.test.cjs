// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const {
  parseArguments,
  readJson,
  databaseFingerprint,
} = require("../../scripts/link-enterprise-identity.cjs");

test("CLI has no implicit apply mode", () => {
  for (const args of [
    [],
    ["--apply"],
    ["apply"],
    ["plan", "--request", "in.json"],
    ["plan", "--request", "in", "--out", "out", "--database", "db", "--force", "true"],
  ]) {
    assert.throws(() => parseArguments(args));
  }
});
test("CLI requires each named option exactly once", () => {
  assert.throws(() =>
    parseArguments(["plan", "--request", "in", "--out", "out", "--database", "db", "--database", "other"])
  );
  assert.equal(
    parseArguments([
      "apply",
      "--request",
      "request.json",
      "--plan",
      "reviewed.json",
      "--database",
      "calendar",
    ]).mode,
    "apply"
  );
});
test("database fingerprint excludes the password and changes for another host or database", () => {
  const identity = { database: "calendar", role: "app", address: "127.0.0.1", serverPort: 5432 };
  const first = databaseFingerprint("postgresql://app:secret@host/calendar", identity);
  assert.equal(first, databaseFingerprint("postgresql://app:other@host/calendar", identity));
  assert.notEqual(first, databaseFingerprint("postgresql://app:secret@other/calendar", identity));
  assert.notEqual(first, databaseFingerprint("postgresql://app:secret@host/other", identity));
  assert.throws(() => databaseFingerprint("https://host/calendar", identity));
});
test("file inputs reject symbolic links, oversized files and invalid JSON", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cal-link-files-"));
  try {
    const file = path.join(directory, "request.json");
    fs.writeFileSync(file, "{}");
    const link = path.join(directory, "linked.json");
    fs.symlinkSync(file, link);
    assert.throws(() => readJson(link));
    assert.deepEqual(readJson(file), {});
    fs.writeFileSync(file, "not json");
    assert.throws(() => readJson(file));
    fs.writeFileSync(file, " ".repeat(65537));
    assert.throws(() => readJson(file));
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});
