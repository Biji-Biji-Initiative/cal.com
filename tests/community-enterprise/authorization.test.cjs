// SPDX-License-Identifier: MIT
// Isolated tests of production policy/adapter and authenticated middleware seams.
// No application bootstrap, environment files, sockets, or live database are used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const { z } = require("zod");
const { TRPCError } = require("@trpc/server");
const ROOT = path.resolve(__dirname, "../..");
const AUTH = "packages/features/community-enterprise/authorization/";
const roles = { MEMBER: "MEMBER", ADMIN: "ADMIN", OWNER: "OWNER" };

function compile(text, imports = {}) {
  const output = ts.transpileModule(text, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const restrictedRequire = (name) => {
    if (!Object.hasOwn(imports, name)) throw new Error("Unexpected test dependency: " + name);
    return imports[name];
  };
  new Function("require", "module", "exports", output)(restrictedRequire, module, module.exports);
  return module.exports;
}
function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}
const policyModule = compile(read(AUTH + "PermissionPolicy.ts"));
const { PermissionCheckService } = compile(read(AUTH + "PermissionCheckService.ts"), {
  "@calcom/prisma": { __esModule: true, default: undefined },
  "./PermissionPolicy": policyModule,
});
function membership(userId, teamId, role = "MEMBER", extra = {}) {
  return { userId, teamId, role, accepted: true, customRoleId: null, customRole: null, ...extra };
}
function fixture() {
  const f = {
    users: [
      { id: 1, locked: false },
      { id: 2, locked: false },
      { id: 3, locked: false },
    ],
    teams: [
      { id: 100, parentId: null, isOrganization: true },
      { id: 200, parentId: null, isOrganization: true },
      { id: 10, parentId: 100, isOrganization: false },
      { id: 11, parentId: 100, isOrganization: false },
      { id: 20, parentId: 200, isOrganization: false },
      { id: 30, parentId: null, isOrganization: false },
    ],
    memberships: [
      membership(1, 100),
      membership(1, 10, "OWNER"),
      membership(2, 200),
      membership(2, 20, "OWNER"),
    ],
    queries: [],
    writes: [],
    failure: false,
    event: { id: 42, teamId: 10, userId: null, users: [] },
  };
  const check = (model, query) => {
    f.queries.push({ model, query });
    if (f.failure) throw new Error("Store unavailable");
  };
  f.db = {
    user: {
      async findUnique(query) {
        check("user", query);
        return f.users.find((u) => u.id === query.where.id) ?? null;
      },
    },
    membership: {
      async findMany(query) {
        check("membership", query);
        return f.memberships.filter((m) => m.userId === query.where.userId);
      },
    },
    team: {
      async findMany(query) {
        check("team", query);
        return f.teams.filter((t) =>
          query.where.id ? query.where.id.in.includes(t.id) : query.where.parentId.in.includes(t.parentId)
        );
      },
    },
    eventType: {
      async findUnique(query) {
        check("eventType", query);
        if (query.where.id !== f.event.id) return null;
        const team = f.teams.find((t) => t.id === f.event.teamId);
        const memberWhere = (query.select ?? query.include)?.team?.select?.members?.where;
        const members = f.memberships
          .filter((m) => m.teamId === team?.id)
          .filter((m) => !memberWhere || (m.accepted && f.users.some((u) => u.id === m.userId && !u.locked)));
        return { ...f.event, team: team ? { ...team, members } : null };
      },
    },
  };
  f.service = new PermissionCheckService(f.db);
  f.query = (extra = {}) => ({
    userId: 1,
    teamId: 10,
    permission: "eventType.update",
    fallbackRoles: ["ADMIN", "OWNER"],
    ...extra,
  });
  return f;
}

