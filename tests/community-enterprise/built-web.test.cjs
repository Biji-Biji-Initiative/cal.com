// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { once } = require("node:events");
const { spawn } = require("node:child_process");
const { randomBytes, randomUUID, createHash } = require("node:crypto");
const { test } = require("node:test");
const { Pool } = require("pg");
const root = path.resolve(__dirname, "../..");
const { seedTeamBrowserFixture, runTeamBrowserJourney } = require("./team-browser-journey.cjs");
const { startOidcTestProvider } = require("./oidc-test-provider.cjs");
const { startSmtpTestSink } = require("./smtp-test-sink.cjs");

test(
  "built web renders native Authentik login without authenticating an anonymous visitor",
  { timeout: 420000 },
  async (t) => {
    const socket = process.env.CAL_ENTERPRISE_TEST_SOCKET;
    const pgdata = process.env.CAL_ENTERPRISE_TEST_PGDATA;
    assert.ok(socket && pgdata, "Use the isolated PostgreSQL test runner; no application database fallback");
    assert.equal(path.dirname(socket), path.dirname(pgdata));
    assert.match(path.basename(path.dirname(socket)), /^cal-enterprise-/);
    const buildId = fs.readFileSync(path.join(root, "apps/web/.next/BUILD_ID"), "utf8").trim();
    for (const directory of [root, path.join(root, "apps/web")]) {
      for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) {
        assert.equal(fs.existsSync(path.join(directory, file)), false, "Refusing deployed environment files");
      }
    }
    const probe = net.createServer();
    await new Promise((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(38917, "127.0.0.1", resolve);
    });
    await new Promise((resolve) => probe.close(resolve));
    const pool = new Pool({
      host: socket,
      port: 55439,
      user: "cal_enterprise_test",
      database: "postgres",
      max: 2,
    });
    let server;
    let oidcProvider;
    let smtpSink;
    let runtimeOutput = "";
    let sensitiveValues = [];
    try {
      const identity = (
        await pool.query("SELECT current_setting('data_directory') AS directory, current_user AS username")
      ).rows[0];
      assert.equal(identity.directory, pgdata);
      assert.equal(identity.username, "cal_enterprise_test");
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM "users"')).rows[0].count, 0);
      await pool.query('INSERT INTO "users" (id, uuid, email, name, username) VALUES ($1, $2, $3, $4, $5)', [
        7001,
        randomUUID(),
        "smoke@example.test",
        "Synthetic Smoke User",
        "synthetic-smoke-user",
      ]);
      const teamFixture =
        process.env.CAL_TEAM_BROWSER_JOURNEY === "true" ? await seedTeamBrowserFixture(pool) : null;
      const environment = Object.fromEntries(
        ["PATH", "HOME", "USER", "LANG"]
          .filter((name) => process.env[name])
          .map((name) => [name, process.env[name]])
      );
      const databaseUrl = `postgresql://cal_enterprise_test@localhost:55439/postgres?host=${encodeURIComponent(socket)}`;
      Object.assign(environment, {
        DATABASE_URL: databaseUrl,
        DATABASE_DIRECT_URL: databaseUrl,
        USE_POOL: "true",
        NEXTAUTH_SECRET: randomBytes(32).toString("hex"),
        CALENDSO_ENCRYPTION_KEY: randomBytes(16).toString("hex"),
        NEXT_PUBLIC_WEBAPP_URL: "http://127.0.0.1:38917",
        NEXTAUTH_URL: "http://127.0.0.1:38917/api/auth",
        CAL_AUTHENTIK_ENABLED: "true",
        CAL_AUTHENTIK_ISSUER: "https://identity.example.test/application/o/calendar",
        CAL_AUTHENTIK_CLIENT_ID: "isolated-smoke-client",
        CAL_AUTHENTIK_CLIENT_SECRET: randomBytes(24).toString("hex"),
        NEXT_TELEMETRY_DISABLED: "1",
        NODE_OPTIONS: "--max-old-space-size=4096",
      });
      if (teamFixture) {
        oidcProvider = await startOidcTestProvider({ directory: path.dirname(socket), pool });
        teamFixture.oidc = oidcProvider;
        Object.assign(environment, oidcProvider.environment);
        smtpSink = await startSmtpTestSink();
        teamFixture.smtp = smtpSink;
        Object.assign(environment, smtpSink.environment);
      }
      sensitiveValues = [
        environment.CAL_AUTHENTIK_CLIENT_SECRET,
        environment.NEXTAUTH_SECRET,
        environment.CALENDSO_ENCRYPTION_KEY,
      ];
      const standalone = path.join(root, "apps/web/.next/standalone/apps/web");
      const packaged = fs.existsSync(path.join(standalone, "server.js"));
      if (packaged) {
        fs.cpSync(path.join(root, "apps/web/public"), path.join(standalone, "public"), { recursive: true });
        fs.cpSync(path.join(root, "apps/web/.next/static"), path.join(standalone, ".next/static"), {
          recursive: true,
        });
      }
      Object.assign(environment, { PORT: "38917", HOSTNAME: "127.0.0.1", NEXT_PUBLIC_LOGGER_LEVEL: "4" });
      server = spawn(
        process.execPath,
        packaged
          ? [path.join(standalone, "server.js")]
          : ["../../node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "38917"],
        {
          cwd: packaged ? standalone : path.join(root, "apps/web"),
          env: environment,
          stdio: ["ignore", "pipe", "pipe"],
          detached: true,
        }
      );
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Owned built server did not become ready")), 60000);
        let text = "";
        const collect = (chunk) => {
          text = (text + chunk.toString()).slice(-8000);
          runtimeOutput = text;
          if (text.includes("Ready in")) {
            clearTimeout(timer);
            resolve();
          }
        };
        server.stdout.on("data", collect);
        server.stderr.on("data", collect);
        server.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        server.once("exit", () => {
          clearTimeout(timer);
          reject(new Error("Owned built server exited during startup"));
        });
      });
      const request = async (route) => {
        assert.equal(server.exitCode, null);
        const started = performance.now();
        const response = await fetch(`http://127.0.0.1:38917${route}`, {
          redirect: "manual",
          signal: AbortSignal.timeout(route === "/api/auth/providers" ? 120000 : 45000),
        });
        console.error("SMOKE_REQUEST", route, response.status, Math.round(performance.now() - started));
        assert.equal(response.status, 200, `Unexpected status for ${route}`);
        return response.text();
      };
      const providers = JSON.parse(await request("/api/auth/providers"));
      assert.equal(providers.authentik.id, "authentik");
      assert.equal(providers.authentik.callbackUrl, "http://127.0.0.1:38917/api/auth/callback/authentik");
      const html = await request("/auth/login");
      assert.match(html, /<button\b[^>]*data-testid="authentik"/);
      assert.ok(!html.includes(environment.CAL_AUTHENTIK_CLIENT_SECRET));
      assert.ok(!html.includes(environment.NEXTAUTH_SECRET));
      assert.ok(!JSON.parse(await request("/api/auth/session")).user);
      assert.equal(typeof JSON.parse(await request("/api/auth/csrf")).csrfToken, "string");
      if (teamFixture) await runTeamBrowserJourney({ pool, fixture: teamFixture, t });
      t.diagnostic(
        JSON.stringify({
          buildId,
          checks: 4,
          scope: "localhost built web plus synthetic PostgreSQL; no live IdP",
          manifestSha256: createHash("sha256")
            .update(fs.readFileSync(path.join(root, "apps/web/.next/build-manifest.json")))
            .digest("hex"),
        })
      );
    } catch (error) {
      for (const value of sensitiveValues)
        if (value) runtimeOutput = runtimeOutput.split(value).join("[fixture-secret-redacted]");
      console.error("BUILT_RUNTIME_FAILURE", runtimeOutput.slice(-5000));
      throw error;
    } finally {
      if (server?.pid && server.exitCode === null) {
        const exited = once(server, "exit");
        process.kill(-server.pid, "SIGTERM");
        const timer = setTimeout(() => {
          if (server.exitCode === null) process.kill(-server.pid, "SIGKILL");
        }, 15000);
        try {
          await exited;
        } finally {
          clearTimeout(timer);
        }
      }
      if (smtpSink) await smtpSink.close();
      if (oidcProvider) await oidcProvider.close();
      await pool.end();
    }
  }
);
