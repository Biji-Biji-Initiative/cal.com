import { generateHashedLink, isLinkExpired } from "@calcom/platform-libraries/private-links";
import { CreatePrivateLinkInput, PrivateLinkOutput, UpdatePrivateLinkInput } from "@calcom/platform-types";
import type { Prisma } from "@calcom/prisma/client";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { ApiAuthGuardUser } from "@/modules/auth/strategies/api-auth/api-auth.strategy";
import { EventTypeAccessService } from "@/modules/event-types/services/event-type-access.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { PrivateLinksRepository } from "@/platform/event-types-private-links/private-links.repository";
import { PrivateLinksInputService } from "@/platform/event-types-private-links/services/private-links-input.service";
import {
  type PrivateLinkData,
  PrivateLinksOutputService,
} from "@/platform/event-types-private-links/services/private-links-output.service";

@Injectable()
export class PrivateLinksService {
  constructor(
    private readonly inputService: PrivateLinksInputService,
    private readonly outputService: PrivateLinksOutputService,
    private readonly repo: PrivateLinksRepository,
    private readonly eventTypeAccessService: EventTypeAccessService,
    private readonly dbWrite: PrismaWriteService
  ) {}

  async createPrivateLink(
    eventTypeId: number,
    user: ApiAuthGuardUser,
    input: CreatePrivateLinkInput
  ): Promise<PrivateLinkOutput> {
    return this.withOwner(user, eventTypeId, "eventType.update", async (client) => {
      try {
        const transformedInput = this.inputService.transformCreateInput(input);
        const created = await this.repo.create(
          eventTypeId,
          {
            link: generateHashedLink(user.id),
            expiresAt: transformedInput.expiresAt ?? null,
            maxUsageCount: transformedInput.maxUsageCount ?? null,
          },
          client
        );
        const mapped: PrivateLinkData = {
          id: created.link,
          eventTypeId,
          isExpired: isLinkExpired(created),
          bookingUrl: `${process.env.NEXT_PUBLIC_WEBAPP_URL || "https://cal.com"}/d/${created.link}`,
          expiresAt: created.expiresAt ?? null,
          maxUsageCount: created.maxUsageCount ?? null,
          usageCount: created.usageCount ?? 0,
        };
        return this.outputService.transformToOutput(mapped);
      } catch (error) {
        if (error instanceof Error) {
          throw new BadRequestException(error.message);
        }
        throw new BadRequestException("Failed to create private link");
      }
    });
  }

  async getPrivateLinks(eventTypeId: number, user: ApiAuthGuardUser): Promise<PrivateLinkOutput[]> {
    return this.withOwner(user, eventTypeId, "eventType.read", async (client) => {
      try {
        const links = await this.repo.listByEventTypeId(eventTypeId, client);
        const mapped: PrivateLinkData[] = links.map((l) => ({
          id: l.link,
          eventTypeId,
          isExpired: isLinkExpired(l),
          bookingUrl: `${process.env.NEXT_PUBLIC_WEBAPP_URL || "https://cal.com"}/d/${l.link}`,
          expiresAt: l.expiresAt ?? null,
          maxUsageCount: l.maxUsageCount ?? null,
          usageCount: l.usageCount ?? 0,
        }));
        return this.outputService.transformArrayToOutput(mapped);
      } catch (error) {
        if (error instanceof Error) {
          throw new BadRequestException(error.message);
        }
        throw new BadRequestException("Failed to get private links");
      }
    });
  }

  async updatePrivateLink(
    eventTypeId: number,
    input: UpdatePrivateLinkInput,
    user: ApiAuthGuardUser
  ): Promise<PrivateLinkOutput> {
    return this.withOwner(user, eventTypeId, "eventType.update", async (client) => {
      try {
        const transformedInput = this.inputService.transformUpdateInput(input);
        const updatedResult = await this.repo.update(
          eventTypeId,
          {
            link: transformedInput.linkId,
            expiresAt: transformedInput.expiresAt ?? null,
            maxUsageCount: transformedInput.maxUsageCount ?? null,
          },
          client
        );
        if (!updatedResult || updatedResult.count === 0) {
          throw new NotFoundException("Updated link not found");
        }
        const updated = await this.repo.findWithEventTypeDetails(transformedInput.linkId, client);
        if (!updated) throw new NotFoundException("Updated link not found");
        const mapped: PrivateLinkData = {
          id: updated.link,
          eventTypeId,
          isExpired: isLinkExpired(updated),
          bookingUrl: `${process.env.NEXT_PUBLIC_WEBAPP_URL || "https://cal.com"}/d/${updated.link}`,
          expiresAt: updated.expiresAt ?? null,
          maxUsageCount: updated.maxUsageCount ?? null,
          usageCount: updated.usageCount ?? 0,
        };
        return this.outputService.transformToOutput(mapped);
      } catch (error) {
        if (error instanceof Error) {
          if (error.message.includes("not found")) {
            throw new NotFoundException(error.message);
          }
          throw new BadRequestException(error.message);
        }
        throw new BadRequestException("Failed to update private link");
      }
    });
  }

  async deletePrivateLink(eventTypeId: number, linkId: string, user: ApiAuthGuardUser): Promise<void> {
    return this.withOwner(user, eventTypeId, "eventType.update", async (client) => {
      try {
        const { count } = await this.repo.delete(eventTypeId, linkId, client);
        if (count === 0) {
          throw new NotFoundException("Deleted link not found");
        }
      } catch (error) {
        if (error instanceof Error) {
          if (error.message.includes("not found")) {
            throw new NotFoundException(error.message);
          }
          throw new BadRequestException(error.message);
        }
        throw new BadRequestException("Failed to delete private link");
      }
    });
  }

  private async withOwner<T>(
    user: ApiAuthGuardUser,
    eventTypeId: number,
    permission: "eventType.read" | "eventType.update",
    operation: (client: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    return this.dbWrite.prisma.$transaction(
      async (client) => {
        if (permission === "eventType.read") await client.$executeRaw`SET TRANSACTION READ ONLY`;
        if (!(await this.eventTypeAccessService.userOwnsEventType(user, eventTypeId, permission, client))) {
          throw new NotFoundException(`Event type with id ${eventTypeId} not found`);
        }
        return operation(client);
      },
      { isolationLevel: permission === "eventType.read" ? "RepeatableRead" : "Serializable" }
    );
  }
}
