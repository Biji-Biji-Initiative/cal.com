import dayjs from "@calcom/dayjs";
import getAllUserBookings from "@calcom/features/bookings/lib/getAllUserBookings";
import {
  filterBookingAttendees,
  filterBookingIdentities,
  visibleBookingsQuery,
} from "@calcom/features/community-enterprise/authorization/BookingVisibility";
import { KyselyPermissionStore } from "@calcom/features/community-enterprise/authorization/KyselyPermissionStore";
import { PermissionPolicy } from "@calcom/features/community-enterprise/authorization/PermissionPolicy";
import type { DB } from "@calcom/kysely";
import kysely from "@calcom/kysely";
import { parseEventTypeColor } from "@calcom/lib/isEventTypeColor";
import { parseRecurringEvent } from "@calcom/lib/isRecurringEvent";
import logger from "@calcom/lib/logger";
import { safeStringify } from "@calcom/lib/safeStringify";
import type { PrismaClient } from "@calcom/prisma";
import type { Booking, Prisma } from "@calcom/prisma/client";
import { BookingStatus, MembershipRole, SchedulingType } from "@calcom/prisma/enums";
import { EventTypeMetaDataSchema } from "@calcom/prisma/zod-utils";
import { TRPCError } from "@trpc/server";
import { type Kysely, type SelectQueryBuilder, sql } from "kysely";
import { jsonArrayFrom, jsonObjectFrom } from "kysely/helpers/postgres";
import type { TrpcSessionUser } from "../../../types";
import type { TGetInputSchema } from "./get.schema";

type GetOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
    prisma: PrismaClient;
  };
  input: TGetInputSchema;
};

type InputByStatus = "upcoming" | "recurring" | "past" | "cancelled" | "unconfirmed";

const log = logger.getSubLogger({ prefix: ["bookings.get"] });

export const getHandler = async ({ ctx, input }: GetOptions) => {
  // Support both offset-based (list) and cursor-based pagination (calendar)
  // Cursor is just the offset as a string (fake cursor pagination)
  const take = input.limit;
  let skip = input.offset;

  // If cursor is provided, parse it to get the offset
  if (input.cursor) {
    const parsedCursor = parseInt(input.cursor, 10);
    if (!Number.isNaN(parsedCursor) && parsedCursor >= 0) {
      skip = parsedCursor;
    }
  }

  const { prisma, user } = ctx;
  const defaultStatus = "upcoming";

  const bookingListingByStatus = input.filters.statuses?.length
    ? input.filters.statuses
    : [input.filters.status || defaultStatus];

  const { bookings, recurringInfo, totalCount } = await getAllUserBookings({
    ctx: {
      user: { id: user.id, email: user.email, orgId: user?.profile?.organizationId },
      prisma: prisma,
      kysely: kysely,
    },
    bookingListingByStatus: bookingListingByStatus,
    take,
    skip,
    filters: input.filters,
    sort: input.sort,
  });

  // Generate next cursor for infinite query support
  const nextOffset = skip + take;
  const hasMore = nextOffset < totalCount;
  const nextCursor = hasMore ? nextOffset.toString() : undefined;

  return {
    bookings,
    recurringInfo,
    totalCount,
    nextCursor,
  };
};

type BookingsUnionQuery = SelectQueryBuilder<
  DB,
  "Booking",
  Pick<Booking, "id" | "createdAt" | "updatedAt" | "startTime" | "endTime">
>;

type GetBookingsOptions = {
  user: { id: number; email: string; orgId?: number | null };
  filters: TGetInputSchema["filters"];
  prisma: PrismaClient;
  kysely: Kysely<DB>;
  bookingListingByStatus: InputByStatus[];
  sort?: {
    sortStart?: "asc" | "desc";
    sortEnd?: "asc" | "desc";
    sortCreated?: "asc" | "desc";
    sortUpdated?: "asc" | "desc";
  };
  take: number;
  skip: number;
};

