// SPDX-License-Identifier: MIT

/**
 * Aggregate-only booking reporting boundary for the retained booking model.
 *
 * The caller must provide rows already authorized to one organization/team.
 * This contract re-checks that boundary, rejects mixed-scope input and returns
 * only reconciled aggregates. It never returns attendee payloads or booking IDs.
 */

export const BOOKING_REPORT_VERSION = 1 as const;
const STATUS_VALUES = ["confirmed", "cancelled", "pending", "rejected"] as const;
const DELIVERY_VALUES = ["none", "sent", "failed", "uncertain"] as const;

export type BookingReportStatus = (typeof STATUS_VALUES)[number];
export type BookingReportDelivery = (typeof DELIVERY_VALUES)[number];

export interface BookingReportScope {
  orgId: string;
  teamId?: string;
}

export interface BookingReportRow {
  id: string;
  orgId: string;
  teamId: string;
  status: BookingReportStatus;
  hostId?: string | null;
  noShow: boolean;
  delivery: BookingReportDelivery;
}

export interface BookingReport {
  version: typeof BOOKING_REPORT_VERSION;
  scope: BookingReportScope;
  totals: {
    bookings: number;
    cancellations: number;
    noShows: number;
    deliveryFailures: number;
  };
  statusCounts: Record<BookingReportStatus, number>;
  hostDistribution: Record<string, number>;
  reconciliation: {
    statusTotal: number;
    hostTotal: number;
    balanced: true;
  };
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > 256) {
    throw new Error(`Booking report ${label} must be a non-empty, trimmed string`);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new Error(`Booking report ${label} is invalid`);
  }
  return value as T;
}

function scopeValue(scope: BookingReportScope): BookingReportScope {
  const orgId = text(scope.orgId, "orgId");
  const teamId = scope.teamId === undefined ? undefined : text(scope.teamId, "teamId");
  return teamId === undefined ? { orgId } : { orgId, teamId };
}

function validateRow(row: BookingReportRow, scope: BookingReportScope): BookingReportRow {
  const normalized = {
    id: text(row.id, "booking id"),
    orgId: text(row.orgId, "row orgId"),
    teamId: text(row.teamId, "row teamId"),
    status: oneOf(row.status, STATUS_VALUES, "status"),
    hostId: row.hostId === null || row.hostId === undefined ? null : text(row.hostId, "hostId"),
    noShow: row.noShow,
    delivery: oneOf(row.delivery, DELIVERY_VALUES, "delivery"),
  };
  if (
    normalized.orgId !== scope.orgId ||
    (scope.teamId !== undefined && normalized.teamId !== scope.teamId)
  ) {
    throw new Error("Booking report rows cross the requested organization/team scope");
  }
  if (typeof normalized.noShow !== "boolean") throw new Error("Booking report noShow must be boolean");
  return normalized;
}

function sortedCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Build a privacy-preserving report from an already scoped booking query.
 *
 * Mixed-organization/team rows are rejected instead of silently filtered. This
 * makes a missing query predicate fail closed. The returned object contains
 * aggregate counts only; raw attendee, event, provider and booking identifiers
 * are intentionally absent.
 */
export function buildBookingReport(
  requestedScope: BookingReportScope,
  rows: readonly BookingReportRow[]
): BookingReport {
  const scope = scopeValue(requestedScope);
  if (!Array.isArray(rows)) throw new Error("Booking report rows must be an array");

  const seenIds = new Set<string>();
  const statusCounts: Record<BookingReportStatus, number> = {
    confirmed: 0,
    cancelled: 0,
    pending: 0,
    rejected: 0,
  };
  const hostDistribution: Record<string, number> = {};
  let noShows = 0;
  let deliveryFailures = 0;

  for (const row of rows) {
    const booking = validateRow(row, scope);
    if (seenIds.has(booking.id)) throw new Error("Booking report contains duplicate booking id");
    seenIds.add(booking.id);
    statusCounts[booking.status] += 1;
    if (booking.noShow) noShows += 1;
    if (booking.delivery === "failed" || booking.delivery === "uncertain") deliveryFailures += 1;
    const host = booking.hostId ?? "unassigned";
    hostDistribution[host] = (hostDistribution[host] ?? 0) + 1;
  }

  const statusTotal = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
  const hostTotal = Object.values(hostDistribution).reduce((sum, count) => sum + count, 0);
  if (statusTotal !== rows.length || hostTotal !== rows.length) {
    throw new Error("Booking report aggregates do not reconcile to scoped rows");
  }

  return {
    version: BOOKING_REPORT_VERSION,
    scope,
    totals: {
      bookings: rows.length,
      cancellations: statusCounts.cancelled,
      noShows,
      deliveryFailures,
    },
    statusCounts,
    hostDistribution: sortedCounts(hostDistribution),
    reconciliation: { statusTotal, hostTotal, balanced: true },
  };
}
