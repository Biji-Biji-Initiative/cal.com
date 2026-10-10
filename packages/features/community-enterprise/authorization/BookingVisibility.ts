// SPDX-License-Identifier: MIT

import type { TextFilterValue } from "@calcom/features/data-table/lib/types";
import type { DB } from "@calcom/kysely";
import type { ExpressionBuilder, Kysely } from "kysely";

export interface BookingIdentityFilters {
  teamIds?: number[];
  userIds?: number[];
  eventTypeIds?: number[];
}

// authorizedTeamIds must come from PermissionPolicy in the SAME read snapshot.
// Attendee identity is resolved from the database, never a caller's email string.
export function visibleBookingsQuery(database: Kysely<DB>, userId: number, authorizedTeamIds: number[]) {
  const actorEmail = database.selectFrom("users").select("email").where("id", "=", userId);
  return database
    .selectFrom("Booking")
    .select(["Booking.id", "Booking.startTime", "Booking.endTime", "Booking.createdAt", "Booking.updatedAt"])
    .where((eb) =>
      eb.exists(eb.selectFrom("users").select("id").where("id", "=", userId).where("locked", "=", false))
    )
    .where((eb) =>
      eb.or([
        eb("Booking.userId", "=", userId),
        eb.exists(
          eb
            .selectFrom("Attendee")
            .select("Attendee.id")
            .whereRef("Attendee.bookingId", "=", "Booking.id")
            .where("Attendee.email", "=", actorEmail)
        ),
        eb.exists(
          eb
            .selectFrom("BookingSeat")
            .innerJoin("Attendee", "Attendee.id", "BookingSeat.attendeeId")
            .select("BookingSeat.id")
            .whereRef("BookingSeat.bookingId", "=", "Booking.id")
            .where("Attendee.email", "=", actorEmail)
        ),
        authorizedTeamIds.length === 0
          ? eb.val(false)
          : eb("Booking.eventTypeId", "in", eventTypesOwnedByTeams(database, authorizedTeamIds)),
      ])
    );
}

function eventTypesOwnedByTeams(database: Kysely<DB>, teamIds: readonly number[]) {
  return database
    .selectFrom("EventType")
    .leftJoin("EventType as ParentEvent", "ParentEvent.id", "EventType.parentId")
    .select("EventType.id")
    .where((eb) =>
      eb.or([
        eb("EventType.teamId", "in", teamIds),
        // A conflicting parent must never override explicit ownership.
        eb.and([eb("EventType.teamId", "is", null), eb("ParentEvent.teamId", "in", teamIds)]),
      ])
    );
}

type VisibleBookingsQuery = ReturnType<typeof visibleBookingsQuery>;

// Requested identities are search filters, not grants. Unknown identities match
// nothing; they never cause an omitted WHERE clause or an existence oracle.
export function filterBookingIdentities(
  query: VisibleBookingsQuery,
  database: Kysely<DB>,
  filters: BookingIdentityFilters
) {
  if (filters.teamIds?.length) {
    query = query.where("Booking.eventTypeId", "in", eventTypesOwnedByTeams(database, filters.teamIds));
  }
  if (filters.eventTypeIds?.length) {
    const ids = filters.eventTypeIds;
    query = query.where(
      "Booking.eventTypeId",
      "in",
      database
        .selectFrom("EventType")
        .select("id")
        .where((eb) => eb.or([eb("id", "in", ids), eb("parentId", "in", ids)]))
    );
  }
  if (filters.userIds?.length) {
    const ids = filters.userIds;
    const emails = database.selectFrom("users").select("email").where("id", "in", ids);
    query = query.where((eb) =>
      eb.or([
        eb("Booking.userId", "in", ids),
        eb.exists(
          eb
            .selectFrom("Attendee")
            .select("Attendee.id")
            .whereRef("Attendee.bookingId", "=", "Booking.id")
            .where("Attendee.email", "in", emails)
        ),
        eb.exists(
          eb
            .selectFrom("BookingSeat")
            .innerJoin("Attendee", "Attendee.id", "BookingSeat.attendeeId")
            .select("BookingSeat.id")
            .whereRef("BookingSeat.bookingId", "=", "Booking.id")
            .where("Attendee.email", "in", emails)
        ),
      ])
    );
  }
  return query;
}

function attendeeTextPredicate(
  eb: ExpressionBuilder<DB, "Attendee">,
  field: "name" | "email",
  filter: string | TextFilterValue
) {
  const column = `Attendee.${field}` as const;
  if (typeof filter === "string") return eb(column, "=", filter.trim());
  const { operator, operand } = filter.data;
  const literal = operand.replace(/[\\%_]/g, "\\$&");
  switch (operator) {
    case "equals":
      return eb(eb.fn<string>("lower", [column]), "=", operand.toLowerCase());
    case "notEquals":
      return eb(eb.fn<string>("lower", [column]), "<>", operand.toLowerCase());
    case "contains":
      return eb(column, "ilike", `%${literal}%`);
    case "notContains":
      return eb(column, "not ilike", `%${literal}%`);
    case "startsWith":
      return eb(column, "ilike", `${literal}%`);
    case "endsWith":
      return eb(column, "ilike", `%${literal}`);
    case "isEmpty":
      return eb.or([eb(column, "is", null), eb(column, "=", "")]);
    case "isNotEmpty":
      return eb.and([eb(column, "is not", null), eb(column, "<>", "")]);
    default:
      return eb.val(false);
  }
}

export function filterBookingAttendees(
  query: VisibleBookingsQuery,
  filters: { attendeeName?: string | TextFilterValue; attendeeEmail?: string | TextFilterValue }
) {
  const { attendeeName, attendeeEmail } = filters;
  if (!attendeeName && !attendeeEmail) return query;
  return query.where((eb) => {
    let attendee = eb
      .selectFrom("Attendee")
      .select("Attendee.id")
      .whereRef("Attendee.bookingId", "=", "Booking.id");
    if (attendeeName)
      attendee = attendee.where((nested) => attendeeTextPredicate(nested, "name", attendeeName));
    if (attendeeEmail)
      attendee = attendee.where((nested) => attendeeTextPredicate(nested, "email", attendeeEmail));
    return eb.exists(attendee);
  });
}