export async function getBookings(options: GetBookingsOptions) {
  const { user, take, skip, filters, bookingListingByStatus } = options;
  const validId = (id: number) => Number.isSafeInteger(id) && id > 0;
  if (
    !validId(user.id) ||
    !Number.isSafeInteger(take) ||
    take < 1 ||
    take > 1000 ||
    !Number.isSafeInteger(skip) ||
    skip < 0 ||
    (user.orgId != null && !validId(user.orgId))
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid booking listing bounds" });
  }
  for (const ids of [filters?.teamIds, filters?.userIds, filters?.eventTypeIds]) {
    if (ids !== undefined && (!Array.isArray(ids) || ids.length > 1000 || !ids.every(validId))) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid booking filter identifiers" });
    }
  }
  if (
    !bookingListingByStatus.every((status) =>
      ["upcoming", "recurring", "past", "cancelled", "unconfirmed"].includes(status)
    )
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid booking status filter" });
  }
  // Permissions, counts, page rows and related metadata must see the same
  // committed state. Revocation affects the next request, not a stale allow cache.
  return options.kysely
    .transaction()
    .setIsolationLevel("repeatable read")
    .execute(async (database) => {
      await sql`SET TRANSACTION READ ONLY`.execute(database);
      await sql`SET LOCAL statement_timeout = '15s'`.execute(database);
      await sql`SET LOCAL idle_in_transaction_session_timeout = '15s'`.execute(database);
      return getBookingsInSnapshot({ ...options, kysely: database });
    });
}

