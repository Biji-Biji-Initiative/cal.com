// SPDX-License-Identifier: MIT

import { HttpError } from "@calcom/lib/http-error";
import type { PrismaClient } from "@calcom/prisma";
import type { CredentialForCalendarService } from "@calcom/types/Credential";

export type HostUser = {
  id: number;
  email: string;
  locked?: boolean;
  credentials: CredentialForCalendarService[];
};
export type QualifiedHost<User extends HostUser> = { user: User; isFixed: boolean; groupId: string | null };
export type HostEvent<User extends HostUser> = {
  id?: number;
  schedulingType?: string | null;
  users: readonly User[];
  hosts?: readonly { user: User; isFixed: boolean; groupId?: string | null }[];
  userId?: number | null;
};
export type HostQuery<User extends HostUser> = {
  eventType: HostEvent<User>;
  rescheduleUid?: string | null;
  routedTeamMemberIds?: readonly number[] | null;
  contactOwnerEmail?: string | null;
  rrHostSubsetIds?: readonly number[];
  eligibleUserIds?: readonly number[];
};
export type QualifiedHostsResult<User extends HostUser> = {
  qualifiedRRHosts: QualifiedHost<User>[];
  allFallbackRRHosts: QualifiedHost<User>[];
  fixedHosts: QualifiedHost<User>[];
};
export interface QualifiedHostsService {
  findQualifiedHostsWithDelegationCredentials<User extends HostUser>(
    query: HostQuery<User>
  ): Promise<QualifiedHostsResult<User>>;
}
type Database = Pick<PrismaClient, "eventType" | "user" | "team" | "membership" | "booking" | "bookingSeat">;
const validId = (id: number) => Number.isSafeInteger(id) && id > 0;
const empty = <User extends HostUser>(): QualifiedHostsResult<User> => ({
  qualifiedRRHosts: [],
  allFallbackRRHosts: [],
  fixedHosts: [],
});
const noHosts = () => new HttpError({ statusCode: 404, message: "No eligible hosts for this event" });

/** One eligibility contract, not another booking/fairness algorithm. */
export class CommunityQualifiedHostsService implements QualifiedHostsService {
  constructor(private readonly database: Database) {}

