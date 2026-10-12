// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");
const name = "expectSuccessfulRoundRobinReschedulingEmails";
function load(waitFor, receive) {
  const text = fs.readFileSync(
    path.join(root, "packages/testing/src/lib/bookingScenario/expects.ts"),
    "utf8"
  );
  const ast = ts.createSourceFile("expects.ts", text, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name
  );
  assert.ok(declaration);
  const output = ts.transpileModule(declaration.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "vi", "expect", output)(module, module.exports, { waitFor }, () => ({
    toHaveEmail: receive,
  }));
  return module.exports[name];
}
test("round-robin email assertion returns a promise and waits for all outcomes", async () => {
  const messages = [];
  const check = load(
    async (callback) => {
      await Promise.resolve();
      callback();
    },
    (message) => messages.push(message.heading)
  );
  const result = check({
    emails: [],
    newOrganizer: { email: "new@example.test" },
    prevOrganizer: { email: "old@example.test" },
    bookerReschedule: true,
  });
  assert.equal(typeof result?.then, "function");
  await result;
  assert.deepEqual(messages, ["new_event_scheduled", "event_request_cancelled", "event_request_reassigned"]);
});
test("same host represented by distinct fixture objects expects a reschedule, not reassignment", async () => {
  const messages = [];
  const check = load(
    async (callback) => callback(),
    (message) => messages.push(message.heading)
  );
  await check({
    emails: [],
    newOrganizer: { email: "HOST@example.test" },
    prevOrganizer: { email: "host@example.test" },
  });
  assert.deepEqual(messages, ["event_has_been_rescheduled"]);
});
test("missing email assertions reject the awaited helper instead of escaping the test", async () => {
  const check = load(
    async () => {
      throw new Error("Missing expected message");
    },
    () => {}
  );
  await assert.rejects(
    check({
      emails: [],
      newOrganizer: { email: "new@example.test" },
      prevOrganizer: { email: "old@example.test" },
    }),
    /Missing expected message/
  );
});
test("all retained rescheduling test callers await the helper", () => {
  const file = path.join(root, "packages/features/bookings/lib/handleNewBooking/test/reschedule.test.ts");
  const ast = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  let calls = 0;
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
      calls++;
      assert.ok(ts.isAwaitExpression(node.parent), "A rescheduling email assertion must be awaited");
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(calls, 5);
});

function selectNotification(messages, expectedEmail, to, subject) {
  const file = path.join(root, "packages/testing/src/lib/bookingScenario/expects.ts");
  const ast = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  let expression;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "testEmail")
      expression = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(expression);
  const output = ts.transpileModule(`module.exports = ${expression};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: null };
  new Function("module", "emails", "expectedEmail", "to", "subject", "parse", output)(
    module,
    { get: () => messages },
    expectedEmail,
    to,
    subject,
    require("node-html-parser").parse
  );
  return module.exports;
}
test("email assertions find the requested lifecycle notification, not an older message to the same recipient", () => {
  const to = "owner@example.test";
  const messages = [
    { to, subject: "created", html: '<h1 data-testid="heading">new_event_scheduled</h1>' },
    { to, subject: "moved", html: '<h1 data-testid="heading">event_has_been_rescheduled</h1>' },
  ];
  assert.equal(selectNotification(messages, { heading: "event_has_been_rescheduled" }, to), messages[1]);
  assert.equal(selectNotification(messages, { heading: "event_request_cancelled" }, to), undefined);
  assert.equal(
    selectNotification(messages, { heading: "event_has_been_rescheduled" }, "stranger@example.test"),
    undefined
  );
  assert.equal(
    selectNotification(messages, { heading: "event_has_been_rescheduled" }, to, "created"),
    undefined
  );
});
