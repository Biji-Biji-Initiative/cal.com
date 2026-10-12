// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const { createTRPCUntypedClient, httpBatchLink } = require("@trpc/client");
const superjson = require("superjson").default;
const origin = "http://127.0.0.1:38917";

async function runMultiHostJourney({ pool, guest, fixture, teamId, bookingInput, t }) {
  const slotsClient = createTRPCUntypedClient({
    transformer: superjson,
    links: [httpBatchLink({ url: `${origin}/api/trpc/slots` })],
  });
  await pool.query(`INSERT INTO "Schedule" (id,"userId",name,"timeZone") VALUES (9002,7002,'Colleague availability','UTC');
    INSERT INTO "Availability" ("userId","scheduleId",days,"startTime","endTime") VALUES (7002,9002,ARRAY[0,1,2,3,4,5,6],'09:00:00','17:00:00');
    UPDATE "users" SET "defaultScheduleId"=9002 WHERE id=7002;`);
  await pool.query(
    `INSERT INTO "EventType" (id,title,slug,length,"teamId","schedulingType","rescheduleWithSameRoundRobinHost","minimumBookingNotice","timeZone",locations)
    VALUES (8002,'Preview advisory call','multi',30,$1,'roundRobin',true,0,'UTC',$2);
    `,
    [teamId, JSON.stringify([{ type: "inPerson", address: "Synthetic test meeting room" }])]
  );
  await pool.query(`INSERT INTO "Host" ("userId","eventTypeId","isFixed") VALUES (7001,8002,false),(7002,8002,false);
    INSERT INTO "_user_eventtype" ("A","B") VALUES (8002,7001),(8002,7002);`);
  const start = new Date(bookingInput.start);
  start.setUTCDate(start.getUTCDate() + 3);
  const query = (date, extra = {}) => {
    const from = new Date(date);
    from.setUTCHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + 1);
    return {
      eventTypeId: 8002,
      eventTypeSlug: "multi",
      usernameList: ["advisory"],
      isTeamEvent: true,
      orgSlug: "preview-org",
      timeZone: "UTC",
      startTime: from.toISOString(),
      endTime: to.toISOString(),
      ...extra,
    };
  };
  const book = async (date, extra = {}) => {
    const response = await guest.request.post(`${origin}/api/book/event`, {
      data: {
        ...bookingInput,
        eventTypeId: 8002,
        eventTypeSlug: "multi",
        start: date.toISOString(),
        end: new Date(date.getTime() + 1800000).toISOString(),
        ...extra,
      },
    });
    const body = await response.json();
    assert.ok(
      response.status() < 400,
      `Native multi-host booking failed: ${JSON.stringify(body).slice(0, 500)}`
    );
    assert.equal(typeof body.uid, "string");
    const row = (await pool.query('SELECT id,uid,"userId",status FROM "Booking" WHERE uid=$1', [body.uid]))
      .rows[0];
    assert.ok(row);
    return row;
  };
  const offered = await slotsClient.query("getSchedule", query(start, { routedTeamMemberIds: [7002] }));
  assert.ok(
    Object.values(offered.slots).flat().length > 0,
    "The second eligible host must have advertised slots"
  );
  let mark = fixture.smtp.count();
  const directed = await book(start, { routedTeamMemberIds: [7002] });
  assert.equal(directed.userId, 7002);
  assert.equal(directed.status, "accepted");
  await fixture.smtp.expectDeliverySince(mark, "scheduled", [
    "colleague@example.test",
    "invitee@example.test",
  ]);
  const movedStart = new Date(start);
  movedStart.setUTCDate(movedStart.getUTCDate() + 1);
  mark = fixture.smtp.count();
  const same = await book(movedStart, { rescheduleUid: directed.uid, rescheduledBy: "invitee@example.test" });
  assert.equal(same.userId, 7002, "Enabled same-host policy must retain the original organizer");
  assert.equal(
    (await pool.query('SELECT status FROM "Booking" WHERE uid=$1', [directed.uid])).rows[0].status,
    "cancelled"
  );
  await fixture.smtp.expectDeliverySince(mark, "rescheduled", [
    "colleague@example.test",
    "invitee@example.test",
  ]);
  const routedStart = new Date(movedStart);
  routedStart.setUTCDate(routedStart.getUTCDate() + 1);
  mark = fixture.smtp.count();
  const rerouted = await book(routedStart, {
    rescheduleUid: same.uid,
    routedTeamMemberIds: [7001],
    rescheduledBy: "invitee@example.test",
  });
  assert.equal(rerouted.userId, 7001, "Explicit rerouting must take precedence over same-host");
  await fixture.smtp.expectRecipientsSince(mark, [
    "smoke@example.test",
    "colleague@example.test",
    "invitee@example.test",
  ]);
  await pool.query('DELETE FROM "Membership" WHERE "userId"=7002 AND "teamId"=$1', [teamId]);
  const future = new Date(routedStart);
  future.setUTCDate(future.getUTCDate() + 1);
  const missing = await slotsClient.query("getSchedule", query(future, { routedTeamMemberIds: [7002] }));
  assert.deepEqual(missing.slots, {}, "A removed host cannot advertise slots through fallback");
  const countBefore = (await pool.query('SELECT count(*)::int AS count FROM "Booking"')).rows[0].count;
  const stale = await guest.request.post(`${origin}/api/book/event`, {
    data: {
      ...bookingInput,
      eventTypeId: 8002,
      eventTypeSlug: "multi",
      routedTeamMemberIds: [7002],
      start: future.toISOString(),
      end: new Date(future.getTime() + 1800000).toISOString(),
    },
  });
  assert.ok(
    stale.status() >= 400 && stale.status() < 500,
    "A stale offered slot must fail as a controlled rejection"
  );
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM "Booking"')).rows[0].count, countBefore);
  await pool.query('INSERT INTO "Membership" ("userId","teamId",accepted,role) VALUES (7002,$1,true,$2)', [
    teamId,
    "MEMBER",
  ]);
  await pool.query('UPDATE "Availability" SET "startTime"=$1,"endTime"=$2 WHERE "userId"=7002', [
    "10:00:00",
    "11:00:00",
  ]);
  await pool.query(
    `INSERT INTO "EventType" (id,title,slug,length,"teamId","schedulingType","minimumBookingNotice","timeZone",locations)
    VALUES (8003,'Preview collective call','collective',30,$1,'collective',0,'UTC',$2)`,
    [teamId, JSON.stringify([{ type: "inPerson", address: "Synthetic test meeting room" }])]
  );
  await pool.query(`INSERT INTO "Host" ("userId","eventTypeId","isFixed") VALUES (7001,8003,false),(7002,8003,false);
    INSERT INTO "_user_eventtype" ("A","B") VALUES (8003,7001),(8003,7002);`);
  const collectiveDay = new Date(future);
  collectiveDay.setUTCDate(collectiveDay.getUTCDate() + 2);
  const collectiveSlots = await slotsClient.query(
    "getSchedule",
    query(collectiveDay, { eventTypeId: 8003, eventTypeSlug: "collective" })
  );
  const times = Object.values(collectiveSlots.slots)
    .flat()
    .map((slot) => new Date(slot.time).toISOString())
    .sort();
  const overlapStart = new Date(collectiveDay);
  overlapStart.setUTCHours(10, 0, 0, 0);
  assert.deepEqual(
    times,
    [overlapStart.toISOString(), new Date(overlapStart.getTime() + 1800000).toISOString()],
    "Collective availability must expose exactly the two complete half-hour slots"
  );
  const denied = await guest.request.post(`${origin}/api/book/event`, {
    data: {
      ...bookingInput,
      eventTypeId: 8003,
      eventTypeSlug: "collective",
      start: collectiveDay.toISOString(),
      end: new Date(collectiveDay.getTime() + 1800000).toISOString(),
    },
  });
  assert.ok(
    denied.status() >= 400 && denied.status() < 500,
    "One free host must not make a collective booking succeed"
  );
  collectiveDay.setUTCHours(10, 0, 0, 0);
  mark = fixture.smtp.count();
  const collective = await book(collectiveDay, { eventTypeId: 8003, eventTypeSlug: "collective" });
  const attending = (
    await pool.query('SELECT email FROM "Attendee" WHERE "bookingId"=$1', [collective.id])
  ).rows.map((row) => row.email);
  assert.ok(attending.includes("colleague@example.test"));
  assert.ok(attending.includes("invitee@example.test"));
  await fixture.smtp.expectRecipientsSince(mark, [
    "smoke@example.test",
    "colleague@example.test",
    "invitee@example.test",
  ]);
  await pool.query('UPDATE "users" SET locked=true WHERE id=7002');
  const afterLock = new Date(collectiveDay);
  afterLock.setUTCDate(afterLock.getUTCDate() + 1);
  const lockedSlots = await slotsClient.query(
    "getSchedule",
    query(afterLock, { eventTypeId: 8003, eventTypeSlug: "collective" })
  );
  assert.deepEqual(
    lockedSlots.slots,
    {},
    "Losing a required collective host cannot shrink the participant set"
  );
  t.diagnostic(
    JSON.stringify({
      scope:
        "Real packaged app, PostgreSQL and native slots/booking endpoints; synthetic calendars and local SMTP only",
      directedHost: 7002,
      sameHost: 7002,
      reroutedHost: 7001,
      removedHostRejected: true,
      collectiveIntersection: true,
      lockedCollectiveHostRejected: true,
    })
  );
}
module.exports = { runMultiHostJourney };
