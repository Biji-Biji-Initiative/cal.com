// SPDX-License-Identifier: MIT
const fs = require("node:fs");
const path = require("node:path");

function isComplete(task) {
  return (
    task?.state === "runtime_proven" ||
    (task?.state === "source_proven" && task.completion_evidence_level === "source")
  );
}

function readyTasks(graph) {
  const byId = new Map(graph.tasks.map((task) => [task.id, task]));
  const focus = graph.execution.focus_order ?? [];
  const rank = (id) => (focus.includes(id) ? focus.indexOf(id) : focus.length);
  return graph.tasks
    .filter(
      (task) =>
        task.kind === "task" &&
        task.state !== "blocked" &&
        !isComplete(task) &&
        task.requires.every((id) => isComplete(byId.get(id)))
    )
    .sort((a, b) => a.priority - b.priority || rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

function validateGraph(graph, root) {
  const errors = [];
  if (graph.schema_version !== 2) errors.push("Unsupported graph schema");
  if (graph.execution?.max_concurrent_agents > 4) errors.push("Agent capacity exceeds owner constraint");
  const tasks = graph.tasks ?? [];
  const byId = new Map();
  const states = new Set(["open", "in_progress", "blocked", "source_proven", "runtime_proven"]);
  for (const task of tasks) {
    if (byId.has(task.id)) errors.push(`Duplicate task ID: ${task.id}`);
    byId.set(task.id, task);
    if (!states.has(task.state)) errors.push(`${task.id}: invalid state`);
    if (!Array.isArray(task.requires)) errors.push(`${task.id}: dependencies must be explicit`);
    if (task.kind === "task") {
      if (!Number.isInteger(task.priority) || task.priority < 0 || task.priority > 2)
        errors.push(`${task.id}: invalid priority`);
      if (!graph.execution?.lanes?.includes(task.lane)) errors.push(`${task.id}: undeclared lane`);
      if (!["source", "runtime"].includes(task.completion_evidence_level)) {
        errors.push(`${task.id}: missing required evidence level`);
      }
      if (!task.owner_role || !task.lane || !task.owned_paths?.length || !task.acceptance?.length) {
        errors.push(`${task.id}: missing owner, scope or acceptance`);
      }
      if (["source_proven", "runtime_proven"].includes(task.state)) {
        const proof = task.evidence?.filter((item) => item.exit_code === 0 && item.command && item.summary);
        if (!proof?.length) errors.push(`${task.id}: proven state without executable evidence`);
        if (task.state === "runtime_proven" && !proof?.some((item) => item.level === "runtime")) {
          errors.push(`${task.id}: source proof cannot establish runtime acceptance`);
        }
      }
      for (const proof of task.evidence ?? []) {
        if (!proof.file || !proof.level) {
          errors.push(`${task.id}: malformed evidence`);
          continue;
        }
        const absolute = path.resolve(root, proof.file);
        if (!absolute.startsWith(`${root}${path.sep}`) || !fs.existsSync(absolute)) {
          errors.push(`${task.id}: missing or out-of-repository evidence`);
        }
      }
    } else if (task.kind !== "epic") errors.push(`${task.id}: unknown kind`);
  }
  for (const task of tasks) {
    for (const dependency of task.requires ?? []) {
      if (!byId.has(dependency)) errors.push(`${task.id}: unknown prerequisite ${dependency}`);
      if (byId.get(dependency)?.kind === "epic")
        errors.push(`${task.id}: depend on executable children, not whole epics`);
    }
    if (task.kind === "task") {
      const parent = byId.get(task.parent);
      if (parent?.kind !== "epic" || !parent.children.includes(task.id))
        errors.push(`${task.id}: invalid parent mapping`);
    } else {
      if (!task.children?.length) errors.push(`${task.id}: empty epic`);
      for (const child of task.children ?? []) {
        if (byId.get(child)?.parent !== task.id) errors.push(`${task.id}: inconsistent child ${child}`);
      }
      if (
        ["source_proven", "runtime_proven"].includes(task.state) &&
        (task.children.some((id) => !isComplete(byId.get(id))) ||
          (task.state === "source_proven" &&
            task.children.some((id) => byId.get(id)?.completion_evidence_level === "runtime")))
      ) {
        errors.push(`${task.id}: premature epic completion`);
      }
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function walk(id) {
    if (visiting.has(id)) {
      errors.push(`Dependency cycle at ${id}`);
      return;
    }
    if (visited.has(id) || !byId.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).requires ?? []) walk(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) walk(id);
  for (const milestone of graph.milestones ?? []) {
    for (const id of milestone.requires ?? [])
      if (!byId.has(id)) errors.push(`${milestone.id}: unknown acceptance dependency ${id}`);
  }
  const reachedByTeamRelease = new Set();
  const teamMilestone = (graph.milestones ?? []).find((milestone) => milestone.id === "M2");
  const collect = (id) => {
    if (reachedByTeamRelease.has(id) || !byId.has(id)) return;
    reachedByTeamRelease.add(id);
    for (const prerequisite of byId.get(id).requires ?? []) collect(prerequisite);
  };
  for (const id of teamMilestone?.requires ?? []) collect(id);
  for (const task of tasks) {
    if (task.kind === "task" && task.required_for_team_release && !reachedByTeamRelease.has(task.id)) {
      errors.push(`${task.id}: required work is absent from the team-release dependency path`);
    }
  }
  return errors;
}

if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  const graph = JSON.parse(
    fs.readFileSync(path.join(root, "docs/community-enterprise/TASK_GRAPH.json"), "utf8")
  );
  const errors = validateGraph(graph, root);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else if (process.argv.includes("--ready")) {
    console.log(
      JSON.stringify(
        readyTasks(graph).map(({ id, title, state, lane, owner_role, priority }) => ({
          id,
          title,
          state,
          lane,
          owner_role,
          priority,
        })),
        null,
        2
      )
    );
  } else {
    console.log(
      `PASS: ${graph.tasks.length} graph nodes, explicit dependencies, valid evidence levels, no cycles`
    );
  }
}
module.exports = { validateGraph, readyTasks, isComplete };
