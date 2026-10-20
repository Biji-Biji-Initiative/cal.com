// SPDX-License-Identifier: MIT
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { Membership, ScimMembershipGrant } from "@calcom/prisma/client";

type Member = Pick<
  Membership,
  "id" | "userId" | "teamId" | "role" | "accepted" | "customRoleId" | "updatedAt"
>;
type Grant = Pick<
  ScimMembershipGrant,
  | "directoryId"
  | "membershipId"
  | "lastManagedRole"
  | "lastManagedAccepted"
  | "lastManagedCustomRoleId"
  | "lastManagedUpdatedAt"
>;
interface Scope {
  directoryId: string;
  userId: number;
  teamId: number;
}
const refused = () =>
  new ErrorWithCode(ErrorCode.Forbidden, "SCIM membership provenance is ambiguous, privileged or changed");
const validId = (id: number) => Number.isSafeInteger(id) && id > 0;
function timestamp(value: Date | null): number | null {
  if (value === null) return null;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw refused();
  return value.getTime();
}

// A disposition is never authorization. Reconciliation must hold the existing
// directory/team/user/member transaction locks and recheck actor/identity first.
export function scimMembershipDisposition(
  scope: Readonly<Scope>,
  member: Readonly<Member> | null,
  grants: readonly Readonly<Grant>[]
): "missing" | "local" | "owned" {
  if (
    !validId(scope.userId) ||
    !validId(scope.teamId) ||
    !scope.directoryId ||
    scope.directoryId.trim() !== scope.directoryId
  )
    throw refused();
  if (!member) {
    if (grants.length) throw refused();
    return "missing";
  }
  if (!validId(member.id) || member.userId !== scope.userId || member.teamId !== scope.teamId)
    throw refused();
  if (grants.length === 0) return "local";
  if (grants.length !== 1) throw refused();
  const grant = grants[0];
  if (
    grant.directoryId !== scope.directoryId ||
    grant.membershipId !== member.id ||
    member.role !== "MEMBER" ||
    grant.lastManagedRole !== "MEMBER" ||
    member.customRoleId !== null ||
    grant.lastManagedCustomRoleId !== null ||
    typeof member.accepted !== "boolean" ||
    member.accepted !== grant.lastManagedAccepted ||
    timestamp(member.updatedAt) !== timestamp(grant.lastManagedUpdatedAt)
  )
    throw refused();
  return "owned";
}
