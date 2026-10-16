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

function noticePayloadSource() {
  return load("packages/features/community-enterprise/organizations/InvitationNoticeOutbox.ts", {
    "node:crypto": require("node:crypto"),
    zod: require("zod"),
  });
}
const noticePayload = () => ({
  version: 1,
  actor: { id: 1, uuid: require("node:crypto").randomUUID() },
  organizationId: 100,
  invitationId: 7,
  requestId: require("node:crypto").randomUUID(),
});
test("actual outbox schema accepts only the versioned identity-reference payload", () => {
  const { invitationNoticePayload } = noticePayloadSource();
  const input = noticePayload();
  assert.deepEqual(invitationNoticePayload.parse(input), input);
  for (const extra of [
    { email: "forged@example.test" },
    { token: "forged" },
    { role: "ADMIN" },
    { subscriberUrl: "https://example.test/" },
  ])
    assert.throws(() => invitationNoticePayload.parse({ ...input, ...extra }));
});
test("malformed actor and resource references never become notification targets", () => {
  const { invitationNoticePayload } = noticePayloadSource();
  for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
    assert.throws(() => invitationNoticePayload.parse({ ...noticePayload(), organizationId: invalid }));
    assert.throws(() => invitationNoticePayload.parse({ ...noticePayload(), invitationId: invalid }));
  }
  assert.throws(() => invitationNoticePayload.parse({ ...noticePayload(), actor: { id: 1 } }));
  assert.throws(() => invitationNoticePayload.parse({ ...noticePayload(), version: 2 }));
});
test("outbox reference delimiters separate invitation IDs and duplicate operation identity", () => {
  const { invitationNoticeReference, invitationNoticePrefix } = noticePayloadSource();
  const input = noticePayload();
  assert.equal(invitationNoticeReference(input), invitationNoticeReference({ ...input }));
  assert.ok(!invitationNoticeReference({ ...input, invitationId: 70 }).startsWith(invitationNoticePrefix(7)));
  assert.notEqual(
    invitationNoticeReference(input),
    invitationNoticeReference({ ...input, requestId: require("node:crypto").randomUUID() })
  );
});
test("notice copy distinguishes queued, submitted, suppressed and uncertain external outcomes", () => {
  const words = JSON.parse(fs.readFileSync(path.join(root, "packages/i18n/locales/en/common.json"), "utf8"));
  assert.match(words.enterprise_invite_mail_queued, /queued.*not yet been confirmed/);
  assert.match(
    words.enterprise_invite_mail_submitted,
    /submitted to the mail server.*final inbox delivery is not yet confirmed/
  );
  assert.match(words.enterprise_invite_mail_failed, /was not submitted/);
  assert.match(words.enterprise_invite_mail_unknown, /Reconcile the previous attempt/);
});
