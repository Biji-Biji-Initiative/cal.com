// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");
const root = path.resolve(__dirname, "../..");
const cases = [
  {
    zone: "UTC",
    from: "2026-10-23T00:00:00Z",
    to: "2026-10-24T00:00:00Z",
    expected: ["2026-10-23T10:00:00.000Z", "2026-10-23T11:00:00.000Z"],
  },
  {
    zone: "Pacific/Guadalcanal",
    from: "2026-10-22T13:00:00Z",
    to: "2026-10-23T13:00:00Z",
    expected: ["2026-10-22T23:00:00.000Z", "2026-10-23T00:00:00.000Z"],
  },
  {
    zone: "Asia/Kuala_Lumpur",
    from: "2026-10-22T16:00:00Z",
    to: "2026-10-23T16:00:00Z",
    expected: ["2026-10-23T02:00:00.000Z", "2026-10-23T03:00:00.000Z"],
  },
  {
    zone: "America/New_York",
    from: "2026-11-01T04:00:00Z",
    to: "2026-11-02T05:00:00Z",
    expected: ["2026-11-01T15:00:00.000Z", "2026-11-01T16:00:00.000Z"],
  },
  {
    zone: "Europe/London",
    from: "2026-10-25T00:00:00Z",
    to: "2026-10-26T00:00:00Z",
    expected: ["2026-10-25T10:00:00.000Z", "2026-10-25T11:00:00.000Z"],
  },
];
for (const processTimezone of ["UTC", "Asia/Kuala_Lumpur", "Pacific/Guadalcanal", "America/Los_Angeles"]) {
  test(`organizer working hours do not depend on process timezone ${processTimezone}`, () => {
    const script = `
      const dayjs = require('./packages/dayjs').default;
      const { buildDateRanges } = require('./packages/features/schedules/lib/date-ranges');
      const result = ${JSON.stringify(cases)}.map(({zone,from,to}) => buildDateRanges({
        timeZone:zone,dateFrom:dayjs.utc(from),dateTo:dayjs.utc(to),travelSchedules:[],
        availability:[{days:[0,1,2,3,4,5,6],startTime:new Date('1970-01-01T10:00:00Z'),endTime:new Date('1970-01-01T11:00:00Z'),date:null}]
      }).dateRanges.map(({start,end}) => [start.toISOString(),end.toISOString()]));
      console.log(JSON.stringify(result));
    `;
    const output = execFileSync(
      process.execPath,
      ["--require", "ts-node/register/transpile-only", "-e", script],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 30000,
        env: {
          ...process.env,
          TZ: processTimezone,
          TS_NODE_SKIP_PROJECT: "true",
          TS_NODE_COMPILER_OPTIONS: JSON.stringify({
            module: "CommonJS",
            moduleResolution: "node",
            target: "ES2022",
          }),
        },
      }
    );
    assert.deepEqual(
      JSON.parse(output.trim()),
      cases.map(({ expected }) => [expected])
    );
  });
}
