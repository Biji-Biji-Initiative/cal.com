"use client";

import { getBookerWrapperClasses } from "@calcom/features/bookings/Booker/utils/getBookerWrapperClasses";
import type { GetBookingType } from "@calcom/features/bookings/lib/get-booking";
import type { getPublicEvent } from "@calcom/features/eventtypes/lib/getPublicEvent";
import { BookerWebWrapper } from "@calcom/web/modules/bookings/components/BookerWebWrapper";
import BookingPageErrorBoundary from "@components/error/BookingPageErrorBoundary";

export default function TeamBookingView({
  eventData,
  booking,
  teamSlug,
}: {
  eventData: NonNullable<Awaited<ReturnType<typeof getPublicEvent>>>;
  booking?: GetBookingType;
  teamSlug: string;
}) {
  return (
    <BookingPageErrorBoundary>
      <main className={getBookerWrapperClasses({ isEmbed: false })} data-testid="public-team-booker">
        <BookerWebWrapper
          username={teamSlug}
          eventSlug={eventData.slug}
          isTeamEvent
          eventData={eventData}
          bookingData={booking}
          hideBranding={false}
          entity={{ ...eventData.entity, eventTypeId: eventData.id }}
          durationConfig={eventData.metadata?.multipleDuration}
          orgBannerUrl={null}
        />
      </main>
    </BookingPageErrorBoundary>
  );
}
