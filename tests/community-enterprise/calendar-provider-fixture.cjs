// SPDX-License-Identifier: MIT
// Shared source-level provider fixture. Only auth/rendering and network boundaries are controlled.
const assert = require("node:assert/strict");

const fs = require("node:fs");

const path = require("node:path");

const ts = require("typescript");

const { setupServer } = require("msw/node");

const { http, HttpResponse } = require("msw");

const { calendar } = require("@googleapis/calendar");

const root = path.resolve(__dirname, "../..");

const dayjs = require("dayjs");
dayjs.extend(require("dayjs/plugin/utc"));
dayjs.extend(require("dayjs/plugin/timezone"));

const messages = [];
const log = {
  debug(...args) {
    messages.push(args);
  },
  warn(...args) {
    messages.push(args);
  },
  error(...args) {
    messages.push(args);
  },
  silly(...args) {
    messages.push(args);
  },
  info(...args) {
    messages.push(args);
  },
  getSubLogger() {
    return this;
  },
};

function load(file, imports) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  assert.deepEqual(output.diagnostics, []);
  const module = { exports: {} };
  new Function("require", "module", "exports", output.outputText)(
    (name) => {
      assert.ok(Object.hasOwn(imports, name), `Unspecified source import: ${name}`);
      return imports[name];
    },
    module,
    module.exports
  );
  return module.exports;
}

const calls = [];

let status = 200,
  body = { id: "stored-event", iCalUID: "stable-ical" };

const wire = setupServer(
  http.all(/https:\/\/(www.googleapis.com|graph.microsoft.com)\//, async ({ request }) => {
    calls.push({
      method: request.method,
      url: new URL(request.url),
      body: request.method === "DELETE" || request.method === "GET" ? null : await request.json(),
    });
    if (status === 204) return new HttpResponse(null, { status });
    return HttpResponse.json(
      status >= 400 ? { error: { code: status, message: "Synthetic provider refusal" } } : body,
      { status }
    );
  })
);

const credential = (type = "google_calendar") => ({
  id: 7,
  type,
  userId: 11,
  user: { email: "staff@example.test" },
  key: {},
  appId: type,
  invalid: false,
  delegatedTo: null,
  delegationCredentialId: null,
});

const event = () => ({
  uid: "application-booking",
  type: "advice",
  title: "Synthetic appointment",
  calendarDescription: "Fixture",
  startTime: "2030-01-01T10:00:00Z",
  endTime: "2030-01-01T10:30:00Z",
  organizer: {
    id: 11,
    email: "staff@example.test",
    name: "Staff",
    timeZone: "UTC",
    language: { translate: (x) => x, locale: "en" },
  },
  attendees: [{ name: "Guest", email: "guest@example.test", timeZone: "UTC" }],
  location: "Shared room",
  destinationCalendar: [
    { credentialId: 7, externalId: "new-default", userId: 11, integration: "google_calendar" },
  ],
});

const google = load("packages/app-store/googlecalendar/lib/CalendarService.ts", {
  "@calcom/app-store/constants": { MeetLocationType: "integrations:google:meet" },
  "@calcom/features/di/containers/DestinationCalendar": {
    getDestinationCalendarRepository: () => ({ getCustomReminderByCredentialId: async () => null }),
  },
  "@calcom/features/selectedCalendar/repositories/SelectedCalendarRepository": {},
  "@calcom/lib/CalEventParser": { getLocation: () => "Shared room", getRichDescription: () => "Fixture" },
  "@calcom/lib/constants": { ORGANIZER_EMAIL_EXEMPT_DOMAINS: "" },
  "@calcom/lib/logger": log,
  "@calcom/lib/safeStringify": { safeStringify: JSON.stringify },
  rrule: require("rrule"),
  "../../_utils/oauth/AxiosLikeResponseToFetchResponse": {},
  "./CalendarAuth": {
    CalendarAuth: class {
      async getClient() {
        return calendar({ version: "v3", retry: false });
      }
    },
  },
});

const office = load("packages/app-store/office365calendar/lib/CalendarService.ts", {
  "@calcom/app-store/constants": { MSTeamsLocationType: "integrations:msteams" },
  "@calcom/dayjs": dayjs,
  "@calcom/features/webhooks/lib/triggerDelegationCredentialErrorWebhook": {
    triggerDelegationCredentialErrorWebhook: () => {
      throw new Error("Unexpected delegation");
    },
  },
  "@calcom/lib/CalEventParser": { getLocation: () => "Shared room", getRichDescriptionHTML: () => "Fixture" },
  "@calcom/lib/CalendarAppError": {
    CalendarAppDelegationCredentialConfigurationError: Error,
    CalendarAppDelegationCredentialInvalidGrantError: Error,
  },
  "@calcom/lib/errors": {
    handleErrorsJson: async (r) => {
      if (!r.ok) throw new Error(`Provider ${r.status}`);
      return r.json();
    },
    handleErrorsRaw: (r) => {
      if (!r.ok) throw new Error(`Provider ${r.status}`);
      return r.text();
    },
  },
  "@calcom/lib/logger": log,
  "windows-iana": { findIana: () => ["UTC"] },
  "../../_utils/oauth/getTokenObjectFromCredential": {
    getTokenObjectFromCredential: () => ({ access_token: "synthetic-not-live" }),
  },
  "../../_utils/oauth/OAuthManager": {
    OAuthManager: class {
      async requestRaw({ url, options }) {
        return fetch(url, options);
      }
    },
  },
  "../../_utils/oauth/oAuthManagerHelper": { oAuthManagerHelper: {} },
  "../_metadata": { slug: "office365-calendar" },
  "./getOfficeAppKeys": {},
});

