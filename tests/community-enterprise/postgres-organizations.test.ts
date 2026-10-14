// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { OrganizationProvisioningService } from "@calcom/features/community-enterprise/organizations/OrganizationProvisioningService";
import { TeamService } from "@calcom/features/community-enterprise/teams/TeamService";
import { ProfileRepository } from "@calcom/features/profile/repositories/ProfileRepository";
import prisma from "@calcom/prisma";
import { afterAll, beforeAll, beforeEach, test } from "vitest";

const service = new OrganizationProvisioningService(prisma);
const uuids = Array.from({ length: 7 }, () => randomUUID());
const actor = { id: 1, uuid: uuids[1] };
const ref = (id: number) => ({ id, uuid: uuids[id] });
const details = { name: "Community One", slug: "community-one", timeZone: "Asia/Kuala_Lumpur" };
const input = (changes = {}) => ({
  ...details,
  owner: ref(2),
  members: [ref(3)],
  requestId: randomUUID(),
  ...changes,
});
const review = (changes = {}) => ({
  ...details,
  ownerEmail: "person2@fixture.test",
  memberEmails: ["person3@fixture.test"],
  ...changes,
});
let verified = false;

beforeAll(async () => {
  const socket = process.env.CAL_ENTERPRISE_TEST_SOCKET;
  const directory = process.env.CAL_ENTERPRISE_TEST_PGDATA;
  assert.ok(socket && directory, "Use the disposable PostgreSQL runner, never a configured application DB");
  assert.equal(path.dirname(socket), path.dirname(directory));
  assert.match(path.basename(path.dirname(socket)), /^cal-enterprise-/);
  const rows = await prisma.$queryRaw<
    Array<{ directory: string; actor: string }>
  >`SELECT current_setting('data_directory') AS directory, current_user::text AS actor`;
  assert.equal(rows[0].directory, directory);
  assert.equal(rows[0].actor, "cal_enterprise_test");
  assert.equal(await prisma.user.count(), 0);
  verified = true;
});
beforeEach(async () => {
  assert.ok(verified);
  await prisma.$executeRawUnsafe('TRUNCATE "users", "Team", "EnterpriseAuditEvent" RESTART IDENTITY CASCADE');
  for (let id = 1; id <= 6; id++)
    await prisma.user.create({
      data: {
        id,
        uuid: uuids[id],
        username: `person-${id}`,
        name: `Fixture person ${id}`,
        email: `person${id}@fixture.test`,
        role: id === 1 || id === 6 ? "ADMIN" : "USER",
        locked: id === 5,
        isPlatformManaged: id === 4,
      },
    });
});
afterAll(async () => {
  await prisma.$disconnect();
});
const state = async () => ({
  teams: await prisma.team.count(),
  memberships: await prisma.membership.count(),
  profiles: await prisma.profile.count(),
  settings: await prisma.organizationSettings.count(),
  audits: await prisma.enterpriseAuditEvent.count(),
});
const empty = { teams: 0, memberships: 0, profiles: 0, settings: 0, audits: 0 };

// Current operator checks are repeated in the service, not inferred from a UI flag.
for (const id of [2, 3, 4, 5, 999])
  test(`non-operator ${id} cannot review or create an organization`, async () => {
    const identity = { id, uuid: uuids[id] || randomUUID() };
    assert.equal((await service.capabilities(identity)).canProvision, false);
    await assert.rejects(service.review(identity, review()), /current active instance operator/);
    await assert.rejects(service.provision(identity, input()), /current active instance operator/);
    assert.deepEqual(await state(), empty);
  });
test("stale operator UUID and locked operator cannot act", async () => {
  await assert.rejects(
    service.provision({ ...actor, uuid: randomUUID() }, input()),
    /current active instance operator/
  );
  await prisma.user.update({ where: { id: 1 }, data: { locked: true } });
  await assert.rejects(service.provision(actor, input()), /current active instance operator/);
  assert.deepEqual(await state(), empty);
});
test("review resolves only named existing accounts and does not write", async () => {
  const proposal = await service.review(actor, review({ ownerEmail: "PERSON2@fixture.test" }));
  assert.deepEqual(
    proposal.accounts.map((row) => [row.id, row.role]),
    [
      [2, "OWNER"],
      [3, "MEMBER"],
    ]
  );
  assert.deepEqual(proposal.input.owner, ref(2));
  assert.deepEqual(proposal.input.members, [ref(3)]);
  assert.deepEqual(await state(), empty);
});
for (const changes of [
  { ownerEmail: "absent@fixture.test" },
  { ownerEmail: "person5@fixture.test" },
  { ownerEmail: "person4@fixture.test" },
  { memberEmails: ["person2@fixture.test"] },
])
  test(`review rejects unavailable or duplicate account ${JSON.stringify(changes)}`, async () => {
    await assert.rejects(service.review(actor, review(changes)));
    assert.deepEqual(await state(), empty);
  });
