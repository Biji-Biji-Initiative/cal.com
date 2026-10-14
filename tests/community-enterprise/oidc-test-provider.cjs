// SPDX-License-Identifier: MIT
// Test-only OIDC issuer. TLS trust is limited to its isolated application process.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { execFileSync } = require("node:child_process");
const { randomBytes, randomUUID, createHash } = require("node:crypto");
const { generateKeyPair, exportJWK, SignJWT } = require("jose");

async function startOidcTestProvider({
  directory,
  pool,
  identities = [{ userId: 7001, email: "smoke@example.test", subject: "synthetic-staff-subject" }],
}) {
  assert.ok(identities.length > 0 && identities.length <= 4);
  assert.equal(new Set(identities.map((identity) => identity.userId)).size, identities.length);
  assert.equal(new Set(identities.map((identity) => identity.subject)).size, identities.length);
  const certPath = path.join(directory, "oidc-test.crt");
  const keyPath = path.join(directory, "oidc-test.key");
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
      keyPath,
      "-out",
      certPath,
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "ignore", timeout: 30000 }
  );
  fs.chmodSync(keyPath, 0o600);
  const certificate = fs.readFileSync(certPath);
  const keys = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: "synthetic-oidc", use: "sig", alg: "RS256" };
  const clientId = "isolated-smoke-client";
  const clientSecret = randomBytes(24).toString("hex");
  const redirectUri = "http://127.0.0.1:38917/api/auth/callback/authentik";
  let issuer;
  let exchanges = 0;
  const codes = new Map();
  const server = https.createServer(
    { key: fs.readFileSync(keyPath), cert: certificate },
    async (req, res) => {
      res.setHeader("Content-Type", "application/json");
      try {
        const url = new URL(req.url, issuer);
        if (url.pathname.endsWith("/.well-known/openid-configuration")) {
          res.end(
            JSON.stringify({
              issuer: `${issuer}/`,
              authorization_endpoint: `${issuer}/authorize`,
              token_endpoint: `${issuer}/token`,
              jwks_uri: `${issuer}/jwks`,
              response_types_supported: ["code"],
              subject_types_supported: ["public"],
              id_token_signing_alg_values_supported: ["RS256"],
              token_endpoint_auth_methods_supported: ["client_secret_basic"],
              code_challenge_methods_supported: ["S256"],
            })
          );
          return;
        }
        if (url.pathname.endsWith("/jwks")) {
          res.end(JSON.stringify({ keys: [jwk] }));
          return;
        }
        if (url.pathname.endsWith("/authorize")) {
          assert.equal(url.searchParams.get("client_id"), clientId);
          assert.equal(url.searchParams.get("redirect_uri"), redirectUri);
          assert.equal(url.searchParams.get("code_challenge_method"), "S256");
          assert.ok(url.searchParams.get("nonce") && url.searchParams.get("state"));
          const identity = identities.find(
            (item) => item.userId === Number(url.searchParams.get("fixture_user") ?? identities[0].userId)
          );
          assert.ok(identity);
          const code = randomBytes(24).toString("hex");
          codes.set(code, {
            identity,
            challenge: url.searchParams.get("code_challenge"),
            nonce: url.searchParams.get("nonce"),
          });
          const destination = new URL(redirectUri);
          destination.searchParams.set("code", code);
          destination.searchParams.set("state", url.searchParams.get("state"));
          res.writeHead(302, { Location: destination.href });
          res.end();
          return;
        }
        if (url.pathname.endsWith("/token") && req.method === "POST") {
          assert.equal(
            req.headers.authorization,
            `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
          );
          let body = "";
          for await (const chunk of req) {
            body += chunk;
            assert.ok(body.length < 16000);
          }
          const fields = new URLSearchParams(body);
          const code = fields.get("code");
          const grant = codes.get(code);
          assert.ok(grant);
          codes.delete(code);
          assert.equal(fields.get("redirect_uri"), redirectUri);
          assert.equal(
            createHash("sha256")
              .update(fields.get("code_verifier") ?? "")
              .digest("base64url"),
            grant.challenge
          );
          const idToken = await new SignJWT({
            nonce: grant.nonce,
            email: grant.identity.email,
            name: "Synthetic Staff",
          })
            .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
            .setIssuer(`${issuer}/`)
            .setAudience(clientId)
            .setSubject(grant.identity.subject)
            .setIssuedAt()
            .setExpirationTime("2m")
            .sign(keys.privateKey);
          exchanges++;
          res.end(
            JSON.stringify({
              access_token: randomBytes(24).toString("hex"),
              token_type: "Bearer",
              expires_in: 120,
              id_token: idToken,
            })
          );
          return;
        }
        res.writeHead(404);
        res.end("{}");
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "invalid_request" }));
      }
    }
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  issuer = `https://127.0.0.1:${server.address().port}/application/o/calendar`;
  for (const identity of identities) {
    const existing = await pool.query("SELECT email FROM users WHERE id=$1", [identity.userId]);
    assert.equal(existing.rows[0]?.email, identity.email);
    const accountId = createHash("sha256")
      .update(JSON.stringify([issuer, identity.subject]))
      .digest("hex");
    await pool.query(
      'INSERT INTO "Account" (id,"userId",type,provider,"providerAccountId") VALUES ($1,$2,$3,$4,$5)',
      [randomUUID(), identity.userId, "oauth", "authentik", accountId]
    );
  }

  return {
    environment: {
      CAL_AUTHENTIK_ISSUER: issuer,
      CAL_AUTHENTIK_CLIENT_ID: clientId,
      CAL_AUTHENTIK_CLIENT_SECRET: clientSecret,
      NODE_EXTRA_CA_CERTS: certPath,
    },
    async authorize(url, userId = identities[0].userId) {
      assert.ok(identities.some((identity) => identity.userId === userId));
      const selected = new URL(url);
      selected.searchParams.set("fixture_user", String(userId));
      assert.equal(new URL(url).origin, new URL(issuer).origin);
      return new Promise((resolve, reject) => {
        https
          .get(selected, { ca: certificate }, (response) => {
            response.resume();
            if (response.statusCode !== 302)
              reject(new Error("Synthetic issuer rejected the authorization request"));
            else resolve(response.headers.location);
          })
          .once("error", reject);
      });
    },
    exchanges: () => exchanges,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
module.exports = { startOidcTestProvider };