  async findQualifiedHostsWithDelegationCredentials<User extends HostUser>(
    query: HostQuery<User>
  ): Promise<QualifiedHostsResult<User>> {
    const { eventType } = query;
    for (const ids of [query.routedTeamMemberIds, query.rrHostSubsetIds, query.eligibleUserIds]) {
      if (ids != null && (!Array.isArray(ids) || ids.length > 1000 || !ids.every(validId))) {
        throw new HttpError({ statusCode: 400, message: "Invalid host restriction" });
      }
    }
    if (
      query.contactOwnerEmail != null &&
      (typeof query.contactOwnerEmail !== "string" || query.contactOwnerEmail.length > 320)
    ) {
      throw new HttpError({ statusCode: 400, message: "Invalid host restriction" });
    }
    const id = eventType.id ?? 0;
    if (id !== 0 && !validId(id)) throw noHosts();
    const current = id
      ? await this.database.eventType.findUnique({
          where: { id },
          select: {
            id: true,
            teamId: true,
            userId: true,
            schedulingType: true,
            rescheduleWithSameRoundRobinHost: true,
            allowReschedulingCancelledBookings: true,
            assignAllTeamMembers: true,
            assignRRMembersUsingSegment: true,
            parent: { select: { teamId: true } },
            hosts: { select: { userId: true, isFixed: true, groupId: true } },
            users: { select: { id: true } },
          },
        })
      : null;
    if (id && !current) throw noHosts();
    // Removed upstream expansion must not quietly degrade to the few loaded hosts.
    if (current?.assignAllTeamMembers || current?.assignRRMembersUsingSegment) {
      throw new HttpError({ statusCode: 400, message: "Automatic team host expansion is not available" });
    }
    const schedulingType = current ? current.schedulingType : (eventType.schedulingType ?? null);
    const isRoundRobin = schedulingType === "ROUND_ROBIN";
    const payload = new Map(eventType.users.map((user) => [user.id, user]));
    for (const host of eventType.hosts ?? []) payload.set(host.user.id, host.user);
    let assigned: { userId: number; isFixed: boolean; groupId: string | null }[];
    if (current) {
      assigned =
        current.hosts.length && schedulingType
          ? current.hosts.map((host) => ({
              userId: host.userId,
              isFixed: !isRoundRobin || host.isFixed,
              groupId: host.groupId,
            }))
          : current.users.map((user) => ({ userId: user.id, isFixed: !isRoundRobin, groupId: null }));
      if (!assigned.length && current.userId)
        assigned = [{ userId: current.userId, isFixed: !isRoundRobin, groupId: null }];
    } else {
      // Dynamic group bookings have no EventType row; all requested people are required.
      assigned = eventType.users.map((user) => ({ userId: user.id, isFixed: true, groupId: null }));
    }
    if (!assigned.length) return empty<User>();
    const userIds = assigned.map((host) => host.userId);
    const activeUsers = await this.database.user.findMany({
      where: { id: { in: userIds }, locked: false },
      select: { id: true, email: true, locked: true, allowDynamicBooking: true },
    });
    const active = new Map(
      activeUsers.filter((user) => user.locked === false).map((user) => [user.id, user])
    );
    const teamId = current?.teamId ?? current?.parent?.teamId ?? null;
    let memberIds: Set<number> | null = null;
    if (teamId !== null) {
      const team = await this.database.team.findUnique({
        where: { id: teamId },
        select: {
          id: true,
          parentId: true,
          isOrganization: true,
          parent: { select: { id: true, parentId: true, isOrganization: true } },
        },
      });
      if (
        !team ||
        (team.isOrganization && team.parentId !== null) ||
        (team.parentId !== null && (!team.parent?.isOrganization || team.parent.parentId !== null))
      )
        throw noHosts();
      const memberships = await this.database.membership.findMany({
        where: {
          userId: { in: userIds },
          teamId: { in: team.parentId === null ? [teamId] : [teamId, team.parentId] },
          accepted: true,
        },
        select: { userId: true, teamId: true, accepted: true },
      });
      const accepted = (userId: number, scope: number) =>
        memberships.some(
          (member) => member.userId === userId && member.teamId === scope && member.accepted === true
        );
      memberIds = new Set(
        userIds.filter(
          (userId) => accepted(userId, teamId) && (team.parentId === null || accepted(userId, team.parentId))
        )
      );
    }
    const eligible: QualifiedHost<User>[] = [];
    for (const host of assigned) {
      const person = active.get(host.userId);
      const user = payload.get(host.userId);
      const allowed =
        person &&
        user &&
        user.locked !== true &&
        (memberIds === null || memberIds.has(host.userId)) &&
        (id !== 0 || person.allowDynamicBooking) &&
        (query.eligibleUserIds === undefined || query.eligibleUserIds.includes(host.userId));
      if (!allowed) {
        // A missing collective/fixed participant cannot become a smaller meeting.
        if (host.isFixed) return empty<User>();
        continue;
      }
      eligible.push({ user: { ...user, email: person.email }, isFixed: host.isFixed, groupId: host.groupId });
    }
    const fixedHosts = eligible.filter((host) => host.isFixed);
    let roundRobinHosts = eligible.filter((host) => !host.isFixed);
    const original =
      query.rescheduleUid && current
        ? await this.findOriginalBooking(
            query.rescheduleUid,
            id,
            current.allowReschedulingCancelledBookings === true
          )
        : null;
    if (query.rescheduleUid && current && !original) return empty<User>();
    const restrict = (ids: readonly number[]) => {
      const selected = new Set(ids);
      roundRobinHosts = roundRobinHosts.filter((host) => selected.has(host.user.id));
    };
    if (query.rrHostSubsetIds?.length) restrict(query.rrHostSubsetIds);
    const routed = query.routedTeamMemberIds ?? [];
    if (routed.length) {
      restrict(routed);
    } else if (query.rescheduleUid && current?.rescheduleWithSameRoundRobinHost && isRoundRobin) {
      if (!original?.userId) return empty<User>();
      restrict([original.userId]);
    } else if (query.contactOwnerEmail) {
      const owner = query.contactOwnerEmail.trim().toLowerCase();
      roundRobinHosts = roundRobinHosts.filter((host) => host.user.email.toLowerCase() === owner);
    }
    const groups = new Set(
      assigned.filter((host) => !host.isFixed && host.groupId !== null).map((host) => host.groupId)
    );
    if (
      isRoundRobin &&
      (roundRobinHosts.length === 0 ||
        Array.from(groups).some((group) => !roundRobinHosts.some((host) => host.groupId === group)))
    )
      return empty<User>();
    // Never escape an explicit restriction through a fallback pool.
    // Calendar conflicts and LuckyUserService still choose among these hosts.
    return { qualifiedRRHosts: roundRobinHosts, allFallbackRRHosts: roundRobinHosts, fixedHosts };
  }

  private async findOriginalBooking(uid: string, eventTypeId: number, allowCancelled = false) {
    if (uid.length === 0 || uid.length > 255) throw noHosts();
    const statuses = ["ACCEPTED", "PENDING", "AWAITING_HOST", ...(allowCancelled ? ["CANCELLED"] : [])];
    const booking = await this.database.booking.findUnique({
      where: { uid },
      select: { userId: true, eventTypeId: true, status: true },
    });
    if (booking)
      return booking.eventTypeId === eventTypeId && statuses.includes(booking.status) ? booking : null;
    const seat = await this.database.bookingSeat.findUnique({
      where: { referenceUid: uid },
      select: { booking: { select: { userId: true, eventTypeId: true, status: true } } },
    });
    return seat?.booking.eventTypeId === eventTypeId && statuses.includes(seat.booking.status)
      ? seat.booking
      : null;
  }
}