async function getBookingsInSnapshot({
  user,
  kysely,
  bookingListingByStatus,
  sort,
  filters,
  take,
  skip,
}: GetBookingsOptions) {
  const actor = await kysely
    .selectFrom("users")
    .select(["id", "email", "locked"])
    .where("id", "=", user.id)
    .executeTakeFirst();
  if (!actor || actor.locked) throw new TRPCError({ code: "FORBIDDEN" });
  user = { ...user, email: actor.email };
  const permissionCheckService = new PermissionPolicy(new KyselyPermissionStore(kysely));
  const teamIdsWithBookingPermission = await permissionCheckService.getTeamIdsWithPermission({
    userId: user.id,
    permission: "booking.readTeamBookings",
    fallbackRoles: [MembershipRole.ADMIN, MembershipRole.OWNER],
    orgId: user.orgId ?? undefined,
  });
  const visible = visibleBookingsQuery(kysely, user.id, teamIdsWithBookingPermission);
  let queryUnion = filterBookingIdentities(visible, kysely, filters ?? {});
  queryUnion = addStatusesQueryFilters(queryUnion, bookingListingByStatus);
  queryUnion = filterBookingAttendees(queryUnion, filters ?? {});
  if (filters?.bookingUid) queryUnion = queryUnion.where("Booking.uid", "=", filters.bookingUid.trim());
  if (filters?.afterStartDate)
    queryUnion = queryUnion.where("Booking.startTime", ">=", dayjs.utc(filters.afterStartDate).toDate());
  if (filters?.beforeEndDate)
    queryUnion = queryUnion.where("Booking.endTime", "<=", dayjs.utc(filters.beforeEndDate).toDate());
  if (filters?.afterUpdatedDate)
    queryUnion = queryUnion.where("Booking.updatedAt", ">=", dayjs.utc(filters.afterUpdatedDate).toDate());
  if (filters?.beforeUpdatedDate)
    queryUnion = queryUnion.where("Booking.updatedAt", "<=", dayjs.utc(filters.beforeUpdatedDate).toDate());
  if (filters?.afterCreatedDate)
    queryUnion = queryUnion.where("Booking.createdAt", ">=", dayjs.utc(filters.afterCreatedDate).toDate());
  if (filters?.beforeCreatedDate)
    queryUnion = queryUnion.where("Booking.createdAt", "<=", dayjs.utc(filters.beforeCreatedDate).toDate());

  const orderBy = getOrderBy(bookingListingByStatus, sort);

  const getBookingsUnionCompiled = kysely
    .selectFrom(queryUnion.as("union_subquery"))
    .distinct()
    .selectAll("union_subquery")
    .orderBy(orderBy.key, orderBy.order)
    .orderBy("id", "asc")
    .limit(take)
    .offset(skip)
    .compile();

  const bookingsFromUnion = (await kysely.executeQuery(getBookingsUnionCompiled)).rows;

  log.debug(`Get bookings for user ${user.id} SQL:`, getBookingsUnionCompiled.sql);

  const totalCount = Number(
    (
      await kysely
        .selectFrom(queryUnion.as("union_subquery"))
        .select(({ fn }) => fn.count("union_subquery.id").distinct().as("bookingCount"))
        .executeTakeFirst()
    )?.bookingCount ?? 0
  );

  const plainBookings = !(bookingsFromUnion?.length === 0)
    ? await kysely
        .selectFrom("Booking")
        .where(
          "id",
          "in",
          bookingsFromUnion.map((booking) => booking.id)
        )
        .select((eb) => [
          "Booking.id",
          "Booking.title",
          "Booking.userPrimaryEmail",
          "Booking.description",
          "Booking.customInputs",
          "Booking.startTime",
          "Booking.createdAt",
          "Booking.updatedAt",
          "Booking.endTime",
          "Booking.metadata",
          "Booking.uid",
          eb
            .cast<Prisma.JsonValue>(
              // Target TypeScript type
              eb.ref("Booking.responses"), // Source column
              "jsonb" // Target SQL type
            )
            .as("responses"),
          "Booking.recurringEventId",
          "Booking.location",
          eb
            .cast<BookingStatus>(
              eb
                .case()
                .when("Booking.status", "=", "cancelled")
                .then(BookingStatus.CANCELLED)
                .when("Booking.status", "=", "accepted")
                .then(BookingStatus.ACCEPTED)
                .when("Booking.status", "=", "rejected")
                .then(BookingStatus.REJECTED)
                .when("Booking.status", "=", "pending")
                .then(BookingStatus.PENDING)
                .when("Booking.status", "=", "awaiting_host")
                .then(BookingStatus.AWAITING_HOST)
                .else(BookingStatus.PENDING)
                .end(), // End of CASE expression
              "varchar"
            )
            .as("status"),
          "Booking.paid",
          "Booking.fromReschedule",
          "Booking.rescheduled",
          "Booking.rescheduledBy",
          "Booking.cancelledBy",
          "Booking.isRecorded",
          "Booking.cancellationReason",
          "Booking.rejectionReason",
          jsonObjectFrom(
            eb
              .selectFrom("EventType")
              .select((eb) => [
                "EventType.slug",
                "EventType.id",
                "EventType.title",
                "EventType.eventName",
                "EventType.price",
                "EventType.recurringEvent",
                "EventType.currency",
                "EventType.metadata",
                "EventType.disableGuests",
                "EventType.bookingFields",
                "EventType.seatsPerTimeSlot",
                "EventType.seatsShowAttendees",
                "EventType.seatsShowAvailabilityCount",
                "EventType.eventTypeColor",
                "EventType.customReplyToEmail",
                "EventType.allowReschedulingPastBookings",
                "EventType.hideOrganizerEmail",
                "EventType.disableCancelling",
                "EventType.disableRescheduling",
                "EventType.minimumRescheduleNotice",
                "EventType.teamId",
                "EventType.parentId",
                eb
                  .cast<SchedulingType | null>(
                    eb
                      .case()
                      .when("EventType.schedulingType", "=", "roundRobin")
                      .then(SchedulingType.ROUND_ROBIN)
                      .when("EventType.schedulingType", "=", "collective")
                      .then(SchedulingType.COLLECTIVE)
                      .when("EventType.schedulingType", "=", "managed")
                      .then(SchedulingType.MANAGED)
                      .else(null)
                      .end(),
                    "varchar" // Or 'text' - use the actual SQL data type
                  )
                  .as("schedulingType"),
                jsonArrayFrom(
                  eb
                    .selectFrom("Host")
                    .select((eb) => [
                      "Host.userId",
                      jsonObjectFrom(
                        eb
                          .selectFrom("users")
                          .select(["users.id", "users.email"])
                          .whereRef("Host.userId", "=", "users.id")
                      ).as("user"),
                    ])
                    .whereRef("Host.eventTypeId", "=", "EventType.id")
                ).as("hosts"),
                "EventType.length",
                jsonObjectFrom(
                  eb
                    .selectFrom("Team")
                    .select(["Team.id", "Team.name", "Team.slug"])
                    .whereRef("EventType.teamId", "=", "Team.id")
                ).as("team"),
                jsonArrayFrom(
                  eb
                    .selectFrom("HostGroup")
                    .select(["HostGroup.id", "HostGroup.name"])
                    .whereRef("HostGroup.eventTypeId", "=", "EventType.id")
                ).as("hostGroups"),
              ])
              .whereRef("EventType.id", "=", "Booking.eventTypeId")
          ).as("eventType"),
          jsonArrayFrom(
            eb
              .selectFrom("BookingReference")
              .selectAll()
              .whereRef("BookingReference.bookingId", "=", "Booking.id")
          ).as("references"),
          jsonArrayFrom(
            eb
              .selectFrom("Payment")
              .select([
                "Payment.paymentOption",
                "Payment.amount",
                "Payment.currency",
                "Payment.success",
                "Payment.appId",
                "Payment.refunded",
              ])
              .whereRef("Payment.bookingId", "=", "Booking.id")
          ).as("payment"),
          jsonObjectFrom(
            eb
              .selectFrom("users")
              .select([
                "users.id",
                "users.name",
                "users.email",
                "users.avatarUrl",
                "users.username",
                "users.timeZone",
              ])
              .whereRef("Booking.userId", "=", "users.id")
          ).as("user"),
          jsonArrayFrom(
            eb.selectFrom("Attendee").selectAll().whereRef("Attendee.bookingId", "=", "Booking.id")
          ).as("attendees"),
          jsonArrayFrom(
            eb
              .selectFrom("BookingSeat")
              .select((eb) => [
                "BookingSeat.referenceUid",
                jsonObjectFrom(
                  eb
                    .selectFrom("Attendee")
                    .select(["Attendee.email"])
                    .whereRef("BookingSeat.attendeeId", "=", "Attendee.id")
                ).as("attendee"),
              ])
              .whereRef("BookingSeat.bookingId", "=", "Booking.id")
          ).as("seatsReferences"),
          jsonArrayFrom(
            eb
              .selectFrom("AssignmentReason")
              .selectAll()
              .whereRef("AssignmentReason.bookingId", "=", "Booking.id")
              .orderBy("AssignmentReason.createdAt", "asc")
          ).as("assignmentReasonSortedByCreatedAt"),
          jsonObjectFrom(
            eb
              .selectFrom("BookingReport")
              .select([
                "BookingReport.id",
                "BookingReport.reportedById",
                "BookingReport.reason",
                "BookingReport.description",
                "BookingReport.createdAt",
              ])
              .whereRef("BookingReport.bookingUid", "=", "Booking.uid")
          ).as("report"),
        ])
        .orderBy(orderBy.key, orderBy.order)
        .orderBy("id", "asc")
        .execute()
    : [];

  const seriesIds = Array.from(
    new Set(
      plainBookings.map((booking) => booking.recurringEventId).filter((id): id is string => id !== null)
    )
  );
  const seriesBookings =
    seriesIds.length === 0
      ? []
      : await visible
          .clearSelect()
          .select(["Booking.recurringEventId", "Booking.status", "Booking.startTime"])
          .where("Booking.recurringEventId", "in", seriesIds)
          .orderBy("Booking.startTime", "asc")
          .execute();
  const statuses = {
    accepted: "ACCEPTED",
    cancelled: "CANCELLED",
    rejected: "REJECTED",
    pending: "PENDING",
    awaiting_host: "AWAITING_HOST",
  } as const;
  // Preserve the established nullable public contract consumed by the booking UI.
  const recurringInfo: {
    recurringEventId: string | null;
    count: number;
    firstDate: Date | null;
    bookings: { [key: string]: Date[] };
  }[] = seriesIds.map((id) => {
    const rows = seriesBookings.filter((row) => row.recurringEventId === id);
    const bookings: Record<BookingStatus, Date[]> = {
      ACCEPTED: [],
      CANCELLED: [],
      REJECTED: [],
      PENDING: [],
      AWAITING_HOST: [],
    };
    for (const row of rows) bookings[statuses[row.status]].push(row.startTime);
    return { recurringEventId: id, count: rows.length, firstDate: rows[0]?.startTime ?? null, bookings };
  });

  // Now enrich bookings with relation data. We could have queried the relation data along with the bookings, but that would cause unnecessary queries to the database.
  // Because Prisma is also going to query the select relation data sequentially, we are fine querying it separately here as it would be just 1 query instead of 4
  log.info(
    `fetching all bookings for ${user.id}`,
    safeStringify({
      ids: plainBookings.map((booking) => booking.id),
      orderBy,
      take,
      skip,
    })
  );

  const checkIfUserIsHost = (userId: number, booking: (typeof plainBookings)[number]) => {
    if (booking.user?.id === userId) {
      return true;
    }

    if (!booking.eventType?.hosts || booking.eventType.hosts.length === 0) {
      return false;
    }

    const attendeeEmails = new Set(booking.attendees.map((attendee) => attendee.email));

    return booking.eventType.hosts.some(({ user: hostUser }) => {
      return hostUser?.id === userId && attendeeEmails.has(hostUser.email);
    });
  };

  const bookings = await Promise.all(
    plainBookings.map(async (booking) => {
      // If seats are enabled, the event is not set to show attendees, and the current user is not the host, filter out attendees who are not the current user
      if (
        booking.seatsReferences.length &&
        !booking.eventType?.seatsShowAttendees &&
        !checkIfUserIsHost(user.id, booking)
      ) {
        booking.attendees = booking.attendees.filter((attendee) => attendee.email === user.email);
        booking.seatsReferences = booking.seatsReferences.filter(
          (seat) => seat.attendee?.email === user.email
        );
      }

      let rescheduler = null;
      if (booking.fromReschedule) {
        const rescheduledBooking = await visible
          .clearSelect()
          .select("Booking.rescheduledBy")
          .where("Booking.uid", "=", booking.fromReschedule)
          .executeTakeFirst();
        if (rescheduledBooking) {
          rescheduler = rescheduledBooking.rescheduledBy;
        }
      }

      return {
        ...booking,
        rescheduler,
        eventType: {
          ...booking.eventType,
          recurringEvent: parseRecurringEvent(booking.eventType?.recurringEvent),
          eventTypeColor: parseEventTypeColor(booking.eventType?.eventTypeColor),
          price: booking.eventType?.price || 0,
          currency: booking.eventType?.currency || "usd",
          metadata: EventTypeMetaDataSchema.parse(booking.eventType?.metadata || {}),
        },
        startTime: booking.startTime.toISOString(),
        endTime: booking.endTime.toISOString(),
      };
    })
  );

  // Enrich attendees with user data
  const enrichedBookings = await enrichAttendeesWithUserData(bookings, kysely);

  return { bookings: enrichedBookings, recurringInfo, totalCount };
}

