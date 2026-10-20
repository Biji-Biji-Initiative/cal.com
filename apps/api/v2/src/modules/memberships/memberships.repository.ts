import { MembershipRole } from "@calcom/platform-libraries";
import type { Prisma } from "@calcom/prisma/client";
import { Injectable } from "@nestjs/common";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";

type MembershipClient = Pick<Prisma.TransactionClient, "membership">;

@Injectable()
export class MembershipsRepository {
  constructor(
    private readonly dbRead: PrismaReadService,
    private readonly dbWrite: PrismaWriteService
  ) {}

  async findOrgUserMembership(organizationId: number, userId: number) {
    const membership = await this.dbRead.prisma.membership.findUniqueOrThrow({
      where: {
        userId_teamId: {
          userId: userId,
          teamId: organizationId,
        },
      },
    });

    return membership;
  }

  async findPlatformOwnerUserId(organizationId: number): Promise<number | undefined> {
    const owner = await this.dbRead.prisma.membership.findFirst({
      where: {
        teamId: organizationId,
        role: "OWNER",
        accepted: true,
      },
      select: {
        userId: true,
      },
    });

    return owner?.userId ?? undefined;
  }

  async findPlatformAdminUserId(organizationId: number): Promise<number | undefined> {
    const admin = await this.dbRead.prisma.membership.findFirst({
      where: {
        teamId: organizationId,
        role: "ADMIN",
        accepted: true,
      },
      select: {
        userId: true,
      },
    });

    return admin?.userId ?? undefined;
  }

  async findMembershipByTeamId(teamId: number, userId: number) {
    const membership = await this.dbRead.prisma.membership.findUnique({
      where: {
        userId_teamId: {
          userId: userId,
          teamId: teamId,
        },
      },
    });

    return membership;
  }

  async findUserMemberships(userId: number) {
    const memberships = await this.dbRead.prisma.membership.findMany({
      where: {
        userId,
      },
    });

    return memberships;
  }

  async findMembershipByOrgId(orgId: number, userId: number) {
    return this.findMembershipByTeamId(orgId, userId);
  }

  async isUserOrganizationAdmin(
    userId: number,
    organizationId: number,
    client: MembershipClient = this.dbRead.prisma
  ) {
    const adminMembership = await client.membership.findFirst({
      where: {
        userId,
        teamId: organizationId,
        accepted: true,
        customRoleId: null,
        OR: [{ role: "ADMIN" }, { role: "OWNER" }],
      },
    });

    return !!adminMembership;
  }

  async getOrgIdsWhereUserIsAdminOrOwner(userId: number, client: MembershipClient = this.dbRead.prisma) {
    const userOrgAdminMemberships = await client.membership.findMany({
      where: {
        userId: userId,
        accepted: true,
        customRoleId: null,
        role: {
          in: ["OWNER", "ADMIN"],
        },
        team: {
          parentId: null,
          isOrganization: true,
        },
      },
      select: {
        teamId: true,
      },
    });

    return userOrgAdminMemberships.map((m: { teamId: number }) => m.teamId);
  }

  async createMembership(teamId: number, userId: number, role: MembershipRole, accepted: boolean) {
    const membership = await this.dbWrite.prisma.membership.create({
      data: {
        createdAt: new Date(),
        role,
        teamId,
        userId,
        accepted,
      },
    });

    return membership;
  }

  async getUserAdminOrOwnerTeamMembership(
    userId: number,
    teamId: number,
    client: MembershipClient = this.dbRead.prisma
  ) {
    return client.membership.findFirst({
      where: {
        userId: userId,
        teamId: teamId,
        accepted: true,
        customRoleId: null,
        role: {
          in: ["OWNER", "ADMIN"],
        },
      },
    });
  }

  async getUserMembershipInOneOfOrgs(
    userId: number,
    orgIds: number[],
    client: MembershipClient = this.dbRead.prisma
  ) {
    return client.membership.findFirst({
      where: {
        userId: userId,
        accepted: true,
        teamId: {
          in: orgIds,
        },
        team: {
          parentId: null,
        },
      },
    });
  }

  async getUserMembershipInOneOfOrgsTeams(
    userId: number,
    orgIds: number[],
    client: MembershipClient = this.dbRead.prisma
  ) {
    return client.membership.findFirst({
      where: {
        userId: userId,
        accepted: true,
        team: {
          parentId: {
            in: orgIds,
          },
        },
      },
    });
  }
}
