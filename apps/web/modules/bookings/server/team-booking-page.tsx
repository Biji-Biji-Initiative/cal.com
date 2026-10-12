import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getBookingForReschedule, getBookingForSeatedEvent } from "@calcom/features/bookings/lib/get-booking";
import { resolvePublicTeamEvent } from "@calcom/features/community-enterprise/teams/PublicTeamEvent";
import { EventRepository } from "@calcom/features/eventtypes/repositories/EventRepository";
import prisma from "@calcom/prisma";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { PageProps } from "app/_types";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import TeamBookingView from "../views/team-booking-view";

export default async function TeamBookingPage({ params, searchParams }: PageProps) {
  const route = await params;
  if (
    typeof route.team !== "string" ||
    typeof route.type !== "string" ||
    (route.org !== undefined && typeof route.org !== "string")
  )
    notFound();
  const target = await resolvePublicTeamEvent(prisma, {
    organization: route.org,
    team: route.team,
    event: route.type,
  });
  if (!target) notFound();
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  const eventData = await EventRepository.getPublicEvent(
    {
      username: target.teamSlug,
      eventSlug: target.eventSlug,
      isTeamEvent: true,
      org: target.organizationSlug,
      fromRedirectOfNonOrgLink: false,
    },
    session?.user.id
  );
  if (
    !eventData ||
    eventData.id !== target.eventTypeId ||
    eventData.teamId !== target.teamId ||
    eventData.team?.parentId !== target.organizationId
  )
    notFound();
  const query = await searchParams;
  const rescheduleUid = typeof query.rescheduleUid === "string" ? query.rescheduleUid : undefined;
  const bookingUid = typeof query.bookingUid === "string" ? query.bookingUid : undefined;
  if (rescheduleUid && bookingUid && rescheduleUid !== bookingUid) notFound();
  let booking;
  if (rescheduleUid || bookingUid) {
    const uid = rescheduleUid ?? bookingUid;
    const existing = await prisma.booking.findUnique({ where: { uid }, select: { eventTypeId: true } });
    if (existing?.eventTypeId !== target.eventTypeId) notFound();
    if (rescheduleUid) {
      if (eventData.disableRescheduling) redirect(`/booking/${encodeURIComponent(rescheduleUid)}`);
      booking = await getBookingForReschedule(rescheduleUid, session?.user.id);
    } else if (bookingUid) {
      booking = await getBookingForSeatedEvent(bookingUid);
    }
    if (!booking) notFound();
  }
  return <TeamBookingView eventData={eventData} booking={booking} teamSlug={target.teamSlug} />;
}
