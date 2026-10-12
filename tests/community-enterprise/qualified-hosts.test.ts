// SPDX-License-Identifier: MIT

import { CommunityQualifiedHostsService } from "@calcom/features/community-enterprise/scheduling/QualifiedHostsService";
import { getQualifiedHostsService } from "@calcom/features/di/containers/QualifiedHosts";
import { createContainer } from "@calcom/features/di/di";
import { qualifiedHostsModule } from "@calcom/features/di/modules/QualifiedHosts";
import { DI_TOKENS } from "@calcom/features/di/tokens";
import { describe, expect, it, vi } from "vitest";

vi.mock("@calcom/prisma", () => ({ default: {} }));

function fixture() {
  const users = [1, 2, 3, 4].map((id) => ({
    id,
    email: `host${id}@example.test`,
    locked: false,
    allowDynamicBooking: true,
    credentials: [],
  }));
  const event = {
    id: 50,
    teamId: 10,
    userId: null,
    schedulingType: "ROUND_ROBIN",
    rescheduleWithSameRoundRobinHost: false,
    assignAllTeamMembers: false,
    assignRRMembersUsingSegment: false,
    parent: null,
    hosts: [1, 2].map((userId) => ({ userId, isFixed: false, groupId: null })),
    users: [],
  };
  const memberships = users.flatMap((user) =>
    [10, 100].map((teamId) => ({ userId: user.id, teamId, accepted: true }))
  );
  const f = {
    users,
    event,
    memberships,
    original: { userId: 2, eventTypeId: 50, status: "ACCEPTED" },
    team: {
      id: 10,
      parentId: 100,
      isOrganization: false,
      parent: { id: 100, parentId: null, isOrganization: true },
    },
    unavailable: false,
    snapshotReads: 0,
  };
  const db = {
    eventType: {
      findUnique: async () => {
        if (f.unavailable) throw new Error("Unavailable store");
        return f.event;
      },
    },
    user: {
      findMany: async () => {
        f.snapshotReads++;
        return f.users.filter((user) => !user.locked);
      },
    },
    team: { findUnique: async () => f.team },
    membership: { findMany: async () => f.memberships.filter((member) => member.accepted) },
    booking: {
      findUnique: async ({ where }: { where: { uid: string } }) =>
        where.uid === "original" ? f.original : null,
    },
    bookingSeat: {
      findUnique: async ({ where }: { where: { referenceUid: string } }) =>
        where.referenceUid === "seat" ? { booking: f.original } : null,
    },
  };
  // The unit seam mirrors only selected database columns. Database-backed tests
  // independently execute these queries against the generated Prisma client.
  const service = new CommunityQualifiedHostsService(
    db as unknown as ConstructorParameters<typeof CommunityQualifiedHostsService>[0]
  );
  const query = () => ({
    eventType: {
      ...f.event,
      users: f.users,
      hosts: f.event.hosts.map((host) => ({ ...host, user: f.users.find((u) => u.id === host.userId)! })),
    },
  });
  return { ...f, state: f, service, query };
}
const rr = (
  result: Awaited<ReturnType<CommunityQualifiedHostsService["findQualifiedHostsWithDelegationCredentials"]>>
) => result.qualifiedRRHosts.map((host) => host.user.id);

