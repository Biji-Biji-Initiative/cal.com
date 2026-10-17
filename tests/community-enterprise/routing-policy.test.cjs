// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
function load(file) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, strict: true },
  });
  assert.deepEqual(output.diagnostics, []);
  const module = { exports: {} };
  new Function("module", "exports", output.outputText)(module, module.exports);
  return module.exports;
}
const { resolveTeamRoute } = load("packages/features/community-enterprise/routing/TeamRoutingPolicy.ts");
const base = {
  eligibleTeamIds: [10, 20, 30],
  programme: "YSEALI 2026",
  service: "Mentoring",
  language: "English",
};
const rule = (overrides) => ({ id: "r-" + Math.random(), teamId: 10, ...overrides });

test("selects the most specific exact rule and normalizes request values", () => {
  const result = resolveTeamRoute(
    [
      rule({ id: "fallback", teamId: 30, fallback: true }),
      rule({ id: "programme", teamId: 20, programme: "yseali 2026" }),
      rule({ id: "exact", teamId: 10, programme: "YSEALI 2026", service: "mentoring", language: "ENGLISH", priority: 50 }),
    ],
    base
  );
  assert.equal(result.kind, "matched");
  assert.equal(result.ruleId, "exact");
  assert.equal(result.teamId, 10);
  assert.deepEqual(result.matchedDimensions, ["programme", "service", "language"]);
  assert.equal(result.fallback, false);
});

test("uses priority after specificity and stable id tie-breaker", () => {
  const result = resolveTeamRoute(
    [
      rule({ id: "z", teamId: 30, programme: base.programme, service: base.service, priority: 10 }),
      rule({ id: "a", teamId: 20, programme: base.programme, service: base.service, priority: 5 }),
    ],
    base
  );
  assert.equal(result.kind, "matched");
  assert.equal(result.ruleId, "a");
  assert.equal(result.teamId, 20);
});

test("fallback is explicit and cannot steal an exact match", () => {
  const result = resolveTeamRoute(
    [
      rule({ id: "fallback", teamId: 30, fallback: true }),
      rule({ id: "service", teamId: 20, service: base.service }),
    ],
    base
  );
  assert.equal(result.kind, "matched");
  assert.equal(result.ruleId, "service");
  assert.equal(result.fallback, false);
  assert.match(result.explanation, /matched service/);
});

test("disabled, ineligible and invalid team rules are ignored", () => {
  const result = resolveTeamRoute(
    [
      rule({ id: "disabled", teamId: 10, service: base.service, enabled: false }),
      rule({ id: "foreign", teamId: 99, service: base.service }),
      rule({ id: "bad", teamId: 0, service: base.service }),
      rule({ id: "eligible", teamId: 20, service: base.service }),
    ],
    base
  );
  assert.equal(result.kind, "matched");
  assert.equal(result.ruleId, "eligible");
});

test("no eligible team and no matching rule are explainable", () => {
  const empty = resolveTeamRoute([], { ...base, eligibleTeamIds: [] });
  assert.deepEqual(empty, {
    kind: "no_match",
    reason: "no-eligible-team",
    explanation: "No active team is eligible for this request.",
  });
  const unmatched = resolveTeamRoute(
    [rule({ id: "other", teamId: 10, programme: "other" })],
    base
  );
  assert.deepEqual(unmatched, {
    kind: "no_match",
    reason: "no-matching-rule",
    explanation: "No enabled routing rule matches the requested programme, service and language.",
  });
});

test("a fallback rule is selected when it is the only eligible match", () => {
  const result = resolveTeamRoute(
    [rule({ id: "fallback", teamId: 20, fallback: true })],
    base
  );
  assert.equal(result.kind, "matched");
  assert.equal(result.fallback, true);
  assert.equal(result.ruleId, "fallback");
});
