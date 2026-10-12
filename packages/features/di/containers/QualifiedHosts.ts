import { CommunityQualifiedHostsService } from "@calcom/features/community-enterprise/scheduling/QualifiedHostsService";
import prisma from "@calcom/prisma";

export type { QualifiedHostsService } from "@calcom/features/community-enterprise/scheduling/QualifiedHostsService";

const qualifiedHostsService = new CommunityQualifiedHostsService(prisma);
export function getQualifiedHostsService() {
  return qualifiedHostsService;
}
