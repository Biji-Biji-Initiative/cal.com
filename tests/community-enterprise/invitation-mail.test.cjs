// SPDX-License-Identifier: MIT
// Execute the retained mail base and new adapter with an explicit SMTP double.
// The native browser/SMTP fixture is separate, not simulated by this suite.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");
function load(file, imports) {
  const result = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const module = { exports: {} };
  new Function("require", "module", "exports", "process", "console", result.outputText)(
    (name) => {
      assert.ok(Object.hasOwn(imports, name), `Unexpected import ${name}`);
      return imports[name];
    },
    module,
    module.exports,
    { env: {} },
    { warn() {}, log() {}, error() {} }
  );
  return module.exports;
}
function sender() {
  const f = { attempts: [], reject: false, disabled: false };
  const { default: Base } = load("packages/emails/templates/_base-email.ts", {
    "node:process": { env: {} },
    entities: require("entities"),
    zod: require("zod"),
    "@calcom/dayjs": {},
    "@calcom/features/flags/features.repository": {
      FeaturesRepository: class {
        async checkIfFeatureIsEnabledGlobally() {
          return f.disabled;
        }
      },
    },
    "@calcom/lib/isSmsCalEmail": () => false,
    "@calcom/lib/serverConfig": {
      serverConfig: { from: "notifications@example.test", transport: {}, headers: {} },
    },
    "@calcom/lib/server/getServerErrorFromUnknown": { getServerErrorFromUnknown: (error) => error },
    "@calcom/lib/testEmails": { setTestEmail() {} },
    "@calcom/prisma": { prisma: {} },
    "../lib/sanitizeDisplayName": { sanitizeDisplayName: (text) => text },
    nodemailer: {
      createTransport: () => ({
        sendMail(payload, done) {
          f.attempts.push(payload);
          done(f.reject ? new Error("synthetic SMTP rejection") : null, { accepted: [payload.to] });
        },
      }),
    },
  });
  class Email extends Base {
    async getNodeMailerPayload() {
      return {
        to: "recipient@example.test",
        from: "Fixture <notifications@example.test>",
        subject: "Invitation &amp; access",
        html: "Synthetic invite",
      };
    }
  }
  f.mail = new Email();
  return f;
}
test("strict delivery path preserves a successful SMTP submission", async () => {
  const f = sender();
  assert.equal(await f.mail.sendEmail({ throwOnError: true }), "send mail async");
  assert.equal(f.attempts.length, 1);
  assert.equal(f.attempts[0].subject, "Invitation & access");
});
test("strict delivery does not convert SMTP failure into success", async () => {
  const f = sender();
  f.reject = true;
  await assert.rejects(f.mail.sendEmail({ throwOnError: true }), /synthetic SMTP rejection/);
  assert.equal(f.attempts.length, 1);
});
test("existing callers keep their historical failure behavior", async () => {
  const f = sender();
  f.reject = true;
  assert.equal(await f.mail.sendEmail(), "send mail async");
  assert.equal(f.attempts.length, 1);
});
test("mail kill switch is not bypassed by strict mode", async () => {
  const f = sender();
  f.disabled = true;
  assert.notEqual(await f.mail.sendEmail({ throwOnError: true }), "send mail async");
  assert.equal(f.attempts.length, 0);
});
for (const result of ["send mail async", "Skipped Sending Email due to active Kill Switch"]) {
  test(`adapter reports actual sender status ${result}`, async () => {
    let event, options;
    const { sendOrganizationInvitationNotice } = load(
      "packages/features/community-enterprise/organizations/sendOrganizationInvitationNotice.ts",
      {
        "@calcom/emails/templates/team-invite-email": class {
          constructor(value) {
            event = value;
          }
          async sendEmail(value) {
            options = value;
            return result;
          }
        },
        "@calcom/i18n/server": { getTranslation: async () => (key) => key },
        "@calcom/lib/constants": { WEBAPP_URL: "https://calendar.example.test" },
      }
    );
    assert.equal(
      await sendOrganizationInvitationNotice({
        invitationId: 17,
        organizationName: "Fixture Org",
        from: "Fixture Admin",
        to: "recipient@example.test",
        locale: "en",
      }),
      result === "send mail async" ? "submitted" : "not_sent"
    );
    assert.deepEqual(options, { throwOnError: true });
    assert.equal(event.isAutoJoin, false);
    assert.equal(event.hideHostedSupport, true);
    assert.equal(event.isExistingUserMovedToOrg, false);
    assert.equal(event.isOrg, true);
    assert.equal(event.joinLink, "https://calendar.example.test/settings/enterprise/teams");
    assert.equal(event.prevLink, null);
    assert.equal(event.newLink, null);
  });
}
