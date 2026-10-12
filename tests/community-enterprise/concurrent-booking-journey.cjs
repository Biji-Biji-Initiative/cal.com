// SPDX-License-Identifier: MIT
// Acceptance probe: actual HTTP requests and database writes, with a test-only
// barrier after availability checks. No deployment database is used.
const assert = require("node:assert/strict");
const origin = "http://127.0.0.1:38917";

async function runConcurrentBookingJourney({ pool, guest, fixture, teamId, bookingInput, t }) {
  const current = (await pool.query("SELECT current_database() AS name, current_user AS role")).rows[0];
  assert.equal(current.role, "cal_enterprise_test");
  assert.equal(current.name, "postgres", "Use only the existing isolated built-web fixture");
  await pool.query(
    `INSERT INTO "EventType" (id,title,slug,length,"teamId","schedulingType","minimumBookingNotice","timeZone",locations)
    VALUES (8101,'Preview advisory call','race-a',30,$1,'roundRobin',0,'UTC',$2),
           (8102,'Preview advisory call','race-b',30,$1,'roundRobin',0,'UTC',$2)`,
    [teamId, JSON.stringify([{ type: "inPerson", address: "Synthetic test meeting room" }])]
  );
  await pool.query(`INSERT INTO "Host" ("userId","eventTypeId","isFixed") VALUES (7001,8101,false),(7001,8102,false);
    INSERT INTO "_user_eventtype" ("A","B") VALUES (8101,7001),(8102,7001);`);
  // Gate only these fixture event IDs. The lock releases before either insert
  // completes. Waiter-chain inspection proves both requests contend in the DB;
  // the repaired second request waits on the first selected-host row lock.
  await pool.query(`CREATE FUNCTION cal_test_write_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW."eventTypeId" IN (8101,8102) THEN
        PERFORM pg_advisory_xact_lock(731205,8101);
      END IF;
      RETURN NEW;
    END; $$;
    CREATE TRIGGER cal_test_booking_barrier BEFORE INSERT ON "Booking"
    FOR EACH ROW EXECUTE FUNCTION cal_test_write_barrier();`);
  const messagesBefore = fixture.smtp.count();
  const barrier = await pool.connect();
  let released = false;
  let outcomes;
  const start = new Date(bookingInput.start);
  start.setUTCDate(start.getUTCDate() + 20);
  start.setUTCHours(10, 0, 0, 0);
  const send = async (id, slug, offsetMinutes) => {
    const time = new Date(start.getTime() + offsetMinutes * 60000);
    const response = await guest.request.post(`${origin}/api/book/event`, {
      data: {
        ...bookingInput,
        eventTypeId: id,
        eventTypeSlug: slug,
        start: time.toISOString(),
        end: new Date(time.getTime() + 1800000).toISOString(),
      },
      timeout: 30000,
    });
    const body = await response.json();
    return { status: response.status(), uid: body.uid ?? null, message: body.message ?? null };
  };
  try {
    await barrier.query("BEGIN");
    const gateId = (await barrier.query("SELECT pg_backend_pid() AS id")).rows[0].id;
    await barrier.query("SELECT pg_advisory_xact_lock(731205,8101)");
    outcomes = Promise.allSettled([send(8101, "race-a", 0), send(8102, "race-b", 15)]);
    const deadline = Date.now() + 15000;
    let waiting = 0;
    while (Date.now() < deadline) {
      waiting = (
        await pool.query(
          `WITH RECURSIVE waiters(pid) AS (
        SELECT pid FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))
        UNION SELECT a.pid FROM pg_stat_activity a JOIN waiters w ON w.pid = ANY(pg_blocking_pids(a.pid))
      ) SELECT count(*)::int AS count FROM waiters`,
          [gateId]
        )
      ).rows[0].count;
      if (waiting === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(
      waiting,
      2,
      "Both real requests must contend in the database behind the controlled insert barrier"
    );
    await barrier.query("COMMIT");
    released = true;
    const requests = await outcomes;
    const bookings = (
      await pool.query(`SELECT "eventTypeId","userId",status,"startTime","endTime" FROM "Booking"
      WHERE "eventTypeId" IN (8101,8102) ORDER BY "eventTypeId"`)
    ).rows;
    t.diagnostic(
      JSON.stringify({
        scope: "actual overlapping cross-event requests for one host, gated at insertion",
        requests,
        bookings,
      })
    );
    const accepted = bookings.filter((booking) => booking.status === "accepted");
    assert.equal(accepted.length, 1, "Two overlapping appointments for the same host must not both commit");
    const responses = requests.map((result) => {
      assert.equal(result.status, "fulfilled");
      return result.value.status;
    });
    assert.equal(responses.filter((status) => status < 400).length, 1);
    assert.equal(
      responses.filter((status) => status >= 400 && status < 500).length,
      1,
      "The losing request must receive a controlled conflict, not a server error"
    );
    await fixture.smtp.expectDeliverySince(messagesBefore, "scheduled");
    assert.equal(
      fixture.smtp.count() - messagesBefore,
      2,
      "Only the successful appointment may notify its organizer and invitee"
    );
  } finally {
    if (!released) await barrier.query("ROLLBACK");
    barrier.release();
    if (outcomes) await outcomes;
    await pool.query(
      'DROP TRIGGER IF EXISTS cal_test_booking_barrier ON "Booking"; DROP FUNCTION IF EXISTS cal_test_write_barrier()'
    );
  }
}
module.exports = { runConcurrentBookingJourney };
