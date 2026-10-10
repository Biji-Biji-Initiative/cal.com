// SPDX-License-Identifier: MIT
export type MembershipRole = "MEMBER" | "ADMIN" | "OWNER";

const READ_ROLES: readonly MembershipRole[] = ["MEMBER", "ADMIN", "OWNER"];
const ADMIN_ROLES: readonly MembershipRole[] = ["ADMIN", "OWNER"];

// Legacy booking.read queries include coworkers' private appointments. They must
// not gain delegation until their resource predicates have been repaired.
const PERMISSIONS: Readonly<Record<string, readonly MembershipRole[]>> = {
  "eventType.read": READ_ROLES,
  "eventType.create": ADMIN_ROLES,
  "eventType.update": ADMIN_ROLES,
  "eventType.delete": ADMIN_ROLES,
  "eventType.manage": ADMIN_ROLES,
  "team.read": READ_ROLES,
  "team.update": ADMIN_ROLES,
  "organization.read": READ_ROLES,
  "organization.update": ADMIN_ROLES,
  "booking.readTeamBookings": ADMIN_ROLES,
  "webhook.read": ADMIN_ROLES,
  "webhook.update": ADMIN_ROLES,
  "webhook.delete": ADMIN_ROLES,
  "watchlist.read": ADMIN_ROLES,
  "watchlist.create": ADMIN_ROLES,
  "watchlist.update": ADMIN_ROLES,
  "watchlist.delete": ADMIN_ROLES,
  "ooo.update": ADMIN_ROLES,
};

export interface TeamScope {
  id: number;
  parentId: number | null;
  isOrganization: boolean;
}

export interface MembershipGrant {
  userId: number;
  teamId: number;
  accepted: boolean;
  role: string;
  customRoleId: string | null;
  customRole: {
    id: string;
    teamId: number | null;
    permissions: readonly { resource: string; action: string }[];
  } | null;
}

export interface AuthoritySnapshot {
  user: { id: number; locked: boolean } | null;
  memberships: readonly MembershipGrant[];
}

export interface PermissionStore {
  snapshot(userId: number): Promise<AuthoritySnapshot>;
  teams(ids: readonly number[]): Promise<readonly TeamScope[]>;
  children(parentIds: readonly number[]): Promise<readonly TeamScope[]>;
}

export interface PermissionQuery {
  userId: number;
  teamId: number;
  permission: string;
  fallbackRoles?: readonly string[];
}

export interface PermissionListQuery extends Omit<PermissionQuery, "teamId"> {
  orgId?: number;
}

const isId = (id: number) => Number.isSafeInteger(id) && id > 0;
const allowedRoles = (permission: string) =>
  Object.hasOwn(PERMISSIONS, permission) ? PERMISSIONS[permission] : undefined;

export class PermissionPolicy {
  constructor(private readonly store: PermissionStore) {}

  async checkPermission(query: PermissionQuery): Promise<boolean> {
    if (!isId(query.userId) || !isId(query.teamId) || !allowedRoles(query.permission)) return false;
    const snapshot = await this.store.snapshot(query.userId);
    if (!this.isActive(snapshot, query.userId)) return false;
    const teams = await this.store.teams([query.teamId]);
    const team = teams.find((scope) => scope.id === query.teamId);
    if (!team) return false;
    const parents = team.parentId === null ? [] : await this.store.teams([team.parentId]);
    return this.authorize(query, snapshot, team, parents);
  }

  async hasPermission(query: PermissionQuery): Promise<boolean> {
    return this.checkPermission(query);
  }

  async getTeamIdsWithPermission(query: PermissionListQuery): Promise<number[]> {
    if (!isId(query.userId) || !allowedRoles(query.permission)) return [];
    if (query.orgId !== undefined && !isId(query.orgId)) return [];
    const snapshot = await this.store.snapshot(query.userId);
    if (!this.isActive(snapshot, query.userId)) return [];
    const memberships = snapshot.memberships.filter((m) => this.isAccepted(m, query.userId));
    if (memberships.length === 0) return [];
    const direct = await this.store.teams(Array.from(new Set(memberships.map((m) => m.teamId))));
    const parentIds = direct
      .filter((team) => team.isOrganization && team.parentId === null)
      .filter((team) => memberships.some((m) => m.teamId === team.id && this.isBuiltinAdmin(m)))
      .map((team) => team.id);
    const children = parentIds.length ? await this.store.children(parentIds) : [];
    const candidates = Array.from(new Map([...direct, ...children].map((team) => [team.id, team])).values());
    const missingParents = candidates
      .map((team) => team.parentId)
      .filter((id): id is number => id !== null && !candidates.some((team) => team.id === id));
    const parents = missingParents.length ? await this.store.teams(Array.from(new Set(missingParents))) : [];
    const scopes = [...candidates, ...parents];
    if (query.orgId !== undefined) {
      const organization = scopes.find((scope) => scope.id === query.orgId);
      if (!organization?.isOrganization || organization.parentId !== null) return [];
    }
    return candidates
      .filter((team) => query.orgId === undefined || team.id === query.orgId || team.parentId === query.orgId)
      .filter((team) => this.authorize({ ...query, teamId: team.id }, snapshot, team, scopes))
      .map((team) => team.id)
      .sort((a, b) => a - b);
  }

  private isActive(snapshot: AuthoritySnapshot, userId: number): boolean {
    return snapshot.user?.id === userId && snapshot.user.locked === false;
  }

  private isAccepted(membership: MembershipGrant, userId: number): boolean {
    return membership.userId === userId && isId(membership.teamId) && membership.accepted === true;
  }

  private isBuiltinAdmin(membership: MembershipGrant): boolean {
    return membership.customRoleId === null && ADMIN_ROLES.some((role) => role === membership.role);
  }

  private grants(membership: MembershipGrant, query: PermissionQuery): boolean {
    const ceiling = allowedRoles(query.permission);
    if (!ceiling) return false;
    if (membership.customRoleId !== null) {
      const custom = membership.customRole;
      // A broken, global, or foreign role binding never falls back to ADMIN.
      if (!custom || custom.id !== membership.customRoleId || custom.teamId !== membership.teamId)
        return false;
      return custom.permissions.some((p) => `${p.resource}.${p.action}` === query.permission);
    }
    if (!ceiling.some((role) => role === membership.role)) return false;
    return query.fallbackRoles === undefined || query.fallbackRoles.includes(membership.role);
  }

  private authorize(
    query: PermissionQuery,
    snapshot: AuthoritySnapshot,
    team: TeamScope,
    scopes: readonly TeamScope[]
  ): boolean {
    if (!isId(team.id) || team.id !== query.teamId) return false;
    if (team.isOrganization && team.parentId !== null) return false;
    if (query.permission.startsWith("organization.") && !team.isOrganization) return false;
    const memberships = snapshot.memberships.filter((m) => this.isAccepted(m, query.userId));
    const direct = memberships.find((m) => m.teamId === team.id);
    if (team.parentId === null) return direct ? this.grants(direct, query) : false;
    const parent = scopes.find((scope) => scope.id === team.parentId);
    if (!parent?.isOrganization || parent.parentId !== null || parent.id === team.id) return false;
    const parentMembership = memberships.find((m) => m.teamId === parent.id);
    // Removal from the organization must revoke a leftover child-team grant.
    if (!parentMembership) return false;
    if (direct && this.grants(direct, query)) return true;
    // Only a built-in admin of THIS parent inherits child authority. Custom
    // roles require an explicit team binding; they cannot imply org-wide power.
    return this.isBuiltinAdmin(parentMembership) && this.grants(parentMembership, query);
  }
}
