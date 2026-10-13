import { GOOGLE_CALENDAR_TYPE } from "@calcom/platform-constants";
import type { Prisma } from "@calcom/prisma/client";
import { Injectable } from "@nestjs/common";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { BookingReferencesFilterInput_2024_08_13 } from "@/platform/bookings/2024-08-13/inputs/booking-references-filter.input";

@Injectable()
export class BookingReferencesRepository_2024_08_13 {
  constructor(
    private readonly dbRead: PrismaReadService,
    private readonly dbWrite: PrismaWriteService
  ) {}

  async getBookingReferences(bookingId: number, filter?: BookingReferencesFilterInput_2024_08_13) {
    const whereClause: Prisma.BookingReferenceWhereInput = { bookingId, deleted: null };
    if (filter?.type) whereClause.type = filter.type;
    return this.dbRead.prisma.bookingReference.findMany({
      where: whereClause,
      select: { type: true, uid: true, id: true, externalCalendarId: true },
    });
  }

  async getBookingReferencesIncludeSensitiveCredentials(eventUid: string, userId: number) {
    // Prisma omits undefined filters: missing internal identity must never become
    // an unscoped secret lookup. Use primary state for authorization, not a replica.
    if (!Number.isSafeInteger(userId) || userId <= 0 || typeof eventUid !== "string" || !eventUid.trim()) {
      return null;
    }
    return this.dbWrite.prisma.bookingReference.findFirst({
      where: {
        uid: eventUid,
        type: GOOGLE_CALENDAR_TYPE,
        deleted: null,
        booking: { userId, user: { locked: false } },
      },
      select: {
        uid: true,
        externalCalendarId: true,
        credential: { select: { key: true } },
        delegationCredential: { select: { id: true } },
        booking: { select: { user: { select: { id: true, email: true } } } },
      },
    });
  }
}
