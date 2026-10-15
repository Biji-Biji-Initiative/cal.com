#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Read-only comparison of complete, pinned GitHub tree responses. It never
// fetches credentials, copies historical code, or modifies a Git worktree.
const fs = require("node:fs");

function filesFromTree(document) {
  if (!document || document.truncated !== false || !Array.isArray(document.tree)) {
    throw new Error("A complete GitHub tree response with truncated=false is required");
  }
  if (!/^[a-f0-9]{40}$/.test(document.sha || "")) throw new Error("Missing immutable tree identity");
  const files = new Map();
  const seen = new Set();
  for (const entry of document.tree) {
    if (
      typeof entry.path !== "string" ||
      !entry.path ||
      entry.path.startsWith("/") ||
      entry.path.split("/").some((part) => part === ".." || part === "." || !part) ||
      seen.has(entry.path) ||
      !/^[a-f0-9]{40}$/.test(entry.sha || "")
    ) {
      throw new Error("Invalid, duplicate or escaping tree path");
    }
    seen.add(entry.path);
    if (entry.type === "commit") throw new Error("Submodule contents require a separately scoped inventory");
    if (entry.type === "tree") continue;
    if (entry.type !== "blob" || !["100644", "100755", "120000"].includes(entry.mode)) {
      throw new Error("Unknown file or executable mode");
    }
    files.set(entry.path, { sha: entry.sha, mode: entry.mode });
  }
  if (!files.size) throw new Error("An empty file inventory is not a valid baseline");
  return files;
}

function compareTrees(beforeDocument, afterDocument) {
  const before = filesFromTree(beforeDocument);
  const after = filesFromTree(afterDocument);
  const changes = [];
  let identical = 0;
  for (const filename of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const left = before.get(filename);
    const right = after.get(filename);
    if (left?.sha === right?.sha && left?.mode === right?.mode) {
      identical++;
      continue;
    }
    changes.push({
      path: filename,
      change: !left ? "added" : !right ? "removed" : "modified",
      before: left || null,
      after: right || null,
    });
  }
  return {
    beforeTree: beforeDocument.sha,
    afterTree: afterDocument.sha,
    beforeFiles: before.size,
    afterFiles: after.size,
    identical,
    changes,
  };
}

function verifyDecisions(delta, decisions) {
  if (!Array.isArray(decisions) || decisions.length !== delta.changes.length) {
    throw new Error("Every changed path requires exactly one disposition");
  }
  const byPath = new Map();
  for (const row of decisions) {
    if (byPath.has(row.path)) throw new Error("Duplicate disposition");
    byPath.set(row.path, row);
  }
  for (const change of delta.changes) {
    const row = byPath.get(change.path);
    if (
      !row ||
      !["retained", "obsolete", "replaced", "unresolved"].includes(row.disposition) ||
      typeof row.reason !== "string" ||
      row.reason.trim().length < 20 ||
      !Array.isArray(row.tasks) ||
      !row.tasks.length ||
      row.tasks.some((id) => !/^CAL-\d{2}\.[A-Z]+$/.test(id)) ||
      JSON.stringify(row.before) !== JSON.stringify(change.before) ||
      JSON.stringify(row.after) !== JSON.stringify(change.after)
    ) {
      throw new Error(`Unresolved or changed source identity/disposition: ${change.path}`);
    }
  }
  return true;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 && args.length !== 3) {
      throw new Error(
        "Usage: node inventory-enterprise-fork.cjs BEFORE_TREE.json AFTER_TREE.json [DECISIONS.json]"
      );
    }
    const delta = compareTrees(...args.slice(0, 2).map((name) => JSON.parse(fs.readFileSync(name, "utf8"))));
    if (args[2]) verifyDecisions(delta, JSON.parse(fs.readFileSync(args[2], "utf8")));
    console.log(JSON.stringify(delta, null, 2));
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
module.exports = { compareTrees, filesFromTree, verifyDecisions };
