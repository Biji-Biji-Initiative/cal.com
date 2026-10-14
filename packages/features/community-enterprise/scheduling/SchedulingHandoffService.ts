// SPDX-License-Identifier: MIT
import { createHash, randomUUID } from "node:crypto";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { Prisma, type PrismaClient } from "@calcom/prisma/client";
import { z } from "zod";

const id = z.number().int().positive();
const identity = z.object({ id, uuid: z.string().uuid() }).strict();
export const handoffEventsInput = z
  .object({ organizationId: id, source: identity, cursor: id.optional() })
  .strict();
export const handoffOptionsInput = handoffEventsInput
  .omit({ cursor: true })
  .extend({ eventTypeId: id, cursor: id.optional() })
  .strict();
export const handoffReviewInput = handoffOptionsInput
  .omit({ cursor: true })
  .extend({ successor: identity, successorScheduleId: id })
  .strict();
export const handoffCommitInput = handoffReviewInput
  .extend({ reviewHash: z.string().regex(/^[a-f0-9]{64}$/), requestId: z.string().uuid() })
  .strict();
type Actor = z.infer<typeof identity>;
type Request = z.infer<typeof handoffReviewInput>;
type Tx = Prisma.TransactionClient;
const denied = () =>
  new ErrorWithCode(ErrorCode.Forbidden, "You cannot hand over this shared scheduling responsibility");
const invalid = (message: string) => new ErrorWithCode(ErrorCode.BadRequest, message);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const personFields = {
  id: true,
  uuid: true,
  name: true,
  email: true,
  timeZone: true,
  locked: true,
  isPlatformManaged: true,
} as const;
const grantFields = {
  id: true,
  userId: true,
  teamId: true,
  role: true,
  accepted: true,
  customRoleId: true,
  updatedAt: true,
} as const;
const scheduleFields = { id: true, name: true, userId: true, timeZone: true } as const;
const scope = (organizationId: number): Prisma.EventTypeWhereInput => ({
  OR: [{ teamId: organizationId }, { team: { parentId: organizationId, isOrganization: false } }],
});
const sourceLinks = (userId: number): Prisma.EventTypeWhereInput => ({
  OR: [
    { userId },
    { users: { some: { id: userId } } },
    { hosts: { some: { userId } } },
    { profile: { userId } },
    { schedule: { userId } },
    { restrictionSchedule: { userId } },
    { instantMeetingSchedule: { userId } },
    { hosts: { some: { schedule: { userId } } } },
  ],
});
const eventFields = {
  id: true,
  title: true,
  slug: true,
  updatedAt: true,
  teamId: true,
  userId: true,
  profileId: true,
  schedulingType: true,
  parentId: true,
  assignAllTeamMembers: true,
  assignRRMembersUsingSegment: true,
  recurringEvent: true,
  seatsPerTimeSlot: true,
  isInstantEvent: true,
  metadata: true,
  locations: true,
  price: true,
  useEventLevelSelectedCalendars: true,
  useEventTypeDestinationCalendarEmail: true,
  enablePerHostLocations: true,
  secondaryEmailId: true,
  customReplyToEmail: true,
  instantMeetingScheduleId: true,
  restrictionScheduleId: true,
  scheduleId: true,
  schedule: { select: scheduleFields },
  profile: { select: { id: true, userId: true, organizationId: true } },
  team: {
    select: {
      id: true,
      parentId: true,
      slug: true,
      isOrganization: true,
      pendingPayment: true,
      isPlatform: true,
      dsyncTeamGroupMapping: { select: { id: true }, take: 1 },
    },
  },
  users: { select: { id: true }, orderBy: { id: "asc" as const }, take: 101 },
  hosts: {
    select: {
      userId: true,
      isFixed: true,
      priority: true,
      weight: true,
      weightAdjustment: true,
      scheduleId: true,
      groupId: true,
      memberId: true,
      createdAt: true,
      schedule: { select: scheduleFields },
      location: { select: { id: true } },
      member: { select: grantFields },
    },
    orderBy: { userId: "asc" as const },
    take: 101,
  },
  hostGroups: { select: { id: true, eventTypeId: true }, orderBy: { id: "asc" as const }, take: 101 },
  children: { select: { id: true }, take: 1 },
  webhooks: { select: { id: true, userId: true, platformOAuthClientId: true }, take: 101 },
  destinationCalendar: { select: { id: true } },
  selectedCalendars: { select: { id: true }, take: 1 },
} satisfies Prisma.EventTypeSelect;