test("case-ambiguous account emails are not guessed", async () => {
  await prisma.user.update({ where: { id: 3 }, data: { email: "PERSON2@fixture.test" } });
  await assert.rejects(
    service.review(actor, review({ memberEmails: [] })),
    /one active existing human account/
  );
});
test("creates root, closed settings, explicit owner/members/profiles and atomic audit", async () => {
  const request = input();
  const result = await service.provision(actor, request);
  assert.equal(result.replayed, false);
  const org = await prisma.team.findUniqueOrThrow({
    where: { id: result.organizationId },
    select: {
      slug: true,
      parentId: true,
      isOrganization: true,
      isPrivate: true,
      pendingPayment: true,
      organizationSettings: true,
      members: {
        orderBy: { userId: "asc" },
        select: { userId: true, role: true, accepted: true, customRoleId: true },
      },
      orgProfiles: { select: { userId: true, username: true, uid: true } },
    },
  });
  assert.equal(org.isOrganization, true);
  assert.equal(org.parentId, null);
  assert.equal(org.isPrivate, true);
  assert.equal(org.pendingPayment, false);
  assert.deepEqual(org.members, [
    { userId: 2, role: "OWNER", accepted: true, customRoleId: null },
    { userId: 3, role: "MEMBER", accepted: true, customRoleId: null },
  ]);
  assert.equal(org.organizationSettings?.orgAutoJoinOnSignup, false);
  assert.equal(org.organizationSettings?.orgAutoAcceptEmail, "");
  for (const field of [
    "isOrganizationVerified",
    "isAdminReviewed",
    "isAdminAPIEnabled",
    "allowSEOIndexing",
    "orgProfileRedirectsToVerifiedDomain",
  ] as const)
    assert.equal(org.organizationSettings?.[field], false);
  assert.equal(org.orgProfiles.length, 2);
  assert.equal(
    org.members.some((row) => row.userId === actor.id),
    false
  );
  assert.equal(
    (await prisma.enterpriseAuditEvent.findUniqueOrThrow({ where: { operationId: request.requestId } }))
      .action,
    "organization.provisioned"
  );
  assert.deepEqual(await state(), { teams: 1, memberships: 2, profiles: 2, settings: 1, audits: 1 });
  const ownerOverview = await new TeamService(prisma).overview(2);
  assert.equal(ownerOverview[0].canManage, true);
  assert.equal((await new TeamService(prisma).overview(1)).length, 0);
  const team = await new TeamService(prisma).createTeam(2, {
    organizationId: result.organizationId,
    name: "Mentors",
    slug: "mentors",
    timeZone: "UTC",
    requestId: randomUUID(),
  });
  assert.ok(team.teamId);
  await assert.rejects(
    new TeamService(prisma).createTeam(3, {
      organizationId: result.organizationId,
      name: "Denied",
      slug: "denied",
      timeZone: "UTC",
      requestId: randomUUID(),
    })
  );
});
test("multi-organization admission preserves personal identity and previous grants", async () => {
  const before = await prisma.user.findUniqueOrThrow({ where: { id: 2 } });
  await prisma.credential.create({
    data: { id: 100, type: "fixture", key: { ciphertext: "synthetic-placeholder" }, userId: 2 },
  });
  const first = await service.provision(actor, input());
  const second = await service.provision(actor, input({ name: "Other", slug: "other", members: [] }));
  assert.notEqual(first.organizationId, second.organizationId);
  assert.equal(await prisma.profile.count({ where: { userId: 2 } }), 2);
  assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: 2 } }), before);
  assert.equal(
    (await prisma.credential.findUniqueOrThrow({ where: { id: 100 }, select: { userId: true } })).userId,
    2
  );
  assert.equal(await prisma.account.count(), 0);
});
test("profile fallback does not derive a private email localpart", async () => {
  await prisma.user.update({
    where: { id: 2 },
    data: { username: null, email: "private-personal-address@fixture.test" },
  });
  const created = await service.provision(actor, input({ members: [] }));
  assert.equal(
    (await prisma.profile.findFirstOrThrow({ where: { organizationId: created.organizationId } })).username,
    "member-2"
  );
});
for (const change of ["uuid", "locked", "deleted", "managed"] as const)
  test(`target ${change} after review prevents writes`, async () => {
    const reviewed = await service.review(actor, review());
    if (change === "deleted") await prisma.user.delete({ where: { id: 2 } });
    else
      await prisma.user.update({
        where: { id: 2 },
        data:
          change === "uuid"
            ? { uuid: randomUUID() }
            : change === "locked"
              ? { locked: true }
              : { isPlatformManaged: true },
      });
    await assert.rejects(service.provision(actor, reviewed.input), /account changed|unavailable/);
    assert.deepEqual(await state(), empty);
  });
