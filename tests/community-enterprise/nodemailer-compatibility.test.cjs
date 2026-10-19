// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const process = require("node:process");
const { createRequire } = require("node:module");
const { execFileSync, spawnSync } = require("node:child_process");
const { test } = require("node:test");
const nodemailer = require("nodemailer");
const ts = require("typescript");
const { startSmtpTestSink } = require("./smtp-test-sink.cjs");
const root = path.resolve(__dirname, "../..");
const origin = "https://cal.mereka.dev";

function load(file, imports, environment = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  });
  assert.deepEqual(compiled.diagnostics, []);
  const module = { exports: {} };
  new Function("require", "module", "exports", "process", "console", compiled.outputText)(
    (name) => {
      assert.ok(Object.hasOwn(imports, name), `Unexpected mail import ${name}`);
      return imports[name];
    },
    module,
    module.exports,
    { cwd: () => path.join(root, "apps/web"), env: environment },
    { warn() {}, log() {}, error() {} }
  );
  return module.exports;
}

function transportFor(sink, form) {
  const port = Number(sink.environment.EMAIL_SERVER_PORT);
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
  assert.equal(sink.environment.EMAIL_SERVER_HOST, "127.0.0.1");
  if (form === "url")
    return `smtp://127.0.0.1:${port}/?connectionTimeout=3000&greetingTimeout=3000&socketTimeout=3000`;
  return {
    host: "127.0.0.1",
    port,
    secure: false,
    connectionTimeout: 3000,
    greetingTimeout: 3000,
    socketTimeout: 3000,
  };
}

function verificationSender(transport) {
  return load(
    "packages/features/auth/lib/sendVerificationRequest.ts",
    {
      "node:fs": fs,
      "node:path": path,
      handlebars: require("handlebars"),
      "@calcom/lib/constants": { APP_NAME: "Mereka", WEBAPP_URL: origin },
      "@calcom/lib/serverConfig": { serverConfig: { transport } },
      nodemailer,
    },
    { NEXTAUTH_URL: origin, EMAIL_FROM: "notifications@example.test" }
  ).default;
}

function baseSender(transport) {
  const { default: BaseEmail } = load("packages/emails/templates/_base-email.ts", {
    "node:process": { env: {} },
    entities: require("entities"),
    zod: require("zod"),
    "@calcom/dayjs": {},
    "@calcom/features/flags/features.repository": {
      FeaturesRepository: class {
        async checkIfFeatureIsEnabledGlobally() {
          return false;
        }
      },
    },
    "@calcom/lib/isSmsCalEmail": () => false,
    "@calcom/lib/serverConfig": { serverConfig: { transport, headers: {} } },
    "@calcom/lib/server/getServerErrorFromUnknown": { getServerErrorFromUnknown: (error) => error },
    "@calcom/lib/testEmails": { setTestEmail() {} },
    "@calcom/prisma": { prisma: {} },
    "../lib/sanitizeDisplayName": { sanitizeDisplayName: (value) => value },
    nodemailer,
  });
  return new (class extends BaseEmail {
    async getNodeMailerPayload() {
      return {
        from: "Mereka Fixture <notifications@example.test>",
        to: "invitee@example.test",
        subject: "Fixture &amp; calendar",
        html: "Synthetic invitation",
        icalEvent: {
          method: "REQUEST",
          content:
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Mereka//Fixture//EN\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:mail-fixture@example.test\r\nDTSTAMP:20261019T000000Z\r\nDTSTART:20261020T000000Z\r\nDTEND:20261020T003000Z\r\nSUMMARY:Synthetic invitation\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
        },
      };
    }
  })();
}

test("the pinned native package supports CJS, ESM and its bundled declaration paths", async () => {
  const metadata = require("nodemailer/package.json");
  assert.equal(metadata.version, "10.1.7");
  assert.equal(metadata.engines.node, ">=20.0.0");
  assert.ok(Number(process.versions.node.split(".")[0]) >= 20);
  assert.equal(typeof nodemailer.createTransport, "function");
  for (const entry of [
    path.join(root, "apps/web/package.json"),
    path.join(root, "packages/features/auth/package.json"),
    require.resolve("next-auth/providers/email"),
  ])
    assert.equal(createRequire(entry)("nodemailer/package.json").version, metadata.version);
  const esm = await import("nodemailer");
  assert.equal(typeof esm.default.createTransport, "function");
  assert.equal(typeof esm.createTransport, "function");
  for (const name of [
    "nodemailer",
    "nodemailer/lib/sendmail-transport",
    "nodemailer/lib/smtp-connection",
    "nodemailer/lib/smtp-transport/index.js",
  ]) {
    const result = ts.resolveModuleName(
      name,
      path.join(root, "packages/features/auth/lib/sendVerificationRequest.ts"),
      { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext },
      ts.sys
    );
    assert.match(result.resolvedModule?.resolvedFileName ?? "", /nodemailer\/dist\/(?:cjs|esm)\/.*\.d\.ts$/);
  }
  assert.throws(() => require.resolve("@types/nodemailer/package.json"), { code: "MODULE_NOT_FOUND" });
  const peer = JSON.parse(
    fs.readFileSync(path.join(path.dirname(require.resolve("next-auth")), "package.json"), "utf8")
  );
  assert.equal(peer.version, "4.24.15");
  assert.equal(peer.peerDependencies.nodemailer, "^7.0.7");
  assert.equal(peer.peerDependenciesMeta.nodemailer.optional, true);
});