type EnrichedUserData = {
  name: string | null;
  email: string;
  avatarUrl: string | null;
  username: string | null;
};

/**
 * Enriches booking attendees with user data by performing a left outer join
 * between attendees and users tables on email addresses.
 *
 * @param bookings - Array of bookings with attendees to enrich
 * @param kysely - Kysely database client instance
 * @returns Bookings with attendees enriched with user data (name, email, avatarUrl, username)
 */
async function enrichAttendeesWithUserData<
  TBooking extends { attendees: ReadonlyArray<{ id: number; email: string }> },
>(
  bookings: TBooking[],
  kysely: Kysely<DB>
): Promise<
  Array<
    Omit<TBooking, "attendees"> & {
      attendees: Array<TBooking["attendees"][number] & { user: EnrichedUserData | null }>;
    }
  >
> {
  // Extract all unique attendee emails from bookings
  const allAttendees = bookings.flatMap((booking) => booking.attendees);
  const uniqueAttendeeIds = Array.from(new Set(allAttendees.map((attendee) => attendee.id)));

  // Query attendees with left join to users table
  const enrichedAttendees =
    uniqueAttendeeIds.length > 0
      ? await kysely
          .selectFrom("Attendee")
          .leftJoin("users", "users.email", "Attendee.email")
          .select(["Attendee.id", "users.name", "Attendee.email", "users.avatarUrl", "users.username"])
          .where("Attendee.id", "in", uniqueAttendeeIds)
          .execute()
      : [];

  // Create a lookup map for O(1) access by attendee ID
  const attendeeUserDataMap = new Map<number, EnrichedUserData>(
    enrichedAttendees.map((enriched) => [
      enriched.id,
      {
        name: enriched.name,
        email: enriched.email,
        avatarUrl: enriched.avatarUrl,
        username: enriched.username,
      },
    ])
  );

  // Map over bookings and enrich each attendee with user data
  return bookings.map((booking) => ({
    ...booking,
    attendees: booking.attendees.map((attendee) => ({
      ...attendee,
      user: attendeeUserDataMap.get(attendee.id) || null,
    })),
  }));
}