const cases = [
  ["direct owner", () => {}, true],
  [
    "direct admin",
    (f) => {
      f.memberships[1].role = "ADMIN";
    },
    true,
  ],
  [
    "ordinary member cannot write",
    (f) => {
      f.memberships[1].role = "MEMBER";
    },
    false,
  ],
  [
    "foreign organization owner",
    (f) => {
      f.memberships = [membership(1, 200, "OWNER")];
    },
    false,
  ],
  [
    "pending team invitation",
    (f) => {
      f.memberships[1].accepted = false;
    },
    false,
  ],
  [
    "pending organization invitation",
    (f) => {
      f.memberships[0].accepted = false;
    },
    false,
  ],
  [
    "removed organization membership",
    (f) => {
      f.memberships.shift();
    },
    false,
  ],
  [
    "removed team membership",
    (f) => {
      f.memberships.pop();
      f.memberships = f.memberships.filter((m) => m.teamId !== 10);
    },
    false,
  ],
  [
    "locked user",
    (f) => {
      f.users[0].locked = true;
    },
    false,
  ],
  [
    "deleted user",
    (f) => {
      f.users.shift();
    },
    false,
  ],
  [
    "own organization owner inherits child authority",
    (f) => {
      f.memberships = [membership(1, 100, "OWNER")];
    },
    true,
  ],
  [
    "own organization member does not inherit child authority",
    (f) => {
      f.memberships = [membership(1, 100)];
    },
    false,
  ],
  [
    "invalid parent organization",
    (f) => {
      f.teams[0].isOrganization = false;
    },
    false,
  ],
  [
    "nested organization rejected",
    (f) => {
      f.teams[0].parentId = 200;
    },
    false,
  ],
  [
    "deleted team",
    (f) => {
      f.teams = f.teams.filter((t) => t.id !== 10);
    },
    false,
  ],
  [
    "global user role is not tenant authority",
    (f) => {
      f.users[0].role = "ADMIN";
      f.memberships = [];
    },
    false,
  ],
];
for (const [name, configure, expected] of cases)
  test(name, async () => {
    const f = fixture();
    configure(f);
    assert.equal(await f.service.checkPermission(f.query()), expected);
  });
for (const value of [
  "unrecognized.action",
  "booking.read",
  "booking.readOrgBookings",
  "*",
  "__proto__",
  "toString",
]) {
  test("deny unsupported or privacy-held permission: " + value, async () => {
    const f = fixture();
    assert.equal(await f.service.checkPermission(f.query({ permission: value })), false);
    assert.equal(f.queries.length, 0);
  });
}
for (const value of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])
  test("invalid ID: " + value, async () => {
    const f = fixture();
    assert.equal(await f.service.checkPermission(f.query({ userId: value })), false);
    assert.equal(await f.service.checkPermission(f.query({ teamId: value })), false);
    assert.equal(f.queries.length, 0);
  });
