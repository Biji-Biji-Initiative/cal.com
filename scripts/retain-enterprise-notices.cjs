// SPDX-License-Identifier: MIT
const fs = require("node:fs/promises");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

async function retainNotices(output) {
  let copied = 0;
  await fs.copyFile(path.join(root, "LICENSE"), path.join(output, "standalone/LICENSE"));
  for (const name of ["standalone", "ops"]) {
    const base = path.join(output, name);
    const visit = async (directory) => {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      if (entries.some((entry) => entry.name === "package.json" && entry.isFile())) {
        const original = path.join(root, path.relative(base, directory));
        let sourceFiles = [];
        try {
          sourceFiles = await fs.readdir(original, { withFileTypes: true });
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        for (const file of sourceFiles) {
          if (file.isFile() && /^(license|licence|copying|notice|third.party.notices)/i.test(file.name)) {
            await fs.copyFile(path.join(original, file.name), path.join(directory, file.name));
            copied++;
          }
        }
      }
      for (const entry of entries) if (entry.isDirectory()) await visit(path.join(directory, entry.name));
    };
    await visit(base);
  }
  return copied;
}
module.exports = { retainNotices };