test(
  "installed NextAuth email declarations support the native bundled types without skipLibCheck",
  { timeout: 30000 },
  () => {
    const filename = path.join(root, "packages/features/tsconfig.json");
    const config = ts.readConfigFile(filename, ts.sys.readFile);
    assert.equal(config.error, undefined);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(filename));
    assert.deepEqual(parsed.errors, []);
    const provider = path.join(path.dirname(require.resolve("next-auth")), "providers/email.d.ts");
    const files = [
      "packages/features/auth/lib/sendVerificationRequest.ts",
      "packages/emails/templates/_base-email.ts",
      "packages/lib/serverConfig.ts",
      "packages/types/window.d.ts",
      "packages/types/business-days-plugin.d.ts",
    ].map((file) => path.join(root, file));
    const program = ts.createProgram([...files, provider], {
      ...parsed.options,
      noEmit: true,
      incremental: false,
      skipLibCheck: false,
    });
    const source = program.getSourceFile(provider);
    assert.ok(source);
    const diagnostics = program.getSemanticDiagnostics(source).map((diagnostic) => ({
      code: diagnostic.code,
      line: source.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    }));
    assert.deepEqual(diagnostics, []);
  }
);

for (const form of ["object", "url"]) {
  test(
    `actual verification sender submits and rejects through native SMTP ${form}`,
    { timeout: 15000 },
    async () => {
      const sink = await startSmtpTestSink();
      try {
        const send = verificationSender(transportFor(sink, form));
        const request = {
          identifier: "smoke@example.test",
          url: `${origin}/auth/verify?request=synthetic`,
        };
        await send(request);
        assert.equal(sink.count(), 1);
        assert.deepEqual(sink.summariesSince(0)[0].recipients, [request.identifier]);
        sink.setRejecting(true);
        await assert.rejects(
          send(request),
          (error) => error.code === "EENVELOPE" && error.responseCode === 550
        );
        assert.equal(sink.count(), 1);
      } finally {
        await sink.close();
      }
    }
  );
}

test(
  "actual BaseEmail preserves calendar MIME, strict rejection and legacy behavior",
  { timeout: 15000 },
  async () => {
    const sink = await startSmtpTestSink();
    try {
      const mail = baseSender(transportFor(sink, "object"));
      assert.equal(await mail.sendEmail({ throwOnError: true }), "send mail async");
      const [message] = sink.summariesSince(0);
      assert.equal(message.subject, "Fixture & calendar");
      assert.equal(message.hasCalendarMime, true);
      assert.deepEqual(message.recipients, ["invitee@example.test"]);
      sink.setRejecting(true);
      await assert.rejects(mail.sendEmail({ throwOnError: true }), (error) => error.code === "EENVELOPE");
      assert.equal(await mail.sendEmail(), "send mail async");
      assert.equal(sink.count(), 1);
    } finally {
      await sink.close();
    }
  }
);

test(
  "installed NextAuth default and Cal custom senders qualify the explicit peer mismatch",
  { timeout: 15000 },
  async () => {
    const sink = await startSmtpTestSink();
    try {
      const imported = require("next-auth/providers/email");
      const EmailProvider = imported.default ?? imported;
      const server = transportFor(sink, "object");
      const provider = { ...EmailProvider({}), server, from: "notifications@example.test" };
      const params = {
        identifier: "smoke@example.test",
        url: `${origin}/api/auth/callback/email?token=synthetic`,
        token: "synthetic-only",
        expires: new Date("2030-01-01T00:00:00Z"),
        provider,
        theme: {},
      };
      await provider.sendVerificationRequest(params);
      const custom = EmailProvider({ sendVerificationRequest: verificationSender(server) });
      await custom.options.sendVerificationRequest(params);
      assert.equal(sink.count(), 2);
      sink.setRejecting(true);
      await assert.rejects(provider.sendVerificationRequest(params), (error) => error.code === "EENVELOPE");
      await assert.rejects(
        custom.options.sendVerificationRequest(params),
        (error) => error.code === "EENVELOPE"
      );
      assert.equal(sink.count(), 2);
    } finally {
      await sink.close();
    }
  }
);