test("caller fallback cannot elevate MEMBER to writer", async () => {
  const f = fixture();
  f.memberships[1].role = "MEMBER";
  assert.equal(
    await f.service.checkPermission(f.query({ fallbackRoles: ["MEMBER", "ADMIN", "OWNER"] })),
    false
  );
});
test("member event-type reading is retained", async () => {
  const f = fixture();
  f.memberships[1].role = "MEMBER";
  assert.equal(
    await f.service.checkPermission(f.query({ permission: "eventType.read", fallbackRoles: ["MEMBER"] })),
    true
  );
});
test("empty fallback denies built-in roles", async () => {
  const f = fixture();
  assert.equal(await f.service.checkPermission(f.query({ fallbackRoles: [] })), false);
});
test("same service observes revocation without a cached allow", async () => {
  const f = fixture();
  assert.equal(await f.service.hasPermission(f.query()), true);
  f.memberships[1].accepted = false;
  assert.equal(await f.service.hasPermission(f.query()), false);
});
test("same service observes role downgrade and lock", async () => {
  const f = fixture();
  assert.equal(await f.service.checkPermission(f.query()), true);
  f.memberships[1].role = "MEMBER";
  assert.equal(await f.service.checkPermission(f.query()), false);
  f.memberships[1].role = "OWNER";
  f.users[0].locked = true;
  assert.equal(await f.service.checkPermission(f.query()), false);
});
test("database failure rejects rather than permits", async () => {
  const f = fixture();
  f.failure = true;
  await assert.rejects(f.service.checkPermission(f.query()), /Store unavailable/);
  assert.equal(f.writes.length, 0);
});
function custom(f, changes = {}) {
  f.memberships[1] = membership(1, 10, "ADMIN", {
    customRoleId: "role-10",
    customRole: {
      id: "role-10",
      teamId: 10,
      permissions: [{ resource: "eventType", action: "update" }],
      ...changes,
    },
  });
}
test("explicit team-scoped custom permission works", async () => {
  const f = fixture();
  custom(f);
  assert.equal(await f.service.checkPermission(f.query()), true);
  assert.equal(await f.service.checkPermission(f.query({ permission: "eventType.delete" })), false);
});
for (const [name, change] of [
  ["foreign", { teamId: 20 }],
  ["global", { teamId: null }],
  ["mismatched identity", { id: "other" }],
  ["wildcard", { permissions: [{ resource: "*", action: "*" }] }],
]) {
  test("custom role denies " + name + " without base-role fallback", async () => {
    const f = fixture();
    custom(f, change);
    assert.equal(await f.service.checkPermission(f.query()), false);
  });
}
test("orphan custom role denies without ADMIN fallback", async () => {
  const f = fixture();
  custom(f);
  f.memberships[1].customRole = null;
  assert.equal(await f.service.checkPermission(f.query()), false);
});
test("custom organization grant does not imply child-team grant", async () => {
  const f = fixture();
  f.memberships = [
    membership(1, 100, "OWNER", {
      customRoleId: "org-role",
      customRole: {
        id: "org-role",
        teamId: 100,
        permissions: [{ resource: "eventType", action: "update" }],
      },
    }),
  ];
  assert.equal(await f.service.checkPermission(f.query()), false);
});
test("permission listing and point decisions agree", async () => {
  const f = fixture();
  f.memberships = [membership(1, 100, "OWNER"), membership(1, 200), membership(1, 20, "MEMBER")];
  const query = { userId: 1, permission: "eventType.update", fallbackRoles: ["ADMIN", "OWNER"] };
  const actual = await f.service.getTeamIdsWithPermission(query);
  const expected = [];
  for (const team of f.teams)
    if (await f.service.checkPermission({ ...query, teamId: team.id })) expected.push(team.id);
  assert.deepEqual(
    actual,
    expected.sort((a, b) => a - b)
  );
  assert.deepEqual(actual, [10, 11, 100]);
});
test("organization filter only narrows authorized results", async () => {
  const f = fixture();
  f.memberships = [membership(1, 100, "OWNER")];
  assert.deepEqual(
    await f.service.getTeamIdsWithPermission({ userId: 1, permission: "eventType.update", orgId: 200 }),
    []
  );
  assert.deepEqual(await f.service.getTeamIdsWithPermission({ userId: 1, permission: "booking.read" }), []);
});
test("adapter reads only authorization columns", async () => {
  const f = fixture();
  await f.service.checkPermission(f.query());
  assert.deepEqual(f.queries.find((q) => q.model === "user").query.select, { id: true, locked: true });
  assert.equal(JSON.stringify(f.queries).includes("credential"), false);
});

function extract(relative, name, dependencies) {
  const text = read(relative);
  const ast = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
  const statement = ast.statements.find(
    (n) =>
      ts.isVariableStatement(n) && n.declarationList.declarations.some((d) => d.name.getText(ast) === name)
  );
  assert.ok(statement, "Production declaration exists: " + name);
  const prelude = Object.keys(dependencies)
    .map((key) => `const ${key} = require(${JSON.stringify(key)});`)
    .join("\n");
  return compile(prelude + "\n" + statement.getText(ast), dependencies)[name];
}
const authenticatedSeam = {
  input(schema) {
    return {
      use(middleware) {
        return async (args) => middleware({ ...args, input: schema.parse(args.input) });
      },
    };
  },
};
const eventProcedure = extract(
  "packages/trpc/server/routers/viewer/eventTypes/util.ts",
  "createEventPbacProcedure",
  {
    authedProcedure: authenticatedSeam,
    z,
    TRPCError,
    PermissionCheckService,
  }
);
async function invokeEvent(f, permission = "eventType.delete", input = { id: 42 }) {
  return eventProcedure(permission)({
    ctx: { user: { id: 1 }, prisma: f.db },
    input,
    next: async () => {
      f.writes.push("protected handler");
      return "allowed";
    },
  });
}
test("actual event middleware permits the owning team administrator", async () => {
  const f = fixture();
  assert.equal(await invokeEvent(f), "allowed");
  assert.equal(f.writes.length, 1);
});
for (const [name, configure] of [
  [
    "foreign admin",
    (f) => {
      f.memberships = [membership(1, 200, "OWNER")];
    },
  ],
  [
    "pending invite",
    (f) => {
      f.memberships[1].accepted = false;
    },
  ],
  [
    "locked actor",
    (f) => {
      f.users[0].locked = true;
    },
  ],
  [
    "removed org",
    (f) => {
      f.memberships.shift();
    },
  ],
])
  test("actual event middleware denies " + name + " before mutation", async () => {
    const f = fixture();
    configure(f);
    await assert.rejects(invokeEvent(f), (error) => error.code === "FORBIDDEN");
    assert.equal(f.writes.length, 0);
  });