describe("shared qualified hosts", () => {
  it("keeps eligible RR alternatives, never converts them to required hosts", async () => {
    const f = fixture();
    const result = await f.service.findQualifiedHostsWithDelegationCredentials(f.query());
    expect(rr(result)).toEqual([1, 2]);
    expect(result.fixedHosts).toEqual([]);
  });
  it("normalizes legacy users-only RR events", async () => {
    const f = fixture();
    f.state.event.hosts = [];
    f.state.event.users = [{ id: 1 }, { id: 2 }] as never;
    expect(rr(await f.service.findQualifiedHostsWithDelegationCredentials(f.query()))).toEqual([1, 2]);
  });
  it("routing must not widen on no match", async () => {
    const f = fixture();
    const result = await f.service.findQualifiedHostsWithDelegationCredentials({
      ...f.query(),
      routedTeamMemberIds: [999],
    });
    expect(rr(result)).toEqual([]);
    expect(result.allFallbackRRHosts).toEqual([]);
    expect(result.fixedHosts).toEqual([]);
  });
  it("fallback stays inside routed and subset intersection", async () => {
    const f = fixture();
    const result = await f.service.findQualifiedHostsWithDelegationCredentials({
      ...f.query(),
      routedTeamMemberIds: [1, 2],
      rrHostSubsetIds: [2, 999],
    });
    expect(rr(result)).toEqual([2]);
    expect(result.allFallbackRRHosts.map((h) => h.user.id)).toEqual([2]);
  });
  it("disjoint routing and subset yields no booking", async () => {
    const f = fixture();
    expect(
      rr(
        await f.service.findQualifiedHostsWithDelegationCredentials({
          ...f.query(),
          routedTeamMemberIds: [1],
          rrHostSubsetIds: [2],
        })
      )
    ).toEqual([]);
  });
  it("empty routing follows the existing no-reroute contract", async () => {
    const f = fixture();
    expect(
      rr(
        await f.service.findQualifiedHostsWithDelegationCredentials({ ...f.query(), routedTeamMemberIds: [] })
      )
    ).toEqual([1, 2]);
  });
  it("owner matching is normalized but never crosses an explicit route", async () => {
    const f = fixture();
    expect(
      rr(
        await f.service.findQualifiedHostsWithDelegationCredentials({
          ...f.query(),
          contactOwnerEmail: " HOST2@EXAMPLE.TEST ",
        })
      )
    ).toEqual([2]);
    expect(
      rr(
        await f.service.findQualifiedHostsWithDelegationCredentials({
          ...f.query(),
          contactOwnerEmail: "host2@example.test",
          routedTeamMemberIds: [1],
        })
      )
    ).toEqual([1]);
  });
  it("an unknown owner does not silently become the full team", async () => {
    const f = fixture();
    expect(
      rr(
        await f.service.findQualifiedHostsWithDelegationCredentials({
          ...f.query(),
          contactOwnerEmail: "unknown@example.test",
        })
      )
    ).toEqual([]);
  });
  it("same-host reschedule uses the actual booked organizer", async () => {
    const f = fixture();
    f.state.event.rescheduleWithSameRoundRobinHost = true;
    expect(
      rr(
        await f.service.findQualifiedHostsWithDelegationCredentials({
          ...f.query(),
          rescheduleUid: "original",
        })
      )
    ).toEqual([2]);
  });
  it("explicit rerouting overrides same-host, without reviving other hosts", async () => {
    const f = fixture();
    f.state.event.rescheduleWithSameRoundRobinHost = true;
    expect(
      rr(
        await f.service.findQualifiedHostsWithDelegationCredentials({
          ...f.query(),
          rescheduleUid: "original",
          routedTeamMemberIds: [1],
        })
      )
    ).toEqual([1]);
  });
  it.each([
    "wrong-event",
    "cancelled",
    "missing",
    "locked",
    "removed",
  ])("same-host rejects %s original authority", async (scenario) => {
    const f = fixture();
    f.state.event.rescheduleWithSameRoundRobinHost = true;
    if (scenario === "wrong-event") f.state.original.eventTypeId = 51;
    if (scenario === "cancelled") f.state.original.status = "CANCELLED";
    if (scenario === "locked") f.state.users[1].locked = true;
    if (scenario === "removed")
      f.state.memberships.find((m) => m.userId === 2 && m.teamId === 100)!.accepted = false;
    expect(
      rr(
        await f.service.findQualifiedHostsWithDelegationCredentials({
          ...f.query(),
          rescheduleUid: scenario === "missing" ? "missing" : "original",
        })
      )
    ).toEqual([]);
  });
  it("reschedule seat UID is bound to the same booking event", async () => {
    const f = fixture();
    f.state.event.rescheduleWithSameRoundRobinHost = true;
    expect(
      rr(await f.service.findQualifiedHostsWithDelegationCredentials({ ...f.query(), rescheduleUid: "seat" }))
    ).toEqual([2]);
    f.state.original.eventTypeId = 99;
    expect(
      rr(await f.service.findQualifiedHostsWithDelegationCredentials({ ...f.query(), rescheduleUid: "seat" }))
    ).toEqual([]);
  });
  it("current membership removal affects an existing service and stale event payload", async () => {
    const f = fixture();
    const input = f.query();
    expect(rr(await f.service.findQualifiedHostsWithDelegationCredentials(input))).toEqual([1, 2]);
    f.state.memberships.find((m) => m.userId === 2 && m.teamId === 10)!.accepted = false;
    expect(rr(await f.service.findQualifiedHostsWithDelegationCredentials(input))).toEqual([1]);
    expect(f.state.snapshotReads).toBe(2);
  });
  it("current host-assignment removal defeats a stale source payload", async () => {
    const f = fixture();
    const input = f.query();
    f.state.event.hosts = [f.state.event.hosts[0]];
    expect(rr(await f.service.findQualifiedHostsWithDelegationCredentials(input))).toEqual([1]);
  });
  it("collective requires all configured participants after member removal", async () => {
    const f = fixture();
    f.state.event.schedulingType = "COLLECTIVE";
    const first = await f.service.findQualifiedHostsWithDelegationCredentials(f.query());
    expect(first.fixedHosts.map((h) => h.user.id)).toEqual([1, 2]);
    f.state.users[1].locked = true;
    const result = await f.service.findQualifiedHostsWithDelegationCredentials(f.query());
    expect(result.fixedHosts).toEqual([]);
  });
  it("a missing required fixed host prevents an RR meeting", async () => {
    const f = fixture();
    f.state.event.hosts[0].isFixed = true;
    const result = await f.service.findQualifiedHostsWithDelegationCredentials({
      ...f.query(),
      eligibleUserIds: [2],
    });
    expect(result.fixedHosts).toEqual([]);
    expect(rr(result)).toEqual([]);
  });
  it("routing preserves required fixed participants", async () => {
    const f = fixture();
    f.state.event.hosts[0].isFixed = true;
    const result = await f.service.findQualifiedHostsWithDelegationCredentials({
      ...f.query(),
      routedTeamMemberIds: [2],
    });
    expect(result.fixedHosts.map((h) => h.user.id)).toEqual([1]);
    expect(rr(result)).toEqual([2]);
  });
  it("losing an entire named RR group cannot shrink the meeting", async () => {
    const f = fixture();
    f.state.event.hosts[0].groupId = "a" as never;
    f.state.event.hosts[1].groupId = "b" as never;
    expect(
      rr(
        await f.service.findQualifiedHostsWithDelegationCredentials({
          ...f.query(),
          routedTeamMemberIds: [1],
        })
      )
    ).toEqual([]);
  });
  it("database failure is not converted into an allow", async () => {
    const f = fixture();
    f.state.unavailable = true;
    await expect(f.service.findQualifiedHostsWithDelegationCredentials(f.query())).rejects.toThrow(
      "Unavailable store"
    );
  });
  it("unimplemented automatic expansion fails explicitly", async () => {
    const f = fixture();
    f.state.event.assignAllTeamMembers = true;
    await expect(f.service.findQualifiedHostsWithDelegationCredentials(f.query())).rejects.toMatchObject({
      statusCode: 400,
    });
  });
  it("invalid restriction cannot reach the permissive path", async () => {
    const f = fixture();
    await expect(
      f.service.findQualifiedHostsWithDelegationCredentials({ ...f.query(), routedTeamMemberIds: [0] })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

it("availability DI and booking getter resolve the exact same shared service", () => {
  const container = createContainer();
  container.load(DI_TOKENS.QUALIFIED_HOSTS_SERVICE_MODULE, qualifiedHostsModule);
  expect(container.get(DI_TOKENS.QUALIFIED_HOSTS_SERVICE)).toBe(getQualifiedHostsService());
});
it("rerouting cannot attach a booking from another event", async () => {
  const f = fixture();
  f.state.original.eventTypeId = 99;
  expect(
    rr(
      await f.service.findQualifiedHostsWithDelegationCredentials({
        ...f.query(),
        rescheduleUid: "original",
        routedTeamMemberIds: [1],
      })
    )
  ).toEqual([]);
});
it("cancelled-booking rebooking requires the live event's explicit setting", async () => {
  const f = fixture();
  f.state.event.rescheduleWithSameRoundRobinHost = true;
  f.state.original.status = "CANCELLED";
  Object.assign(f.state.event, { allowReschedulingCancelledBookings: true });
  expect(
    rr(
      await f.service.findQualifiedHostsWithDelegationCredentials({ ...f.query(), rescheduleUid: "original" })
    )
  ).toEqual([2]);
});
it("malformed host restrictions fail with a controlled error", async () => {
  const f = fixture();
  await expect(
    f.service.findQualifiedHostsWithDelegationCredentials({
      ...f.query(),
      routedTeamMemberIds: "not-an-array" as never,
    })
  ).rejects.toMatchObject({ statusCode: 400 });
});
