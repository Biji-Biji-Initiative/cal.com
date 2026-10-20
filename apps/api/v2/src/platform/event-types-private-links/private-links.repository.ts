import type { Prisma } from "@calcom/prisma/client";
import { Injectable } from "@nestjs/common";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";

@Injectable()
export class PrivateLinksRepository {
  constructor(
    private readonly dbRead: PrismaReadService,
    private readonly dbWrite: PrismaWriteService
  ) {}

  async listByEventTypeId(
    eventTypeId: number,
    client: Pick<Prisma.TransactionClient, "hashedLink"> = this.dbRead.prisma
  ) {
    return client.hashedLink.findMany({
      where: { eventTypeId },
      select: { link: true, expiresAt: true, maxUsageCount: true, usageCount: true },
    });
  }

  async findWithEventTypeDetails(
    linkId: string,
    client: Pick<Prisma.TransactionClient, "hashedLink"> = this.dbRead.prisma
  ) {
    return client.hashedLink.findUnique({
      where: { link: linkId },
      select: {
        link: true,
        expiresAt: true,
        maxUsageCount: true,
        usageCount: true,
      },
    });
  }

  async create(
    eventTypeId: number,
    link: { link: string; expiresAt: Date | null; maxUsageCount?: number | null },
    client: Pick<Prisma.TransactionClient, "hashedLink"> = this.dbWrite.prisma
  ) {
    return client.hashedLink.create({
      select: { link: true, expiresAt: true, maxUsageCount: true, usageCount: true },
      data: {
        eventTypeId,
        link: link.link,
        expiresAt: link.expiresAt,
        ...(typeof link.maxUsageCount === "number" ? { maxUsageCount: link.maxUsageCount } : {}),
      },
    });
  }

  async update(
    eventTypeId: number,
    link: { link: string; expiresAt: Date | null; maxUsageCount?: number | null },
    client: Pick<Prisma.TransactionClient, "hashedLink"> = this.dbWrite.prisma
  ) {
    return client.hashedLink.updateMany({
      where: { eventTypeId, link: link.link },
      data: {
        expiresAt: link.expiresAt,
        ...(typeof link.maxUsageCount === "number" ? { maxUsageCount: link.maxUsageCount } : {}),
      },
    });
  }

  async delete(
    eventTypeId: number,
    linkId: string,
    client: Pick<Prisma.TransactionClient, "hashedLink"> = this.dbWrite.prisma
  ) {
    return client.hashedLink.deleteMany({ where: { eventTypeId, link: linkId } });
  }
}