// One retained host slot changes hands. Existing appointments and provider
// resources do not get reassigned by editing their owner IDs in the database.
export class SchedulingHandoffService {
  constructor(private readonly db: PrismaClient) {}
  private async active(tx: Tx, who: Actor, allowLocked = false) {
    const user = await tx.user.findUnique({ where: { id: who.id, locked: {} }, select: personFields });
    if (!user || user.uuid !== who.uuid || user.isPlatformManaged || (!allowLocked && user.locked))
      throw denied();
    return user;
  }
  private async authority(tx: Tx, actor: Actor, organizationId: number, source: Actor) {
    const operator = await this.active(tx, actor);
    const departing = await this.active(tx, source, true);
    const org = await tx.team.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        slug: true,
        parentId: true,
        isOrganization: true,
        pendingPayment: true,
        isPlatform: true,
        dsyncTeamGroupMapping: { select: { id: true }, take: 1 },
        organizationSettings: { select: { dSyncData: { select: { id: true } } } },
      },
    });
    if (
      !org?.isOrganization ||
      org.parentId !== null ||
      org.pendingPayment ||
      org.isPlatform ||
      org.dsyncTeamGroupMapping.length ||
      org.organizationSettings?.dSyncData
    )
      throw denied();
    const grants = await tx.membership.findMany({
      where: { teamId: org.id, userId: { in: [actor.id, source.id] } },
      select: grantFields,
      orderBy: { id: "asc" },
    });
    const admin = grants.find((grant) => grant.userId === actor.id);
    const member = grants.find((grant) => grant.userId === source.id);
    if (
      !admin?.accepted ||
      admin.customRoleId !== null ||
      !["OWNER", "ADMIN"].includes(admin.role) ||
      !member?.accepted ||
      member.customRoleId !== null
    )
      throw denied();
    return { operator, departing, org, grants };
  }
  private async event(tx: Tx, organizationId: number, source: Actor, eventTypeId: number) {
    const event = await tx.eventType.findFirst({
      where: { id: eventTypeId, AND: [scope(organizationId), sourceLinks(source.id)] },
      select: eventFields,
    });
    if (
      !event?.team ||
      event.team.pendingPayment ||
      event.team.isPlatform ||
      event.team.dsyncTeamGroupMapping.length
    )
      throw denied();
    if (
      event.team.isOrganization
        ? event.team.id !== organizationId || event.team.parentId !== null
        : event.team.parentId !== organizationId
    )
      throw denied();
    if (
      event.hosts.length > 100 ||
      event.users.length > 100 ||
      event.hostGroups.length > 100 ||
      event.webhooks.length > 100
    )
      throw invalid("This event exceeds the reviewed single-event handoff limit");
    return event;
  }
  async events(actor: Actor, raw: z.input<typeof handoffEventsInput>) {
    actor = identity.parse(actor);
    const input = handoffEventsInput.parse(raw);
    return this.db.$transaction(
      async (tx) => {
        await this.authority(tx, actor, input.organizationId, input.source);
        const rows = await tx.eventType.findMany({
          where: {
            AND: [scope(input.organizationId), sourceLinks(input.source.id)],
            ...(input.cursor ? { id: { gt: input.cursor } } : {}),
          },
          select: { id: true, title: true, slug: true, schedulingType: true, teamId: true },
          orderBy: { id: "asc" },
          take: 51,
        });
        return { items: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49].id : null };
      },
      { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 10000 }
    );
  }
  async options(actor: Actor, raw: z.input<typeof handoffOptionsInput>) {
    actor = identity.parse(actor);
    const input = handoffOptionsInput.parse(raw);
    return this.db.$transaction(
      async (tx) => {
        await this.authority(tx, actor, input.organizationId, input.source);
        const event = await this.event(tx, input.organizationId, input.source, input.eventTypeId);
        const rows = await tx.membership.findMany({
          where: {
            teamId: event.teamId!,
            accepted: true,
            customRoleId: null,
            ...(input.cursor ? { id: { gt: input.cursor } } : {}),
            userId: { not: input.source.id },
            user: {
              locked: false,
              isPlatformManaged: false,
              teams: { some: { teamId: input.organizationId, accepted: true, customRoleId: null } },
            },
          },
          select: {
            id: true,
            user: {
              select: {
                id: true,
                uuid: true,
                name: true,
                email: true,
                timeZone: true,
                schedules: {
                  select: { ...scheduleFields, _count: { select: { availability: true } } },
                  orderBy: { id: "asc" },
                  take: 51,
                },
              },
            },
          },
          orderBy: { id: "asc" },
          take: 51,
        });
        return {
          items: rows.slice(0, 50).map((row) => ({
            ...row.user,
            schedules: row.user.schedules
              .slice(0, 50)
              .map((schedule) => ({ ...schedule, timeZone: schedule.timeZone || row.user.timeZone })),
            schedulesTruncated: row.user.schedules.length > 50,
          })),
          nextCursor: rows.length > 50 ? rows[49].id : null,
        };
      },
      { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 10000 }
    );
  }
  private async plan(tx: Tx, actor: Actor, input: Request) {
    const authority = await this.authority(tx, actor, input.organizationId, input.source);
    if (input.source.id === input.successor.id) throw invalid("Select a different successor");
    const successor = await this.active(tx, input.successor);
    const event = await this.event(tx, input.organizationId, input.source, input.eventTypeId);
    const grants = await tx.membership.findMany({
      where: {
        userId: { in: [input.source.id, input.successor.id] },
        teamId: { in: [input.organizationId, event.teamId!] },
      },
      select: grantFields,
      orderBy: { id: "asc" },
    });
    const accepted = (userId: number, teamId: number) =>
      grants.find(
        (grant) =>
          grant.userId === userId && grant.teamId === teamId && grant.accepted && grant.customRoleId === null
      );
    const successorMember = accepted(input.successor.id, event.teamId!);
    if (
      !successorMember ||
      !accepted(input.successor.id, input.organizationId) ||
      !accepted(input.source.id, event.teamId!)
    )
      throw denied();
    const schedule = await tx.schedule.findFirst({
      where: { id: input.successorScheduleId, userId: successor.id },
      select: {
        ...scheduleFields,
        availability: {
          select: { id: true, days: true, startTime: true, endTime: true, date: true },
          orderBy: { id: "asc" },
          take: 501,
        },
      },
    });
    if (!schedule || !schedule.availability.length || schedule.availability.length > 500)
      throw invalid("Choose the successor's configured availability schedule");
    const effectiveTimeZone = schedule.timeZone || successor.timeZone;
    try {
      new Intl.DateTimeFormat("en", { timeZone: effectiveTimeZone });
    } catch {
      throw invalid("The successor availability timezone needs correction");
    }
    const host = event.hosts.find((host) => host.userId === input.source.id);
    const blockers: string[] = [];
    if (!host || !["ROUND_ROBIN", "COLLECTIVE"].includes(event.schedulingType ?? ""))
      blockers.push("unsupported-assignment");
    if (
      event.schedulingType === "MANAGED" ||
      event.parentId !== null ||
      event.children.length ||
      event.assignAllTeamMembers ||
      event.assignRRMembersUsingSegment ||
      event.isInstantEvent ||
      event.recurringEvent !== null ||
      event.seatsPerTimeSlot !== null
    )
      blockers.push("managed-or-special-event");
    if (
      event.hosts.some((row) => row.userId === successor.id) ||
      event.users.some((row) => row.id === successor.id)
    )
      blockers.push("successor-already-assigned");
    if (
      host?.member &&
      (host.member.userId !== input.source.id ||
        host.member.teamId !== event.teamId ||
        !host.member.accepted ||
        host.member.customRoleId !== null)
    )
      blockers.push("inconsistent-host-binding");
    if (
      host?.groupId &&
      !event.hostGroups.some((group) => group.id === host.groupId && group.eventTypeId === event.id)
    )
      blockers.push("inconsistent-host-binding");
    if (host?.schedule && host.schedule.userId !== input.source.id) blockers.push("shared-schedule");
    if (event.hosts.some((row) => row.userId !== input.source.id && row.schedule?.userId === input.source.id))
      blockers.push("shared-schedule");
    if (event.instantMeetingScheduleId || event.restrictionScheduleId) blockers.push("special-schedule");
    if (
      event.profile &&
      (event.profile.organizationId !== input.organizationId || event.profile.userId !== input.source.id)
    )
      blockers.push("shared-profile");
    const successorProfile = event.profileId
      ? await tx.profile.findUnique({
          where: { userId_organizationId: { userId: successor.id, organizationId: input.organizationId } },
          select: { id: true, userId: true, organizationId: true, updatedAt: true },
        })
      : null;
    if (event.profileId && !successorProfile) blockers.push("successor-profile-missing");
    const apps =
      event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
        ? event.metadata.apps
        : null;
    // Disabled app bindings may become active again under the new owner.
    // A configuration handoff must not silently adopt those provider references.
    const configuredApps =
      apps !== null &&
      apps !== undefined &&
      (typeof apps !== "object" || Array.isArray(apps) || Object.keys(apps).length > 0);
    const malformedMetadata =
      event.metadata !== null && (typeof event.metadata !== "object" || Array.isArray(event.metadata));
    const providerLocation =
      event.locations !== null &&
      (!Array.isArray(event.locations) ||
        event.locations.some(
          (location) =>
            !location ||
            typeof location !== "object" ||
            Array.isArray(location) ||
            !["inPerson", "link"].includes(String(location.type))
        ));
    if (
      event.destinationCalendar ||
      event.selectedCalendars.length ||
      event.useEventLevelSelectedCalendars ||
      event.useEventTypeDestinationCalendarEmail ||
      event.enablePerHostLocations ||
      host?.location ||
      event.secondaryEmailId ||
      event.customReplyToEmail ||
      configuredApps ||
      malformedMetadata ||
      providerLocation ||
      event.price > 0 ||
      event.webhooks.some((hook) => hook.userId === input.source.id || hook.platformOAuthClientId !== null)
    )
      blockers.push("provider-configuration");
    // No existing appointment is re-owned by this configuration command. This
    // also covers collective guests and historical email changes without guessing.
    const futureBookings = await tx.booking.findMany({
      where: {
        eventTypeId: event.id,
        endTime: { gt: new Date() },
        status: { in: ["ACCEPTED", "PENDING", "AWAITING_HOST"] },
      },
      select: { id: true, userId: true, endTime: true, status: true },
      orderBy: { id: "asc" },
      take: 501,
    });
    if (futureBookings.length) blockers.push("future-appointments");
    if (
      event.userId === input.source.id &&
      (await tx.eventType.findFirst({
        where: { userId: successor.id, slug: event.slug, id: { not: event.id } },
        select: { id: true },
      }))
    )
      blockers.push("successor-address-conflict");
    const effects = {
      hostSlotsReplaced: host ? 1 : 0,
      eventOwnerChanged: event.userId === input.source.id ? 1 : 0,
      legacyHostLinksChanged: event.users.some((user) => user.id === input.source.id) ? 1 : 0,
      organizationProfileChanged: event.profileId ? 1 : 0,
      eventScheduleChanged: event.schedule?.userId === input.source.id ? 1 : 0,
      existingAppointmentsChanged: 0,
      credentialsTransferred: 0,
      futureAppointmentsBlocking: futureBookings.length,
    };
    const reviewHash = hash({
      version: 1,
      actor,
      input,
      authority,
      event,
      grants,
      successor,
      schedule,
      successorProfile,
      futureBookings,
      effects,
      blockers,
    });
    return {
      reviewHash,
      blockers: Array.from(new Set(blockers)),
      effects,
      event,
      host,
      schedule,
      successor,
      successorMember,
      successorProfile,
    };
  }
  async review(actor: Actor, raw: z.input<typeof handoffReviewInput>) {
    actor = identity.parse(actor);
    const input = handoffReviewInput.parse(raw);
    return this.db.$transaction(
      async (tx) => {
        const { reviewHash, blockers, effects, event, schedule, successor } = await this.plan(
          tx,
          actor,
          input
        );
        return {
          input: { ...input, reviewHash, requestId: randomUUID() },
          blockers,
          effects,
          event: {
            id: event.id,
            title: event.title,
            slug: event.slug,
            teamId: event.teamId,
            schedulingType: event.schedulingType,
          },
          successor: { id: successor.id, name: successor.name, email: successor.email },
          schedule: {
            id: schedule.id,
            name: schedule.name,
            timeZone: schedule.timeZone || successor.timeZone,
          },
        };
      },
      { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 15000 }
    );
  }
  async commit(actor: Actor, raw: z.input<typeof handoffCommitInput>) {
    actor = identity.parse(actor);
    const input = handoffCommitInput.parse(raw);
    const action = "organization.scheduling.handoff";
    const operationHash = hash({ version: 1, actor, action, input });
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Team" WHERE id=${input.organizationId} FOR UPDATE`;
        const userIds = Array.from(new Set([actor.id, input.source.id, input.successor.id])).sort(
          (a, b) => a - b
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(userIds)}) ORDER BY id FOR UPDATE`
        );
        await this.active(tx, actor);
        const prior = await tx.enterpriseAuditEvent.findUnique({
          where: { operationId: input.requestId },
          select: { action: true, actorUserId: true, operationHash: true },
        });
        if (prior) {
          if (
            prior.action !== action ||
            prior.actorUserId !== actor.id ||
            prior.operationHash !== operationHash
          )
            throw invalid("This operation identifier already belongs to another request");
          return { recorded: true, replayed: true };
        }
        await tx.$queryRaw`SELECT id FROM "EventType" WHERE id=${input.eventTypeId} FOR UPDATE`;
        await tx.$queryRaw`SELECT "userId" FROM "Host" WHERE "eventTypeId"=${input.eventTypeId} ORDER BY "userId" FOR UPDATE`;
        const request = {
          organizationId: input.organizationId,
          source: input.source,
          eventTypeId: input.eventTypeId,
          successor: input.successor,
          successorScheduleId: input.successorScheduleId,
        };
        const planned = await this.plan(tx, actor, request);
        if (planned.reviewHash !== input.reviewHash)
          throw invalid("Scheduling, membership or availability changed; review the handoff again");
        if (planned.blockers.length || !planned.host)
          throw invalid("Resolve the displayed appointment or configuration blockers before handoff");
        const { event, host, schedule, successorMember, successorProfile, effects } = planned;
        await tx.host.delete({
          where: { userId_eventTypeId: { userId: input.source.id, eventTypeId: event.id } },
          select: { userId: true },
        });
        await tx.host.create({
          data: {
            eventTypeId: event.id,
            userId: input.successor.id,
            memberId: successorMember.id,
            scheduleId: schedule.id,
            isFixed: host.isFixed,
            priority: host.priority,
            weight: host.weight,
            weightAdjustment: host.weightAdjustment,
            groupId: host.groupId,
          },
          select: { userId: true },
        });
        await tx.eventType.update({
          where: { id: event.id },
          data: {
            ...(effects.eventOwnerChanged ? { owner: { connect: { id: input.successor.id } } } : {}),
            ...(effects.legacyHostLinksChanged
              ? { users: { disconnect: { id: input.source.id }, connect: { id: input.successor.id } } }
              : {}),
            ...(effects.organizationProfileChanged && successorProfile
              ? { profile: { connect: { id: successorProfile.id } } }
              : {}),
            ...(effects.eventScheduleChanged ? { schedule: { connect: { id: schedule.id } } } : {}),
          },
          select: { id: true },
        });
        await tx.enterpriseAuditEvent.create({
          data: {
            operationId: input.requestId,
            operationHash,
            action,
            actorUserId: actor.id,
            organizationId: input.organizationId,
            entityId: event.id,
            details: {
              version: 1,
              sourceUserId: input.source.id,
              successorUserId: input.successor.id,
              successorScheduleId: schedule.id,
              effects,
              bookingIdsUnchanged: true,
              providerCredentialsTransferred: false,
            },
          },
          select: { id: true },
        });
        return { recorded: true, replayed: false };
        // Waiters must read the booking winner after the existing User locks; a
        // pre-lock repeatable snapshot could miss a just-committed appointment.
      },
      { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15000 }
    );
  }
}
