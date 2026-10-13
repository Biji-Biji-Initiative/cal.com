import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { Injectable } from "@nestjs/common";

@Injectable()
export class ApiKeysRepository {
  constructor(private readonly dbRead: PrismaReadService, private readonly dbWrite: PrismaWriteService) {}

  async getApiKeyFromHash(hashedKey: string) {
    // Revoked or rotated credentials must not be resurrected by replica lag.
    return this.dbWrite.prisma.apiKey.findUnique({
      where: {
        hashedKey,
      },
    });
  }

  async getTeamApiKeys(teamId: number) {
    return this.dbRead.prisma.apiKey.findMany({
      where: {
        teamId,
      },
    });
  }

  async deleteById(id: string) {
    return this.dbWrite.prisma.apiKey.delete({
      where: {
        id,
      },
    });
  }
}
