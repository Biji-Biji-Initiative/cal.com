// SPDX-License-Identifier: MIT
// Known-advisory floors and real dependency behavior. These are not a blanket
// vulnerability waiver or a substitute for rebuilding/scanning the final image.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const { AsyncLocalStorage } = require("node:async_hooks");
const { test } = require("node:test");
const semver = require("semver");
const yaml = require("yaml");
const root = path.resolve(__dirname, "../..");
const lock = yaml.parse(fs.readFileSync(path.join(root, "yarn.lock"), "utf8"));
const floors = [
  ["axios", "1", "1.20.0"],
  ["form-data", "4", "4.0.6"],
  ["@xmldom/xmldom", "0.8", "0.8.15"],
  ["@xmldom/xmldom", "0.9", "0.9.12"],
  ["effect", "3", "3.20.0"],
  ["kysely", "0.28", "0.28.17"],
  ["linkify-it", "5", "5.0.2"],
  ["nanoid", "3", "3.3.20"],
  ["postcss", "8", "8.5.23"],
  ["source-map-js", "1", "1.2.2"],
  ["vite", "6", "6.4.3"],
  ["ws", "7", "7.5.11"],
  ["ws", "8", "8.21.3"],
  ["brace-expansion", "1", "1.1.20"],
  ["brace-expansion", "2", "2.1.6"],
  ["brace-expansion", "5", "5.0.11"],
  ["next", "16.3", "16.3.8"],
];
for (const [name, line, minimum] of floors) {
  test(`every locked ${name} ${line}.x resolution meets its reviewed floor`, () => {
    const entries = Object.entries(lock).filter(
      ([key, value]) =>
        key.startsWith(`${name}@`) &&
        semver.valid(value.version) &&
        semver.satisfies(value.version, `${line}.x`)
    );
    assert.ok(entries.length > 0, `No ${name} ${line}.x resolution was inspected`);
    for (const [key, value] of entries)
      assert.ok(semver.gte(value.version, minimum), `${key}: ${value.version} < ${minimum}`);
  });
}

test("the shipping web package selects the reviewed Next patch, not a global major override", () => {
  const web = JSON.parse(fs.readFileSync(path.join(root, "apps/web/package.json"), "utf8"));
  const repo = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(web.dependencies.next, "16.3.8");
  assert.equal(repo.resolutions.next, undefined);
});

test("the actual Effect scheduler preserves concurrent request context", async () => {
  const { Effect } = require("effect");
  const storage = new AsyncLocalStorage();
  const outputs = await Promise.all(
    Array.from({ length: 64 }, (_, id) =>
      storage.run(id, () =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* Effect.yieldNow();
            yield* Effect.sleep("1 millis");
            return yield* Effect.sync(() => storage.getStore());
          })
        )
      )
    )
  );
  assert.deepEqual(
    outputs,
    Array.from({ length: 64 }, (_, id) => id)
  );
});

test("the real HTTP adapter preserves JSON/multipart behavior and rejects oversized responses", async () => {
  const axios = require("axios");
  const FormData = require("form-data");
  const server = http.createServer(async (request, response) => {
    if (request.url === "/large") {
      response.end("x".repeat(1024));
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({ body: Buffer.concat(chunks).toString(), type: request.headers["content-type"] })
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const client = axios.create({ adapter: "http", proxy: false, timeout: 5000 });
    const json = await client.post(url, { appointment: "synthetic", enabled: true });
    assert.deepEqual(JSON.parse(json.data.body), { appointment: "synthetic", enabled: true });
    const form = new FormData();
    form.append("title", "Synthetic appointment");
    const multipart = await client.post(url, form, { headers: form.getHeaders() });
    assert.match(multipart.data.type, /^multipart\/form-data; boundary=/);
    assert.ok(multipart.data.body.includes('name="title"'));
    assert.ok(multipart.data.body.includes("Synthetic appointment"));
    await assert.rejects(
      client.get(url + "/large", { maxContentLength: 64 }),
      (error) => error.code === "ERR_BAD_RESPONSE"
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("retained XML, link, identifier and stylesheet consumers still operate", () => {
  const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");
  const xml = new DOMParser().parseFromString(
    '<cal:entry xmlns:cal="urn:calendar"><cal:title>A &amp; B</cal:title></cal:entry>',
    "text/xml"
  );
  assert.equal(xml.documentElement.namespaceURI, "urn:calendar");
  assert.equal(xml.getElementsByTagName("cal:title")[0].textContent, "A & B");
  assert.match(new XMLSerializer().serializeToString(xml), /A &amp; B/);
  const links = require("linkify-it")().match("Meet at https://example.test/booking");
  assert.equal(links[0].url, "https://example.test/booking");
  const { nanoid } = require("nanoid");
  const ids = Array.from({ length: 64 }, () => nanoid(21));
  assert.equal(new Set(ids).size, 64);
  assert.ok(ids.every((id) => /^[A-Za-z0-9_-]{21}$/.test(id)));
  const css = require("postcss").parse(".calendar { display: grid; }");
  assert.equal(css.first.selector, ".calendar");
  assert.equal(css.first.first.value, "grid");
});

test("runtime preparation does not depend on globally installed package managers", () => {
  const source = fs.readFileSync(path.join(root, "scripts/enterprise-runtime-entrypoint.cjs"), "utf8");
  assert.match(source, /spawn\(process\.execPath/);
  assert.doesNotMatch(source, /spawn\(["'](?:npm|npx|yarn|yarnpkg|corepack)["']/);
  const dockerfile = fs.readFileSync(path.join(root, "Dockerfile.enterprise-preview"), "utf8");
  for (const target of [
    "/usr/local/lib/node_modules/npm",
    "/usr/local/lib/node_modules/corepack",
    "/opt/yarn-v1.22.22",
  ]) {
    assert.ok(dockerfile.includes(target), `Runtime tool removal is absent: ${target}`);
  }
  assert.match(dockerfile, /USER 1000:1000/);
});