test("native raw content respects file and URL restrictions without outbound access", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cal-mail-guard-"));
  const file = path.join(directory, "owned-sentinel.txt");
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const originalHttp = http.request;
  const originalHttps = https.request;
  let attempts = 0;
  const refuse = () => {
    attempts++;
    throw new Error("Outbound HTTP forbidden by mail fixture");
  };
  try {
    fs.writeFileSync(file, "owned synthetic sentinel", { mode: 0o600 });
    http.request = refuse;
    https.request = refuse;
    const message = { from: "notifications@example.test", to: "smoke@example.test" };
    await assert.rejects(
      transport.sendMail({ ...message, raw: { path: file } }),
      (error) => error.code === "EFILEACCESS"
    );
    await assert.rejects(
      transport.sendMail({ ...message, raw: { href: "http://blocked.example.invalid/fixture" } }),
      (error) => error.code === "EURLACCESS"
    );
    assert.equal(attempts, 0);
  } finally {
    http.request = originalHttp;
    https.request = originalHttps;
    transport.close();
    fs.rmSync(directory, { recursive: true });
  }
});

test(
  "native HTTPS content rejects an untrusted local certificate before application data",
  { timeout: 15000 },
  async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cal-mail-tls-"));
    const key = path.join(directory, "fixture.key");
    const cert = path.join(directory, "fixture.crt");
    let server;
    try {
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-days",
          "1",
          "-keyout",
          key,
          "-out",
          cert,
          "-subj",
          "/CN=127.0.0.1",
          "-addext",
          "subjectAltName=IP:127.0.0.1",
        ],
        { stdio: "ignore", timeout: 5000 }
      );
      fs.chmodSync(key, 0o600);
      let requests = 0;
      let holdOpen = false;
      server = https.createServer(
        { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
        (_request, response) => {
          requests++;
          if (holdOpen) response.write("synthetic");
          else response.end("synthetic");
        }
      );
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const imported = require("nodemailer/lib/fetch");
      const fetch = imported.default ?? imported;
      const url = `https://127.0.0.1:${server.address().port}/fixture`;
      const originalRequest = https.request;
      let tlsCode;
      https.request = (...args) => {
        const request = originalRequest(...args);
        // The native fetcher normalizes this error to EFETCH after the TLS failure.
        request.once("error", (error) => {
          tlsCode = error.code;
        });
        return request;
      };
      const consume = (options) =>
        new Promise((resolve, reject) => {
          const stream = fetch(url, options);
          const timer = setTimeout(() => {
            const error = new Error("Synthetic mail fetch timeout");
            error.code = "MAIL_FIXTURE_TIMEOUT";
            stream.destroy(error);
          }, 3000);
          stream.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
          stream.on("end", () => {
            clearTimeout(timer);
            resolve();
          });
          stream.resume();
        });
      try {
        await assert.rejects(consume(), (error) => error.code === "EFETCH");
        assert.ok(["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN"].includes(tlsCode));
        assert.equal(requests, 0);
        await consume({ tls: { ca: fs.readFileSync(cert) } });
        assert.equal(requests, 1);
        holdOpen = true;
        await assert.rejects(
          consume({ tls: { ca: fs.readFileSync(cert) } }),
          (error) => error.code === "MAIL_FIXTURE_TIMEOUT"
        );
        assert.equal(requests, 2);
      } finally {
        https.request = originalRequest;
      }
    } finally {
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      fs.rmSync(directory, { recursive: true });
    }
  }
);

test("native parser handles bounded flat-list and fallback shapes within a child deadline", () => {
  const script = `const assert=require('node:assert/strict'); const m=require('nodemailer/lib/addressparser'); const parse=m.default??m; assert.equal(parse(Array.from({length:2000},(_,i)=>'fixture'+i+'@example.test').join(',')).length,2000); assert.ok(parse('[x]'.repeat(10000)).every(item=>!item.address));`;
  const result = spawnSync(process.execPath, ["--max-old-space-size=128", "-e", script], {
    cwd: root,
    env: { PATH: process.env.PATH },
    timeout: 5000,
    maxBuffer: 4096,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr.toString());
});
