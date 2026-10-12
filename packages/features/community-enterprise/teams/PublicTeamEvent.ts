// SPDX-License-Identifier: MIT

import type { PrismaClient } from "@calcom/prisma";
import { z } from "zod";

const slug = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const publicTeamRoute = z.object({ organization: slug.optional(), team: slug, event: slug });

// Resolve every level explicitly. Root slugs can be duplicated in the retained
// schema because PostgreSQL treats NULL parents as distinct; ambiguity is a 404,
// never an arbitrary cross-organization "first" match.
export async function resolvePublicTeamEvent(
  prisma: Pick<PrismaClient, "team" | "eventType">,
  raw: z.input<typeof publicTeamRoute>
) {
  const input = publicTeamRoute.safeParse(raw);
  if (!input.success) return null;
  const { organization, team, event } = input.data;
  let organizationId: number | null = null;
  if (organization) {
    const matches = await prisma.team.findMany({
      where: { slug: organization, isOrganization: true, parentId: null },
      select: { id: true },
      take: 2,
    });
    if (matches.length !== 1) return null;
    organizationId = matches[0].id;
  }
  const matches = await prisma.team.findMany({
    where: { slug: team, parentId: organizationId, isOrganization: false },
    select: { id: true },
    take: 2,
  });
  if (matches.length !== 1) return null;
  const teamId = matches[0].id;
  const events = await prisma.eventType.findMany({
    where: { teamId, slug: event, schedulingType: { in: ["ROUND_ROBIN", "COLLECTIVE"] } },
    select: { id: true },
    take: 2,
  });
  if (events.length !== 1) return null;
  return {
    teamId,
    organizationId,
    eventTypeId: events[0].id,
    teamSlug: team,
    organizationSlug: organization ?? null,
    eventSlug: event,
  };
}
