import { PermissionCheckService } from "@calcom/features/community-enterprise/authorization/PermissionCheckService";
import type { PrismaClient } from "@calcom/prisma";
import { MembershipRole } from "@calcom/prisma/enums";
import { BookingRepository } from "../repositories/BookingRepository";

type BookingForAccessCheck = NonNullable<Awaited<ReturnType<BookingRepository["findByUidIncludeEventType"]>>>;

export class BookingAccessService {
  private permissionCheckService: PermissionCheckService;

  constructor(private prismaClient: PrismaClient) {
    this.permissionCheckService = new PermissionCheckService(prismaClient);
  }

  private isUserAHost(userId: number, booking: BookingForAccessCheck): boolean {
    const hostMap = new Map<number, { id: number; email: string }>();

    const addHost = (id: number, email: string) => {
      if (!hostMap.has(id)) {
        hostMap.set(id, { id, email });
      }
    };

    booking?.eventType?.hosts?.forEach((host: { userId: number; user: { email: string } }) =>
      addHost(host.userId, host.user.email)
    );
    booking?.eventType?.users?.forEach((user: { id: number; email: string }) => addHost(user.id, user.email));

    if (booking?.user?.id && booking?.user?.email) {
      addHost(booking.user.id, booking.user.email);
    }

    const attendeeEmails = new Set(booking.attendees?.map((attendee: { email: string }) => attendee.email));
    const filteredHosts = Array.from(hostMap.values()).filter(
      (host) => attendeeEmails.has(host.email) || host.id === booking.user?.id
    );

    return filteredHosts.some((host) => host.id === userId);
  }

  /**
   * Determines if a user has access to a booking based on:
   * 1. Being the booking organizer
   * 2. Being one of the hosts in a multi-host booking
   * 3. Being a team/org admin where the event type belongs (uses PBAC if enabled)
   */
  async doesUserIdHaveAccessToBooking({
    userId,
    bookingUid,
    bookingId,
    apiKeyTeamId,
  }: {
    userId: number;
    bookingUid?: string;
    bookingId?: number;
    apiKeyTeamId?: number | null;
  }): Promise<boolean> {
    const bookingRepo = new BookingRepository(this.prismaClient);

    // Fetch booking by UID or ID
    const booking = bookingUid
      ? await bookingRepo.findByUidIncludeEventType({ bookingUid })
      : bookingId
        ? await bookingRepo.findByIdIncludeEventType({ bookingId })
        : null;

    if (!booking) return false;
    if (bookingId && bookingUid && booking.id !== bookingId) return false;
    if (!Number.isSafeInteger(userId) || userId <= 0) return false;
    const actor = await this.prismaClient.user.findUnique({
      where: { id: userId },
      select: { locked: true },
    });
    if (!actor || actor.locked !== false) return false;

    // A team-bound credential restricts the retained user authority even when
    // its owner organizes bookings in several teams or has a personal booking.
    if (apiKeyTeamId !== undefined && apiKeyTeamId !== null) {
      const resourceTeamId = booking.eventType?.teamId ?? booking.eventType?.parent?.teamId;
      if (!Number.isSafeInteger(apiKeyTeamId) || apiKeyTeamId <= 0 || resourceTeamId !== apiKeyTeamId)
        return false;
      if (
        !(await this.permissionCheckService.checkPermission({
          userId,
          teamId: apiKeyTeamId,
          permission: "booking.readTeamBookings",
          fallbackRoles: [MembershipRole.OWNER, MembershipRole.ADMIN],
        }))
      )
        return false;
    }

    // Case 1: User is the booking organizer
    if (userId === booking.userId) return true;

    // Case 2: User is one of the hosts
    if (this.isUserAHost(userId, booking)) return true;

    // Case 3: If booking has a teamId, check if user has access to team bookings
    if (booking.eventType?.teamId) {
      const teamId = booking.eventType.teamId;

      const hasAccess = await this.permissionCheckService.checkPermission({
        userId,
        teamId,
        permission: "booking.readTeamBookings",
        fallbackRoles: [MembershipRole.OWNER, MembershipRole.ADMIN],
      });
      return hasAccess;
    }

    // A managed child belongs to the parent's team. Mere coworker or
    // organization membership never grants access to a private appointment.
    if (booking.eventType?.parent?.teamId) {
      return this.permissionCheckService.checkPermission({
        userId,
        teamId: booking.eventType.parent.teamId,
        permission: "booking.readTeamBookings",
        fallbackRoles: [MembershipRole.OWNER, MembershipRole.ADMIN],
      });
    }

    return false;
  }
}