test("operator demotion after review is observed before mutation", async () => {
  const reviewed = await service.review(actor, review());
  await prisma.user.update({ where: { id: 1 }, data: { role: "USER" } });
  await assert.rejects(service.provision(actor, reviewed.input), /current active instance operator/);
  assert.deepEqual(await state(), empty);
});
for (const pendingPayment of [false, true])
  test(`existing root address is respected even when pendingPayment=${pendingPayment}`, async () => {
    await prisma.team.create({
      data: { name: "Reserved", slug: "COMMUNITY-ONE", isOrganization: true, pendingPayment },
    });
    await assert.rejects(service.provision(actor, input()), /address is already reserved/);
    assert.equal(await prisma.enterpriseAuditEvent.count(), 0);
  });
test("same request is idempotent even when member input order differs", async () => {
  const request = input({ members: [ref(3), ref(6)] });
  const first = await service.provision(actor, request);
  assert.deepEqual(await service.provision(actor, { ...request, members: [ref(6), ref(3)] }), {
    ...first,
    replayed: true,
  });
  assert.equal(await prisma.enterpriseAuditEvent.count(), 1);
  await assert.rejects(service.provision(actor, { ...request, name: "different" }), /already used/);
  await assert.rejects(service.provision(ref(6), request), /already used/);
});
test("competing duplicate requests yield one organization and one audit", async () => {
  const request = input();
  const results = await Promise.all([service.provision(actor, request), service.provision(actor, request)]);
  assert.equal(results[0].organizationId, results[1].organizationId);
  assert.equal(results.filter((row) => row.replayed).length, 1);
  assert.deepEqual(await state(), { teams: 1, memberships: 2, profiles: 2, settings: 1, audits: 1 });
});
test("different requests racing for the same root address cannot create duplicate tenants", async () => {
  const results = await Promise.allSettled([
    service.provision(actor, input()),
    service.provision(ref(6), input({ owner: ref(6), members: [] })),
  ]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(await prisma.team.count(), 1);
  assert.equal(await prisma.enterpriseAuditEvent.count(), 1);
});
for (const removed of ["organization", "membership", "profile"])
  test(`replay never resurrects a removed ${removed}`, async () => {
    const request = input();
    const created = await service.provision(actor, request);
    if (removed === "organization") await prisma.team.delete({ where: { id: created.organizationId } });
    if (removed === "membership")
      await prisma.membership.deleteMany({ where: { teamId: created.organizationId, userId: 2 } });
    if (removed === "profile")
      await prisma.profile.deleteMany({ where: { organizationId: created.organizationId, userId: 2 } });
    const before = await state();
    await assert.rejects(service.provision(actor, request), /admission state changed/);
    assert.deepEqual(await state(), before);
  });
test("actual audit constraint failure rolls back all provisioning writes", async () => {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "EnterpriseAuditEvent" ADD CONSTRAINT fixture_provision_audit_failure CHECK (action <> 'organization.provisioned')`
  );
  try {
    await assert.rejects(service.provision(actor, input()));
    assert.deepEqual(await state(), empty);
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "EnterpriseAuditEvent" DROP CONSTRAINT fixture_provision_audit_failure'
    );
  }
});
test("profile username collision rolls back settings, memberships and root", async () => {
  await prisma.user.update({ where: { id: 3 }, data: { username: "person-2" } });
  await assert.rejects(service.provision(actor, input()), /profile conflicts/);
  assert.deepEqual(await state(), empty);
});
for (const changes of [
  { owner: ref(2), members: [ref(2)] },
  { slug: "../foreign" },
  { timeZone: "not-a-zone" },
  { role: "ADMIN" },
  { organizationSettings: { orgAutoJoinOnSignup: true } },
  { owner: { ...ref(2), role: "ADMIN" } },
  { actorId: 6 },
])
  test(`invalid or authority-expanding input is denied ${JSON.stringify(changes)}`, async () => {
    await assert.rejects(service.provision(actor, input(changes)));
    assert.deepEqual(await state(), empty);
  });

test("retained profile lookup scopes equal usernames to the exact root organization", async () => {
  const a = await service.provision(actor, input({ members: [] }));
  const b = await service.provision(actor, input({ slug: "other", name: "Other", members: [] }));
  const matches = await ProfileRepository.findManyByOrgSlugOrRequestedSlug({
    usernames: ["person-2"],
    orgSlug: "community-one",
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].organizationId, a.organizationId);
  assert.notEqual(matches[0].organizationId, b.organizationId);
  assert.deepEqual(
    await ProfileRepository.findManyByOrgSlugOrRequestedSlug({ usernames: ["person-2"], orgSlug: "absent" }),
    []
  );
  assert.deepEqual(
    await ProfileRepository.findManyByOrgSlugOrRequestedSlug({ usernames: ["person-2"], orgSlug: "" }),
    []
  );
});
test("ambiguous root organization lookup denies rather than selecting a tenant", async () => {
  await service.provision(actor, input({ members: [] }));
  await prisma.team.create({
    data: { name: "Ambiguous legacy", slug: "community-one", parentId: null, isOrganization: true },
  });
  assert.deepEqual(
    await ProfileRepository.findManyByOrgSlugOrRequestedSlug({
      usernames: ["person-2"],
      orgSlug: "community-one",
    }),
    []
  );
});

test("root-address serialization is observed in PostgreSQL before either competitor finishes", async () => {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  const observed = prisma.$extends({
    query: {
      team: {
        async findFirst({ args, query }) {
          const result = await query(args);
          if (first && args.where?.parentId === null) {
            first = false;
            enter();
            await held;
          }
          return result;
        },
      },
    },
  });
  const subject = new OrganizationProvisioningService(observed as unknown as typeof prisma);
  const a = subject.provision(actor, input());
  await entered;
  const b = service.provision(ref(6), input({ owner: ref(6), members: [] }));
  const bResult = b.then(
    (value) => ({ value }),
    (error) => ({ error })
  );
  let waiting = false;
  try {
    const deadline = Date.now() + 5000;
    while (!waiting && Date.now() < deadline) {
      const locks = await prisma.$queryRaw<
        Array<{ count: number }>
      >`SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND classid=hashtext('cal.organization.provision.slug')::oid AND objid=hashtext('community-one')::oid AND NOT granted`;
      waiting = locks[0].count > 0;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(waiting, "The second writer must actually wait on the same root-address lock");
  } finally {
    release();
  }
  await a;
  const rejected = await bResult;
  assert.ok("error" in rejected);
  assert.equal(await prisma.team.count(), 1);
  assert.equal(await prisma.enterpriseAuditEvent.count(), 1);
});

test("a member's UUID profile never carries another person's owner membership as authority", async () => {
  const created = await service.provision(actor, input());
  const memberProfile = await prisma.profile.findFirstOrThrow({
    where: { organizationId: created.organizationId, userId: 3 },
    select: { uid: true },
  });
  const member = await ProfileRepository.findByUpIdWithAuth(`prof-${memberProfile.uid}`, 3);
  assert.ok(member?.organization);
  assert.deepEqual(
    member.organization.members.map((row) => ({ userId: row.userId, role: row.role })),
    [{ userId: 3, role: "MEMBER" }]
  );
  assert.equal(
    member.organization.members.some((row) => ["OWNER", "ADMIN"].includes(row.role)),
    false
  );
});

test("the authenticated owner retains its own role when selecting another authorized member profile", async () => {
  const created = await service.provision(actor, input());
  const memberProfile = await prisma.profile.findFirstOrThrow({
    where: { organizationId: created.organizationId, userId: 3 },
    select: { uid: true, id: true },
  });
  for (const upId of [`prof-${memberProfile.uid}`, String(memberProfile.id)]) {
    const selected = await ProfileRepository.findByUpIdWithAuth(upId, 2);
    assert.ok(selected?.organization);
    assert.deepEqual(
      selected.organization.members.map((row) => ({ userId: row.userId, role: row.role })),
      [{ userId: 2, role: "OWNER" }]
    );
  }
});