test("actual event middleware rejects pending host assignment", async () => {
  const f = fixture();
  f.memberships.push(membership(3, 10, "MEMBER", { accepted: false }));
  await assert.rejects(
    invokeEvent(f, "eventType.update", { id: 42, users: [3] }),
    (error) => error.code === "FORBIDDEN"
  );
  assert.equal(f.writes.length, 0);
});
test("actual event middleware rejects locked host assignment", async () => {
  const f = fixture();
  f.memberships.push(membership(3, 10));
  f.users[2].locked = true;
  await assert.rejects(
    invokeEvent(f, "eventType.update", { id: 42, users: [3] }),
    (error) => error.code === "FORBIDDEN"
  );
});
test("actual event middleware retains personal ownership", async () => {
  const f = fixture();
  f.event = { id: 42, teamId: null, userId: 1, users: [{ id: 1 }] };
  assert.equal(await invokeEvent(f), "allowed");
});
test("actual event middleware denies unrelated personal event", async () => {
  const f = fixture();
  f.event = { id: 42, teamId: null, userId: 2, users: [{ id: 2 }] };
  await assert.rejects(invokeEvent(f), (error) => error.code === "FORBIDDEN");
});

function createService(f) {
  class EventTypeRepository {
    async create(data) {
      f.writes.push(data);
      return { id: 99 };
    }
  }
  const { createHandler } = compile(
    read("packages/trpc/server/routers/viewer/eventTypes/heavy/create.handler.ts"),
    {
      "@calcom/features/community-enterprise/authorization/PermissionCheckService": {
        PermissionCheckService,
      },
      "@calcom/app-store/_utils/getDefaultLocations": { getDefaultLocations: async () => [] },
      "@calcom/app-store/constants": { DailyLocationType: "daily" },
      "@calcom/features/eventtypes/repositories/eventTypeRepository": { EventTypeRepository },
      "@calcom/prisma/client": { Prisma: { PrismaClientKnownRequestError: class extends Error {} } },
      "@calcom/prisma/enums": { MembershipRole: roles, SchedulingType: { MANAGED: "MANAGED" } },
      "@trpc/server": { TRPCError },
    }
  );
  return createHandler;
}
for (const role of ["USER", "ADMIN"])
  test("actual create handler blocks foreign team for global role " + role, async () => {
    const f = fixture();
    await assert.rejects(
      createService(f)({
        ctx: {
          prisma: f.db,
          user: {
            id: 1,
            role,
            organizationId: 100,
            organization: { isOrgAdmin: true },
            profile: { id: null },
          },
        },
        input: { teamId: 20, schedulingType: "ROUND_ROBIN", slug: "test", length: 30 },
      }),
      (error) => error.code === "UNAUTHORIZED"
    );
    assert.equal(f.writes.length, 0);
  });
test("actual create handler permits own authorized team", async () => {
  const f = fixture();
  await createService(f)({
    ctx: {
      prisma: f.db,
      user: {
        id: 1,
        role: "USER",
        organizationId: 100,
        organization: { isOrgAdmin: false },
        profile: { id: null },
      },
    },
    input: { teamId: 10, schedulingType: "ROUND_ROBIN", slug: "test", length: 30 },
  });
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].team.connect.id, 10);
});

