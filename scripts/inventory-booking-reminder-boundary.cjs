// SPDX-License-Identifier: MIT
const fs = require("node:fs");
const path = require("node:path");

const CODE_EXTENSIONS = new Set([".cjs", ".js", ".mjs", ".ts", ".tsx"]);
const SKIP = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", "generated"]);

function walk(dir, root, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute, root, files);
    else if (CODE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push({ absolute, relative: path.relative(root, absolute).split(path.sep).join("/") });
    }
  }
  return files;
}

function isTestFile(relative) {
  return /(?:^|\/)(?:__tests__|tests?)(?:\/|$)|(?:\.test|\.spec)\.[cm]?[jt]sx?$/.test(relative);
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function inventory(root) {
  const routePath = "apps/web/app/api/cron/bookingReminder/route.ts";
  const intervalPath = "apps/web/app/api/cron/bookingReminder/reminderIntervals.ts";
  const schemaPath = "packages/prisma/schema.prisma";
  const migrationPath = "packages/prisma/migrations/20210718184017_reminder_mails/migration.sql";
  const workflowPath = ".github/workflows/cron-bookingReminder.yml";
  const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
  const route = read(routePath);
  const intervals = read(intervalPath);
  const schema = read(schemaPath);
  const migration = read(migrationPath);
  const workflow = read(workflowPath);
  const files = walk(path.join(root, "packages"), root).concat(walk(path.join(root, "apps"), root));
  const productionFiles = files.filter(({ relative }) => !isTestFile(relative));

  const reminderOperationCallsites = productionFiles
    .filter(({ absolute }) => /ReminderMail|reminderMail\./.test(fs.readFileSync(absolute, "utf8")))
    .map(({ relative }) => relative)
    .sort();
  const invalidationCallsites = productionFiles
    .filter(({ absolute }) =>
      /\breminderMail\.(?:delete|deleteMany|update|updateMany)\s*\(/.test(fs.readFileSync(absolute, "utf8"))
    )
    .map(({ relative }) => relative)
    .sort();
  const reminderCreationCallsites = productionFiles
    .filter(({ absolute }) =>
      /\breminderMail\.(?:create|createMany|upsert)\s*\(/.test(fs.readFileSync(absolute, "utf8"))
    )
    .map(({ relative }) => relative)
    .sort();

  const reminderModel = schema.match(/model ReminderMail\s*\{([\s\S]*?)^\}/m)?.[1] ?? "";
  const configuredIntervals = [...intervals.matchAll(/(\d+)\s*\*\s*60/g)].map(
    (match) => Number(match[1]) * 60
  );
  const sendIndex = route.indexOf("await sendOrganizerRequestReminderEmail");
  const markerIndex = route.indexOf("await prisma.reminderMail.create");

  return {
    files: { routePath, intervalPath, schemaPath, migrationPath, workflowPath },
    route: {
      configuredIntervals,
      usesExactElapsedThreshold: /elapsedMinutes:\s*interval/.test(route),
      filtersPendingBookings: /status:\s*BookingStatus\.PENDING/.test(route),
      filtersFutureEvents: /endTime:\s*\{\s*gte:\s*new Date\(\)\s*\}/.test(route),
      checksSameBookingAndThreshold: /hasReminderForInterval\(reminders, booking\.id, interval\)/.test(route),
      sendsReminderEmail: /sendOrganizerRequestReminderEmail\(/.test(route),
      createsMarkerAfterExternalSend: sendIndex >= 0 && markerIndex > sendIndex,
      wrapsSendAndMarkerInTransaction: /\$transaction/.test(route),
      usesAtomicMarkerWrite: /reminderMail\.(?:createMany|upsert)\s*\(/.test(route),
      catchesExternalSendFailure: /try\s*\{[\s\S]{0,800}sendOrganizerRequestReminderEmail/.test(route),
    },
    storage: {
      compoundIdentityUnique:
        /@@unique\(\[\s*referenceId\s*,\s*reminderType\s*,\s*elapsedMinutes\s*\]\)/.test(reminderModel),
      referenceIndex: /@@index\(\[referenceId\]\)/.test(reminderModel),
      typeIndex: /@@index\(\[reminderType\]\)/.test(reminderModel),
      migrationCreatesCompoundUnique:
        /CREATE UNIQUE INDEX[\s\S]{0,220}referenceId[\s\S]{0,220}elapsedMinutes/i.test(migration),
    },
    wiring: {
      reminderOperationCallsites,
      reminderCreationCallsites,
      invalidationCallsites,
      usesTasker: /tasker/i.test(route),
      workflowRunsEvery15Minutes: /cron:\s*["']?\*\/15 \* \* \* \*["']?/.test(workflow),
      workflowCallsReminderEndpoint: /\/api\/cron\/bookingReminder/.test(workflow),
      workflowRequiresAppAndCronSecret: /APP_URL:[\s\S]{0,180}CRON_API_KEY:/.test(workflow),
    },
    sourceBoundaries: {
      cancellationUsesPendingStatusGate: /status:\s*BookingStatus\.PENDING/.test(route),
      cancellationDeletesMarkers: invalidationCallsites.length > 0,
      reschedulingHasBookingIdentityVersion: /reschedul|revision|bookingVersion|occurrenceId/i.test(route),
      concurrencyHasDatabaseClaim: /FOR UPDATE|skipLocked|advisory|lock|claim/i.test(route),
    },
    scan: {
      productionFileCount: productionFiles.length,
      reminderOperationCallsiteCount: reminderOperationCallsites.length,
    },
    counts: {
      routeMarkerWrites: countMatches(route, /reminderMail\.create\s*\(/g),
      routeExternalSends: countMatches(route, /sendOrganizerRequestReminderEmail\(/g),
    },
  };
}

if (require.main === module) {
  const report = inventory(path.resolve(__dirname, ".."));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

module.exports = { inventory };
