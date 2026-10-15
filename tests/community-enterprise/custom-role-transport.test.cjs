// SPDX-License-Identifier: MIT
// Real retained client endpoint resolution, batch/http links and serialization.
// Only the Next hook constructor is captured; a loopback receiver is not an
// authorization test or a substitute for the assembled browser/server journey.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const { createServer } = require("node:http");
const { before, after, test } = require("node:test");
const ts = require("typescript");
const native = require("@trpc/client");
const superjson = require("superjson").default;
const root = path.resolve(__dirname, "../..");
let server, client, origin;
const received = [];
const saved = Object.fromEntries(
  ["VERCEL_URL", "NEXT_PUBLIC_WEBAPP_URL"].map((key) => [key, process.env[key]])
);
function load(relative, imports) {
  const text = fs.readFileSync(path.join(root, relative), "utf8");
  const compiled = ts.transpileModule(text, {
    fileName: relative,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  });
  assert.deepEqual(compiled.diagnostics, []);
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.outputText)(
    (name) => {
      assert.ok(Object.hasOwn(imports, name), `Unexpected runtime dependency: ${name}`);
      return imports[name];
    },
    module,
    module.exports
  );
  return module.exports;
}
before(async () => {
  server = createServer(async (request, response) => {
    const url = new URL(request.url, origin);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const encoded =
      request.method === "GET" ? url.searchParams.get("input") : Buffer.concat(chunks).toString();
    const batch = url.searchParams.get("batch") === "1";
    const raw = JSON.parse(encoded);
    const payload = superjson.deserialize(batch ? raw["0"] : raw);
    received.push({ path: url.pathname, method: request.method, batch, payload });
    response.writeHead(200, { "Content-Type": "application/json" });
    const data = { acknowledged: true };
    const result = { result: { data: superjson.serialize(data) } };
    response.end(JSON.stringify(batch ? [result] : result));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
  delete process.env.VERCEL_URL;
  process.env.NEXT_PUBLIC_WEBAPP_URL = origin;
  const shared = load("packages/trpc/react/shared.ts", {
    "@trpc/react-query/shared": require("@trpc/react-query/shared"),
  });
  let captured;
  load("packages/trpc/react/trpc.ts", {
    superjson: require("superjson"),
    "@trpc/client": native,
    "@trpc/next": {
      createTRPCNext: (configuration) => {
        captured = configuration;
        return {};
      },
    },
    "./shared": shared,
  });
  const configuration = captured.config();
  client = native.createTRPCUntypedClient({
    links: configuration.links,
    transformer: configuration.transformer,
  });
});
after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
for (const skipBatch of [false, true]) {
  for (const method of ["query", "mutation"]) {
    test(`shared browser transport routes custom-role ${method} with skipBatch=${skipBatch}`, async () => {
      const action = method === "query" ? "capability" : "review";
      const input = { organizationId: 10, scopeId: 20 };
      const options = { context: { skipBatch } };
      const count = received.length;
      const result = await client[method](`viewer.enterpriseRoles.${action}`, input, options);
      assert.deepEqual(result, { acknowledged: true });
      assert.equal(received.length, count + 1);
      assert.deepEqual(received.at(-1), {
        path: `/api/trpc/enterpriseRoles/${action}`,
        method: method === "query" ? "GET" : "POST",
        batch: !skipBatch,
        payload: input,
      });
    });
  }
}
