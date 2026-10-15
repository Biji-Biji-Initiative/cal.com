// SPDX-License-Identifier: MIT
import { z } from "zod";

// Expose only delegations with retained, scoped read contracts. An imported
// permission string, wildcard or cloud entitlement is not an assignable action.
export const scopedPermissions = ["eventType.read", "booking.readTeamBookings"] as const;
export const roleActorInput = z.object({ id: z.number().int().positive(), uuid: z.string().uuid() }).strict();
export const roleScopeInput = z
  .object({ organizationId: z.number().int().positive(), scopeId: z.number().int().positive() })
  .strict();
export const roleCreateInput = roleScopeInput
  .extend({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(240).default(""),
    permissions: z
      .array(z.enum(scopedPermissions))
      .min(1)
      .max(scopedPermissions.length)
      .refine((values) => new Set(values).size === values.length, "Choose each permission once"),
    requestId: z.string().uuid(),
  })
  .strict();
export const roleAssignmentInput = roleScopeInput
  .extend({
    target: roleActorInput,
    roleId: z.string().min(1).max(128).nullable(),
  })
  .strict();
export const roleAssignmentCommitInput = roleAssignmentInput
  .extend({
    reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
    requestId: z.string().uuid(),
  })
  .strict();
export type RoleActor = z.infer<typeof roleActorInput>;
export type RoleScope = z.infer<typeof roleScopeInput>;
export type RoleAssignment = z.infer<typeof roleAssignmentInput>;
