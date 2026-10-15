// SPDX-License-Identifier: MIT
// Native compiled main/AppModule; no service or framework substitutions.
// Docker supplies only the existing local Node runtime and isolated Redis.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { randomBytes, randomUUID, createHash } = require("node:crypto");
const { encode } = require("next-auth/jwt");
const { test } = require("node:test");
const { Pool } = require("pg");
const root = path.resolve(__dirname, "../..");
const run = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 45000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const output = path.join(root, "test-results/community-enterprise/api-assembled");

test(
  "full compiled API starts against the same isolated schema and Redis",
  { timeout: 160000 },
  async (t) => {
    const socket = process.env.CAL_ENTERPRISE_TEST_SOCKET;
    const directory = process.env.CAL_ENTERPRISE_TEST_PGDATA;
    assert.ok(socket && directory, "Use the isolated DB runner, never deployed database settings");
    assert.equal(path.dirname(socket), path.dirname(directory));
    assert.match(path.basename(path.dirname(socket)), /^cal-enterprise-/);
    fs.mkdirSync(output, { recursive: true });
    const runtimeImage = process.env.CAL_ENTERPRISE_API_NODE_IMAGE;
    const redisImage = process.env.CAL_ENTERPRISE_API_REDIS_IMAGE;
    for (const image of [runtimeImage, redisImage]) {
      assert.match(
        image || "",
        /^sha256:[a-f0-9]{64}$/,
        "Explicit locally approved runtime image IDs are required"
      );
      assert.equal(run(["image", "inspect", image, "--format", "{{.Id}}"]), image);
    }

    const pool = new Pool({
      host: socket,
      port: 55439,
      database: "postgres",
      user: "cal_enterprise_test",
      max: 2,
    });
    const id = (
      await pool.query("SELECT current_setting('data_directory') AS directory,current_user AS actor")
    ).rows[0];
    assert.equal(id.directory, directory);
    assert.equal(id.actor, "cal_enterprise_test");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n, 0);
    const name = `cal-api-assembled-${process.pid}-${randomBytes(4).toString("hex")}`;
    let network = false,
      redis = false,
      app = false;
    const config = path.join(path.dirname(socket), "api.env");
    const url = "postgresql://cal_enterprise_test@localhost:55439/postgres?host=/pgsocket";
    const environment = {
      NODE_ENV: "production",
      NODE_OPTIONS: "--max-old-space-size=4096",
      LOG_LEVEL: "warn",
      API_PORT: "5555",
      API_URL: "http://127.0.0.1",
      WEB_APP_URL: "https://calendar.example.test",
      NEXT_PUBLIC_WEBAPP_URL: "https://calendar.example.test",
      NEXTAUTH_URL: "https://calendar.example.test/api/auth",
      DATABASE_URL: url,
      DATABASE_DIRECT_URL: url,
      DATABASE_READ_URL: url,
      DATABASE_WRITE_URL: url,
      DATABASE_READ_POOL_MAX: "2",
      DATABASE_WRITE_POOL_MAX: "2",
      PG_MAX_CONNECTIONS: "2",
      REDIS_URL: `redis://${name}-redis:6379`,
      ENABLE_SLOTS_WORKERS: "false",
      ENABLE_ASYNC_TASKER: "false",
      NEXTAUTH_SECRET: randomBytes(32).toString("hex"),
      JWT_SECRET: randomBytes(32).toString("hex"),
      CALENDSO_ENCRYPTION_KEY: randomBytes(16).toString("hex"),
      STRIPE_API_KEY: "synthetic-test-only",
      STRIPE_WEBHOOK_SECRET: "synthetic-test-only",
      IS_TEAM_BILLING_ENABLED: "false",
      CAL_AUTHENTIK_ENABLED: "true",
      CAL_AUTHENTIK_ONLY: "true",
      CAL_AUTHENTIK_ISSUER: "https://identity.example.test/application/o/calendar",
      CAL_AUTHENTIK_CLIENT_ID: "synthetic-client",
      CAL_AUTHENTIK_CLIENT_SECRET: randomBytes(32).toString("hex"),
    };
    fs.writeFileSync(
      config,
      Object.entries(environment)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") + "\n",
      { mode: 0o600, flag: "wx" }
    );
    try {
      run(["network", "create", "--internal", name]);
      network = true;
      run([
        "run",
        "--pull=never",
        "-d",
        "--name",
        name + "-redis",
        "--network",
        name,
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--user",
        "1000:1000",
        "--tmpfs",
        "/data:rw,nosuid,noexec,size=32m,uid=1000,gid=1000",
        "--memory=128m",
        "--cpus=0.25",
        redisImage,
        "redis-server",
        "--save",
        "",
        "--appendonly",
        "no",
      ]);
      redis = true;
      run([
        "run",
        "--pull=never",
        "-d",
        "--name",
        name + "-app",
        "--network",
        name,
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--user",
        "1000:1000",
        "--memory=6g",
        "--cpus=2",
        "--init",
        "--tmpfs",
        "/tmp:rw,nosuid,size=256m,uid=1000,gid=1000",
        "--mount",
        `type=bind,src=${root},dst=${root},readonly`,
        "--mount",
        `type=bind,src=${socket},dst=/pgsocket`,
        "--env-file",
        config,
        "-w",
        path.join(root, "apps/api/v2"),
        "--entrypoint",
        "/usr/local/bin/node",
        runtimeImage,
        "dist/apps/api/v2/src/main.js",
      ]);
      app = true;
      // Native requests execute inside the isolated application container. No
      // host port or outbound network access is required by this acceptance test.
      const request = (route, options = {}) => {
        const code =
          "const fs=require('node:fs');const o=JSON.parse(fs.readFileSync(0,'utf8'));fetch('http://127.0.0.1:5555'+o.route,{...o.options,signal:AbortSignal.timeout(5000)}).then(async r=>console.log(JSON.stringify({status:r.status,body:await r.text(),cache:r.headers.get('cache-control')}))).catch(()=>process.exit(2))";
        const result = spawnSync("docker", ["exec", "-i", name + "-app", "/usr/local/bin/node", "-e", code], {
          input: JSON.stringify({ route, options }),
          encoding: "utf8",
          timeout: 8000,
        });
        return result.status === 0 ? JSON.parse(result.stdout) : null;
      };
      const deadline = Date.now() + 95000;
      let response;
      while (Date.now() < deadline) {
        if (run(["inspect", name + "-app", "--format", "{{.State.Running}}"]) !== "true") break;
        try {
          response = request("/health");
          if (response?.status === 200) break;
        } catch {
          /* Startup can still be binding. */
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const logs = run(["logs", name + "-app"]);
      fs.writeFileSync(path.join(output, "startup.log"), logs, { mode: 0o600 });
      if (response?.status !== 200) t.diagnostic(logs.slice(-12000));
      assert.equal(response?.status, 200, "Native main/AppModule must actually become healthy");
      assert.equal(response.body, "OK");
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n, 0);
      const runtimeVersion = run(["exec", name + "-app", "/usr/local/bin/node", "--version"]);
      assert.match(runtimeVersion, /^v22\./, "This acceptance requires the retained Node 22 runtime");
      const networkState = JSON.parse(run(["network", "inspect", name]));
      assert.equal(networkState[0].Internal, true);
      const containerState = JSON.parse(run(["inspect", name + "-app"]))[0];
      assert.equal(containerState.HostConfig.ReadonlyRootfs, true);
      assert.deepEqual(containerState.HostConfig.PortBindings || {}, {});
      const check = (response, expected) => {
        assert.equal(response?.status, expected);
        return JSON.parse(response.body);
      };
      check(request("/v2/me"), 401);
      const zones = check(request("/v2/timezones"), 200);
      assert.equal(zones.status, "success");
      assert.ok(JSON.stringify(zones.data).includes("Kuala"));
      await pool.query("INSERT INTO users (id,uuid,email,username,name) VALUES (6101,$1,$2,$3,$4)", [
        randomUUID(),
        "api-fixture@example.test",
        "api-fixture",
        "Synthetic API User",
      ]);
      await pool.query('INSERT INTO "Team" (id,name,slug,"isOrganization") VALUES (6200,$1,$2,true)', [
        "Synthetic API Organization",
        "api-fixture-org",
      ]);
      await pool.query(
        'INSERT INTO "Membership" ("userId","teamId",role,accepted) VALUES (6101,6200,$1,true)',
        ["OWNER"]
      );
      const rawKey = randomBytes(16).toString("hex");
      await pool.query(
        'INSERT INTO "ApiKey" (id,"userId","hashedKey",note,"teamId") VALUES ($1,6101,$2,$3,6200)',
        [randomUUID(), createHash("sha256").update(rawKey).digest("hex"), "synthetic-native-api"]
      );
      const key = "cal_" + rawKey;
      const me = check(request("/v2/me", { headers: { Authorization: "Bearer " + key } }), 200);
      assert.equal(me.data.id, 6101);
      assert.equal(me.data.email, "api-fixture@example.test");
      const issuer = environment.CAL_AUTHENTIK_ISSUER;
      const accountId = createHash("sha256")
        .update(JSON.stringify([issuer, "fixture-subject"]))
        .digest("hex");
      await pool.query(
        'INSERT INTO "Account" (id,"userId",type,provider,"providerAccountId") VALUES ($1,6101,$2,$3,$4)',
        ["native-api-fixture-binding", "oauth", "authentik", accountId]
      );
      const jwt = await encode({
        secret: environment.NEXTAUTH_SECRET,
        maxAge: 3600,
        token: {
          sub: "6101",
          email: "api-fixture@example.test",
          role: "ADMIN",
          upId: "usr-6101",
          authentik: { version: 1, issuer, accountId, bindingId: "native-api-fixture-binding", userId: 6101 },
        },
      });
      const cookie = "__Secure-next-auth.session-token=" + jwt;
      assert.equal(check(request("/v2/me", { headers: { Cookie: cookie } }), 200).data.id, 6101);
      check(
        request("/v2/api-keys/refresh", {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: "{}",
        }),
        401
      );
      check(
        request("/v2/api-keys/refresh", {
          method: "POST",
          headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
          body: JSON.stringify({ apiKeyDaysValid: 0 }),
        }),
        400
      );
      const rotated = request("/v2/api-keys/refresh", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: "{}",
      });
      const replacement = check(rotated, 200).data.apiKey;
      assert.equal(rotated.cache, "no-store");
      assert.notEqual(replacement, key);
      assert.equal(
        (
          await pool.query('SELECT count(*)::int AS n FROM "EnterpriseAuditEvent" WHERE action=$1', [
            "api_key.rotated",
          ])
        ).rows[0].n,
        1
      );
      check(request("/v2/me", { headers: { Authorization: "Bearer " + key } }), 401);
      check(request("/v2/me", { headers: { Authorization: "Bearer " + replacement } }), 200);
      await pool.query("UPDATE users SET locked=true WHERE id=6101");
      check(request("/v2/me", { headers: { Authorization: "Bearer " + replacement } }), 401);
      check(request("/v2/me", { headers: { Cookie: cookie } }), 401);
      await pool.query("UPDATE users SET locked=false WHERE id=6101");
      await pool.query('DELETE FROM "Account" WHERE id=$1', ["native-api-fixture-binding"]);
      check(request("/v2/me", { headers: { Cookie: cookie } }), 401);
      await pool.query(
        'INSERT INTO "Account" (id,"userId",type,provider,"providerAccountId") VALUES ($1,6101,$2,$3,$4)',
        ["native-api-replacement-binding", "oauth", "authentik", accountId]
      );
      check(request("/v2/me", { headers: { Cookie: cookie } }), 401);
      assert.ok(
        Number(run(["exec", name + "-redis", "redis-cli", "DBSIZE"])) > 0,
        "Native rate limiter must actually use the isolated Redis"
      );

      t.diagnostic(
        JSON.stringify({
          scope:
            "unmodified compiled AppModule/bootstrap/main; isolated existing Node image and Redis, same synthetic PostgreSQL; no external egress or deployed API image",
          runtimeImage,
          redisImage,
          runtimeVersion,
          fullApiHealthy: true,
          personalProfileRead: true,
          nativeCookieAndKeyChecks: true,
          oldKeyAndRevokedCookieDenied: true,
          primaryMutationAudit: true,
          redisUsed: true,
        })
      );
    } finally {
      if (app) {
        const logs = spawnSync("docker", ["logs", name + "-app"], { encoding: "utf8", timeout: 15000 });
        fs.writeFileSync(path.join(output, "startup-final.log"), logs.stdout + logs.stderr, { mode: 0o600 });
        run(["stop", "--time", "10", name + "-app"]);
        run(["rm", name + "-app"]);
      }
      if (redis) {
        run(["stop", "--time", "5", name + "-redis"]);
        run(["rm", name + "-redis"]);
      }
      if (network) run(["network", "rm", name]);
      await pool.end();
    }
  }
);