function addStatusesQueryFilters(query: BookingsUnionQuery, statuses: InputByStatus[]) {
  if (statuses?.length) {
    return query.where(({ eb, or, and }) =>
      or(
        statuses.map((status) => {
          if (status === "upcoming") {
            return and([
              eb("Booking.endTime", ">=", new Date()),
              or([
                and([eb("Booking.recurringEventId", "is not", null), eb("Booking.status", "=", "accepted")]),
                and([
                  eb("Booking.recurringEventId", "is", null),
                  eb("Booking.status", "not in", ["cancelled", "rejected"]),
                ]),
              ]),
            ]);
          }

          if (status === "recurring") {
            return and([
              eb("Booking.endTime", ">=", new Date()),
              eb("Booking.recurringEventId", "is not", null),
              eb("Booking.status", "not in", ["cancelled", "rejected"]),
            ]);
          }

          if (status === "past") {
            return and([
              eb("Booking.endTime", "<=", new Date()),
              eb("Booking.status", "not in", ["cancelled", "rejected"]),
            ]);
          }

          if (status === "cancelled") {
            return eb("Booking.status", "in", ["cancelled", "rejected"]);
          }

          if (status === "unconfirmed") {
            return and([eb("Booking.endTime", ">=", new Date()), eb("Booking.status", "=", "pending")]);
          }
          return and([]);
        })
      )
    );
  }

  return query;
}

function getOrderBy(
  bookingListingByStatus: InputByStatus[],
  sort?: {
    sortStart?: "asc" | "desc";
    sortEnd?: "asc" | "desc";
    sortCreated?: "asc" | "desc";
    sortUpdated?: "asc" | "desc";
  }
): { key: "startTime" | "endTime" | "createdAt" | "updatedAt"; order: "desc" | "asc" } {
  const bookingListingOrderby = {
    upcoming: { startTime: "asc" },
    recurring: { startTime: "asc" },
    past: { startTime: "desc" },
    cancelled: { startTime: "desc" },
    unconfirmed: { startTime: "asc" },
  } as const;

  if (bookingListingByStatus?.length === 1 && !sort) {
    return { key: "startTime", order: bookingListingOrderby[bookingListingByStatus[0]].startTime };
  }

  if (sort?.sortStart) {
    return { key: "startTime", order: sort.sortStart };
  }
  if (sort?.sortEnd) {
    return { key: "endTime", order: sort.sortEnd };
  }
  if (sort?.sortCreated) {
    return { key: "createdAt", order: sort.sortCreated };
  }
  if (sort?.sortUpdated) {
    return { key: "updatedAt", order: sort.sortUpdated };
  }

  return { key: "startTime", order: "asc" };
}
