// SPDX-License-Identifier: MIT
// The installed mailer executes against a controlled delivery plugin; no SMTP or customer delivery is claimed.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const nodemailer = require("nodemailer");

const root = path.resolve(__dirname, "../..");

function fixture() {
  let begin;
  const started = new Promise((resolve) => {
    begin = resolve;
  });
  const state = { started, message: null, complete: null, nativePromise: null };
  const transport = {
    name: "verification-delivery-fixture",
    version: "1.0.0",
    send(message, complete) {
      state.message = message;
      state.complete = complete;
      begin();
    },
  };
  const imports = {
    "node:fs": fs,
    "node:path": path,
    handlebars: require("handlebars"),
    "@calcom/lib/constants": { APP_NAME: "Mereka", WEBAPP_URL: "https://cal.mereka.dev" },
    "@calcom/lib/serverConfig": { serverConfig: { transport } },
    nodemailer: {
      createTransport(options) {
        const native = nodemailer.createTransport(options);
        const send = native.sendMail.bind(native);
        native.sendMail = (...args) => {
          const promise = send(...args);
          // The predecessor drops this promise. Observe its failure without an unhandled-rejection side effect.
          promise.catch(() => {});
          state.nativePromise = promise;
          return promise;
        };
        return native;
      },
    },
  };
  const compiled = ts.transpileModule(
    fs.readFileSync(path.join(root, "packages/features/auth/lib/sendVerificationRequest.ts"), "utf8"),
    {
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }
  );
  assert.deepEqual(compiled.diagnostics, []);
  const module = { exports: {} };
  new Function("require", "module", "exports", "process", compiled.outputText)(
    (name) => {
      assert.ok(Object.hasOwn(imports, name), `Unexpected verification-mail import ${name}`);
      return imports[name];
    },
    module,
    module.exports,
    {
      cwd: () => path.join(root, "apps/web"),
      env: {
        NEXTAUTH_URL: "https://cal.mereka.dev/api/auth",
        EMAIL_FROM: "verification@example.invalid",
      },
    }
  );
  state.send = module.exports.default;
  return state;
}

const request = {
  identifier: "staff@example.invalid",
  url: "https://previous.example.invalid/auth/verify?request=fixture",
};

test("verification waits for the installed mailer's submission outcome", async () => {
  const f = fixture();
  let settled = false;
  const submission = f.send(request);
  const observed = submission.then(
    () => {
      settled = true;
      return { submitted: true };
    },
    (error) => {
      settled = true;
      return { error };
    }
  );
  await f.started;
  await new Promise((resolve) => setImmediate(resolve));
  try {
    assert.equal(settled, false, "authentication must not finish while mail submission is pending");
    assert.equal(f.message.data.to, request.identifier);
    assert.equal(f.message.data.from, "verification@example.invalid");
    assert.ok(
      f.message.data.html.includes(
        require("handlebars").escapeExpression("https://cal.mereka.dev/auth/verify?request=fixture")
      ),
      "verification template must contain the HTML-escaped canonical URL"
    );
    assert.ok(!f.message.data.html.includes("previous.example.invalid"));
  } finally {
    f.complete(null, { accepted: [request.identifier], rejected: [] });
    await f.nativePromise;
    assert.equal((await observed).submitted, true);
  }
  assert.equal(settled, true);
});

test("verification rejects when the installed mailer rejects submission", async () => {
  const f = fixture();
  const failure = new Error("controlled delivery rejection");
  const submission = f.send(request);
  const outcome = submission.then(
    () => ({ submitted: true }),
    (error) => ({ error })
  );
  await f.started;
  f.complete(failure);
  const result = await outcome;
  assert.equal(result.error, failure);
});

test("an invalid verification URL fails before any mail submission", async () => {
  const f = fixture();
  await assert.rejects(f.send({ ...request, url: "not a URL" }), TypeError);
  assert.equal(f.message, null);
  assert.equal(f.nativePromise, null);
});