let selectedAdapter = null;

let adapterLookups = 0;

const manager = load("packages/features/calendars/lib/CalendarManager.ts", {
  "@calcom/app-store/_utils/getCalendar": {
    getCalendar: async (credential) => {
      adapterLookups++;
      return typeof selectedAdapter === "function" ? selectedAdapter(credential) : selectedAdapter;
    },
  },
  "@calcom/app-store/locations": { MeetLocationType: "integrations:google:meet" },
  "@calcom/app-store/utils": () => [],
  "@calcom/dayjs": dayjs,
  "@calcom/features/calendars/lib/getCalendarsEvents": {
    default: () => {
      throw new Error("Unused availability boundary");
    },
  },
  "@calcom/lib/CalEventParser": { getRichDescription: () => "Fixture", getUid: (uid) => uid },
  "@calcom/lib/CalendarAppError": { CalendarAppDelegationCredentialError: Error },
  "@calcom/lib/constants": { ORGANIZER_EMAIL_EXEMPT_DOMAINS: "" },
  "@calcom/lib/delegationCredential": { buildNonDelegationCredentials: (value) => value },
  "@calcom/lib/formatCalendarEvent": { formatCalEvent: (value) => ({ ...value }) },
  "@calcom/lib/logger": log,
  "@calcom/lib/piiFreeData": { getPiiFreeCalendarEvent: () => ({}), getPiiFreeCredential: () => ({}) },
  "@calcom/lib/safeStringify": { safeStringify: JSON.stringify },
  lodash: require("lodash"),
});
module.exports = {
  load,
  root,
  log,
  wire,
  calls,
  credential,
  event,
  google,
  office,
  manager,
  reset() {
    messages.length = 0;
    calls.length = 0;
    status = 200;
    body = { id: "stored-event", iCalUID: "stable-ical" };
    selectedAdapter = null;
    adapterLookups = 0;
  },
  get status() {
    return status;
  },
  set status(value) {
    status = value;
  },
  get body() {
    return body;
  },
  set body(value) {
    body = value;
  },
  get adapter() {
    return selectedAdapter;
  },
  set adapter(value) {
    selectedAdapter = value;
  },
  get adapterLookups() {
    return adapterLookups;
  },
};

module.exports.eventManagerModule = (database) =>
  load("packages/features/bookings/lib/EventManager.ts", {
    "node:process": process,
    lodash: require("lodash"),
    uuid: require("uuid"),
    "@calcom/app-store/_utils/getCalendar": {
      getCalendar: async (credential) =>
        typeof selectedAdapter === "function" ? selectedAdapter(credential) : selectedAdapter,
    },
    "@calcom/app-store/dailyvideo/lib/VideoApiAdapter": { FAKE_DAILY_CREDENTIAL: {} },
    "@calcom/app-store/dailyvideo/zod": {
      appKeysSchema: require("zod").z.object({ api_key: require("zod").z.string() }),
    },
    "@calcom/app-store/locations": {
      getLocationFromApp: () => null,
      MeetLocationType: "integrations:google:meet",
      MSTeamsLocationType: "integrations:msteams",
    },
    "@calcom/app-store/utils": (credentials) =>
      credentials.map((credential) => ({
        type: credential.type,
        name: credential.type,
        credentials: [credential],
      })),
    "@calcom/features/calendars/lib/CalendarManager": manager,
    "@calcom/features/conferencing/lib/videoClient": {
      createMeeting: async () => ({
        success: false,
        type: "fixture_video",
        appName: "fixture",
        uid: "",
        originalEvent: event(),
      }),
      updateMeeting: async () => {
        throw new Error("Unexercised conferencing mutation");
      },
      deleteMeeting: async () => {
        throw new Error("Unexercised conferencing mutation");
      },
    },
    "@calcom/features/credentials/repositories/CredentialRepository": {
      CredentialRepository: {
        findCredentialForCalendarServiceById: ({ id }) =>
          database.credential.findUnique({
            where: { id },
            select: {
              id: true,
              type: true,
              userId: true,
              teamId: true,
              appId: true,
              key: true,
              invalid: true,
              user: { select: { email: true } },
            },
          }),
      },
    },
    "@calcom/features/crmManager/crmManager": class {
      constructor() {
        throw new Error("Unexercised CRM boundary");
      }
    },
    "@calcom/features/crmManager/crmScheduler": {},
    "@calcom/features/flags/features.repository": {
      FeaturesRepository: class {
        async checkIfTeamHasFeature() {
          return false;
        }
      },
    },
    "@calcom/lib/CalEventParser": { getUid: (uid) => uid },
    "@calcom/lib/crypto": {
      symmetricDecrypt: () => {
        throw new Error("Unexercised credential decryption");
      },
    },
    "@calcom/lib/delegationCredential": { isDelegationCredential: ({ credentialId }) => credentialId < 0 },
    "@calcom/lib/logger": log,
    "@calcom/lib/piiFreeData": {
      getPiiFreeDestinationCalendar: () => ({}),
      getPiiFreeUser: () => ({}),
      getPiiFreeCredential: () => ({}),
      getPiiFreeCalendarEvent: () => ({}),
    },
    "@calcom/lib/safeStringify": { safeStringify: JSON.stringify },
    "@calcom/prisma": { prisma: database },
    "@calcom/prisma/zod-utils": {
      createdEventSchema: require("zod").z.object({
        id: require("zod").z.string(),
        password: require("zod").z.string().optional(),
        onlineMeetingUrl: require("zod").z.string().optional(),
      }),
    },
  });

module.exports.eventManager = (database) => module.exports.eventManagerModule(database).default;

module.exports.messages = messages;
