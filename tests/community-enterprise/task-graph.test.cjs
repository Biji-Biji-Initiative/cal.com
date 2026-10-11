// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  validateGraph,
  readyTasks,
  isComplete,
} = require("../../scripts/verify-community-enterprise-task-graph.cjs");
const root = path.resolve(__dirname, "../..");
const read = () =>
  JSON.parse(fs.readFileSync(path.join(root, "docs/community-enterprise/TASK_GRAPH.json"), "utf8"));
const errorsAfter = (change) => {
  const graph = read();
  change(graph);
  return validateGraph(graph, root);
};
test("published plan has a valid DAG, owners, acceptance and evidence", () => {
  assert.deepEqual(validateGraph(read(), root), []);
});
test("unknown prerequisites fail", () => {
  assert.ok(
    errorsAfter((graph) => graph.tasks.find((task) => task.kind === "task").requires.push("missing")).length
  );
});
test("cycles fail", () => {
  assert.ok(
    errorsAfter((graph) => {
      const task = graph.tasks.find((task) => task.kind === "task");
      task.requires.push(task.id);
    }).some((error) => error.includes("cycle"))
  );
});
test("duplicate identities fail", () => {
  assert.ok(
    errorsAfter((graph) => graph.tasks.push(graph.tasks[0])).some((error) => error.includes("Duplicate"))
  );
});
test("a whole epic cannot accidentally serialize all independent work", () => {
  assert.ok(
    errorsAfter((graph) => graph.tasks.find((task) => task.kind === "task").requires.push("CAL-05")).some(
      (error) => error.includes("epics")
    )
  );
});
test("source evidence cannot be promoted to runtime acceptance", () => {
  assert.ok(
    errorsAfter((graph) => {
      graph.tasks.find((task) => task.state === "source_proven").state = "runtime_proven";
    }).some((error) => error.includes("runtime"))
  );
});
test("claimed proof without evidence fails", () => {
  assert.ok(
    errorsAfter((graph) => {
      const task = graph.tasks.find((task) => task.kind === "task");
      task.state = "source_proven";
      task.evidence = [];
    }).some((error) => error.includes("evidence"))
  );
});
test("parent completion cannot outrun its children", () => {
  assert.ok(
    errorsAfter((graph) => {
      graph.tasks.find((task) => task.kind === "epic").state = "runtime_proven";
    }).some((error) => error.includes("premature"))
  );
});
test("ownerless tasks fail", () => {
  assert.ok(
    errorsAfter((graph) => {
      delete graph.tasks.find((task) => task.kind === "task").owner_role;
    }).some((error) => error.includes("owner"))
  );
});
test("evidence cannot escape the repository", () => {
  assert.ok(
    errorsAfter((graph) => {
      graph.tasks.find((task) => task.evidence?.length).evidence[0].file = "../../outside";
    }).some((error) => error.includes("evidence"))
  );
});
test("original CAL parent IDs are preserved", () => {
  const ids = read()
    .tasks.filter((task) => task.kind === "epic")
    .map((task) => task.id);
  assert.deepEqual(
    ids,
    Array.from({ length: 10 }, (_, i) => `CAL-${String(i + 1).padStart(2, "0")}`)
  );
});
test("team production acceptance includes identity, API, booking, preservation and delivery controls", () => {
  const graph = read();
  const tasks = new Map(graph.tasks.map((task) => [task.id, task]));
  const reached = new Set();
  const visit = (id) => {
    if (reached.has(id)) return;
    reached.add(id);
    for (const prior of tasks.get(id).requires) visit(prior);
  };
  for (const id of graph.milestones.find((milestone) => milestone.id === "M2").requires) visit(id);
  for (const id of [
    "CAL-04.REVOCATION",
    "CAL-04.SCIM",
    "CAL-05.API",
    "CAL-05.UI",
    "CAL-06.JOURNEY",
    "CAL-07.AUDIT",
    "CAL-07.REMINDERS",
    "CAL-08.MIGRATE",
    "CAL-08.UPDATE",
  ]) {
    assert.ok(reached.has(id), `Missing production requirement: ${id}`);
  }
});

test("source-only evidence cannot satisfy a runtime prerequisite", () => {
  assert.equal(isComplete({ state: "source_proven", completion_evidence_level: "runtime" }), false);
  assert.equal(isComplete({ state: "source_proven", completion_evidence_level: "source" }), true);
  const graph = read();
  for (const task of graph.tasks.filter((task) => task.kind === "task")) task.state = "source_proven";
  graph.tasks.find((task) => task.id === "CAL-09.ACCEPT").state = "open";
  assert.ok(!readyTasks(graph).some((task) => task.id === "CAL-09.ACCEPT"));
});
test("runnable work includes the retained engine without waiting for full administration", () => {
  const ready = readyTasks(read()).map((task) => task.id);
  assert.equal(ready[0], "CAL-02.PREVIEW");
  assert.ok(ready.includes("CAL-06.REUSE"));
  assert.ok(ready.includes("CAL-05.CORE"));
  assert.ok(!ready.includes("CAL-09.PILOT"));
});

test("undeclared execution lanes fail", () => {
  assert.ok(
    errorsAfter((graph) => {
      graph.tasks.find((task) => task.kind === "task").lane = "invented";
    }).some((error) => error.includes("lane"))
  );
});

test("ready CLI produces machine-readable JSON without extra diagnostics", () => {
  const { execFileSync } = require("node:child_process");
  const text = execFileSync(
    process.execPath,
    [path.join(root, "scripts/verify-community-enterprise-task-graph.cjs"), "--ready"],
    { encoding: "utf8" }
  );
  const ready = JSON.parse(text);
  assert.equal(ready[0].id, "CAL-02.PREVIEW");
  assert.equal(ready[0].priority, 0);
});

test("an accepted epic can combine completed source and runtime prerequisites", () => {
  const graph = read();
  const epic = graph.tasks.find((task) => task.id === "CAL-02");
  epic.state = "runtime_proven";
  for (const child of graph.tasks.filter((task) => task.parent === epic.id)) {
    child.state = child.completion_evidence_level === "runtime" ? "runtime_proven" : "source_proven";
    // Synthetic verifier input only; no persisted task state is modified.
    child.evidence = [
      {
        file: "docs/community-enterprise/VALIDATION-2026-10-12.md",
        level: child.completion_evidence_level,
        command: "synthetic-test-proof",
        exit_code: 0,
        summary: "Verifier fixture; not a real completion record",
      },
    ];
  }
  assert.deepEqual(validateGraph(graph, root), []);
  epic.state = "source_proven";
  assert.ok(validateGraph(graph, root).some((error) => error.includes("premature epic")));
});

test("required fork reconciliation cannot be orphaned from the production path", () => {
  assert.ok(
    errorsAfter((graph) => {
      const acceptance = graph.tasks.find((task) => task.id === "CAL-09.ACCEPT");
      acceptance.requires = acceptance.requires.filter((id) => id !== "CAL-01.REUSE");
    }).some((error) => error.includes("team-release dependency path"))
  );
});
