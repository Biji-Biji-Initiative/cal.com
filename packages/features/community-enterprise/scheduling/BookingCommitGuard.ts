// SPDX-License-Identifier: MIT
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { Prisma } from "@calcom/prisma/client";
import { CommunityQualifiedHostsService } from "./QualifiedHostsService";

export interface BookingCommitInput {
  eventTypeId: number | null;
  schedulingType: string | null;
  selectedHosts: readonly { id: number; email: string }[];
  startTime: Date;
  endTime: Date;
  original?: { id: number; uid: string; userId: number | null; status: string } | null;
}

const conflict = () => new ErrorWithCode(ErrorCode.BookingConflict, "This booking is no longer available");
const validId = (id: number) => Number.isSafeInteger(id) && id > 0;

// Lock the selected hosts in a stable order, then read current eligibility and
// overlaps in the SAME transaction as Booking/Attendee creation. READ COMMITTED
// is deliberate: a waiter must see the winner's committed booking after the lock.
export async function assertBookingCanCommit(tx: Prisma.TransactionClient, input: BookingCommitInput) {
  const ids = Array.from(new Set(input.selectedHosts.map((host) => host.id))).sort((a, b) => a - b);
  if (
    !ids.length ||
    ids.length > 1000 ||
    !ids.every(validId) ||
    (input.eventTypeId !== null && !validId(input.eventTypeId)) ||
    !Number.isFinite(input.startTime.valueOf()) ||
    !Number.isFinite(input.endTime.valueOf()) ||
    input.startTime >= input.endTime
  )
    throw conflict();
  const isolation = await tx.$queryRaw<{ level: string }[]>(
    Prisma.sql`SELECT current_setting('transaction_isolation') AS level`
  );
  if (isolation[0]?.level !== "read committed") {
    throw new ErrorWithCode(
      ErrorCode.InternalServerError,
      "Booking commit requires read-committed isolation"
    );
  }
  // Serialize competing reschedules of the same original even if they select
  // different new hosts. This lock precedes all host locks in every such request.
  if (input.original) {
    const originals = await tx.$queryRaw<
      { uid: string; userId: number | null; status: string; eventTypeId: number | null }[]
    >(Prisma.sql`
      SELECT uid, "userId", upper(status::text) AS status, "eventTypeId" FROM "Booking"
      WHERE id = ${input.original.id} FOR UPDATE
    `);
    const original = originals[0];
    if (
      !original ||
      original.uid !== input.original.uid ||
      original.userId !== input.original.userId ||
      original.status !== input.original.status ||
      original.eventTypeId !== input.eventTypeId
    )
      throw conflict();
  }
  const users = await tx.$queryRaw<{ id: number; email: string; locked: boolean }[]>(Prisma.sql`
    SELECT id, email, locked FROM "users" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE
  `);
  if (
    users.length !== ids.length ||
    users.some(
      (user) =>
        user.locked !== false ||
        !input.selectedHosts.some((host) => host.id === user.id && host.email === user.email)
    )
  )
    throw conflict();
  const current =
    input.eventTypeId === null
      ? null
      : await tx.eventType.findUnique({
          where: { id: input.eventTypeId },
          select: { id: true, schedulingType: true, beforeEventBuffer: true, afterEventBuffer: true },
        });
  if (input.eventTypeId !== null && (!current || current.schedulingType !== input.schedulingType))
    throw conflict();
  const qualified = await new CommunityQualifiedHostsService(tx).findQualifiedHostsWithDelegationCredentials({
    eventType: {
      id: input.eventTypeId ?? 0,
      schedulingType: input.schedulingType,
      users: users.map((user) => ({ ...user, credentials: [] })),
    },
    eligibleUserIds: ids,
  });
  const eligibleIds = new Set(
    [...qualified.fixedHosts, ...qualified.qualifiedRRHosts].map((host) => host.user.id)
  );
  if (eligibleIds.size !== ids.length || ids.some((id) => !eligibleIds.has(id))) throw conflict();
  if (input.schedulingType === "ROUND_ROBIN") {
    const groups = new Set<string | null>();
    for (const host of qualified.qualifiedRRHosts) {
      if (groups.has(host.groupId)) throw conflict();
      groups.add(host.groupId);
    }
  }
  const before = Math.max(0, current?.beforeEventBuffer ?? 0);
  const after = Math.max(0, current?.afterEventBuffer ?? 0);
  const starts = new Date(input.startTime.valueOf() - before * 60000);
  const ends = new Date(input.endTime.valueOf() + after * 60000);
  if (!Number.isFinite(starts.valueOf()) || !Number.isFinite(ends.valueOf())) throw conflict();
  // SQL is needed for the existing event's row-specific buffers. Select only a
  // conflict marker: never expose another person's booking details to the caller.
  const collisions = await tx.$queryRaw<{ conflict: number }[]>(Prisma.sql`
    SELECT 1 AS conflict FROM "Booking" b
    LEFT JOIN "EventType" e ON e.id = b."eventTypeId"
    WHERE b.id <> ${input.original?.id ?? 0}
      AND (b.status = 'accepted' OR (b.status = 'pending' AND e."requiresConfirmationWillBlockSlot" = true))
      AND (b."userId" IN (${Prisma.join(ids)}) OR EXISTS (
        SELECT 1 FROM "Attendee" a WHERE a."bookingId" = b.id AND a.email IN (${Prisma.join(users.map((user) => user.email))})
      ))
      AND b."startTime" - make_interval(mins => GREATEST(COALESCE(e."beforeEventBuffer", 0), 0))
          < (${ends.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      AND b."endTime" + make_interval(mins => GREATEST(COALESCE(e."afterEventBuffer", 0), 0))
          > (${starts.toISOString()}::timestamptz AT TIME ZONE 'UTC')
    LIMIT 1
  `);
  if (collisions.length) throw conflict();
}