function bookingService(f) {
  class BookingRepository {
    async findByUidIncludeEventType() {
      return f.booking;
    }
    async findByIdIncludeEventType() {
      return f.booking;
    }
  }
  const { BookingAccessService } = compile(
    read("packages/features/bookings/services/BookingAccessService.ts"),
    {
      "@calcom/features/community-enterprise/authorization/PermissionCheckService": {
        PermissionCheckService,
      },
      "@calcom/prisma/enums": { MembershipRole: roles },
      "../repositories/BookingRepository": { BookingRepository },
    }
  );
  return new BookingAccessService(f.db);
}
test("actual booking access does not expose coworker private appointment", async () => {
  const f = fixture();
  f.memberships = [membership(1, 100, "OWNER")];
  f.booking = {
    userId: 2,
    user: { id: 2, email: "host@example.test" },
    attendees: [],
    eventType: { teamId: null, hosts: [], users: [] },
  };
  assert.equal(
    await bookingService(f).doesUserIdHaveAccessToBooking({ userId: 1, bookingUid: "private" }),
    false
  );
});
test("actual booking access permits team-owned event for scoped administrator", async () => {
  const f = fixture();
  f.booking = {
    userId: 3,
    user: { id: 3, email: "host@example.test" },
    attendees: [],
    eventType: { teamId: 10, hosts: [], users: [] },
  };
  assert.equal(
    await bookingService(f).doesUserIdHaveAccessToBooking({ userId: 1, bookingUid: "shared" }),
    true
  );
});
test("actual booking access denies foreign team administrator", async () => {
  const f = fixture();
  f.booking = {
    userId: 3,
    user: { id: 3, email: "host@example.test" },
    attendees: [],
    eventType: { teamId: 20, hosts: [], users: [] },
  };
  assert.equal(
    await bookingService(f).doesUserIdHaveAccessToBooking({ userId: 1, bookingUid: "foreign" }),
    false
  );
});

test("actual event middleware rejects conflicting id and eventTypeId before query", async () => {
  const f = fixture();
  await assert.rejects(invokeEvent(f, "eventType.delete", { id: 999, eventTypeId: 42 }));
  assert.equal(f.queries.length, 0);
  assert.equal(f.writes.length, 0);
});
test("actual event middleware rejects nonpositive IDs before query", async () => {
  const f = fixture();
  await assert.rejects(invokeEvent(f, "eventType.delete", { id: 0 }));
  assert.equal(f.queries.length, 0);
});
test("actual booking access rejects locked owner before ownership shortcut", async () => {
  const f = fixture();
  f.users[0].locked = true;
  f.booking = {
    userId: 1,
    user: { id: 1, email: "owner@example.test" },
    attendees: [],
    eventType: { teamId: null, hosts: [], users: [] },
  };
  assert.equal(
    await bookingService(f).doesUserIdHaveAccessToBooking({ userId: 1, bookingUid: "own" }),
    false
  );
});
test("actual booking access retains active private owner", async () => {
  const f = fixture();
  f.booking = {
    userId: 1,
    user: { id: 1, email: "owner@example.test" },
    attendees: [],
    eventType: { teamId: null, hosts: [], users: [] },
  };
  assert.equal(await bookingService(f).doesUserIdHaveAccessToBooking({ userId: 1, bookingUid: "own" }), true);
});
test("actual booking access retains managed event parent-team authority", async () => {
  const f = fixture();
  f.booking = {
    userId: 3,
    user: { id: 3, email: "host@example.test" },
    attendees: [],
    eventType: { teamId: null, parent: { teamId: 10 }, hosts: [], users: [] },
  };
  assert.equal(
    await bookingService(f).doesUserIdHaveAccessToBooking({ userId: 1, bookingUid: "managed" }),
    true
  );
});
test("organization filter must name an actual organization", async () => {
  const f = fixture();
  f.memberships.push(membership(1, 30, "OWNER"));
  assert.deepEqual(
    await f.service.getTeamIdsWithPermission({ userId: 1, permission: "eventType.update", orgId: 30 }),
    []
  );
});

for (const method of ["findByUidIncludeEventType", "findByIdIncludeEventType"]) {
  test(`production repository ${method} selects the ID required by access validation`, async () => {
    const source = read("packages/features/bookings/repositories/BookingRepository.ts");
    const ast = ts.createSourceFile("repository.ts", source, ts.ScriptTarget.Latest, true);
    const declaration = ast.statements.find(
      (node) => ts.isClassDeclaration(node) && node.name?.text === "BookingRepository"
    );
    const member = declaration.members.find(
      (node) => ts.isMethodDeclaration(node) && node.name.getText(ast) === method
    );
    assert.ok(member);
    const { Repository } = compile(
      `export class Repository { constructor(private prismaClient: unknown) {} ${member.getText(ast)} }`
    );
    let selected;
    const repository = new Repository({
      booking: {
        findUnique: async (query) => {
          selected = query;
          return { id: 77 };
        },
      },
    });
    const result = await repository[method]({ bookingUid: "fixture-booking", bookingId: 77 });
    assert.equal(selected.select.id, true);
    assert.equal(result.id, 77);
  });
}
