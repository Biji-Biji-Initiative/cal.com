import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Request } from "express";
import { ApiAuthGuardUser } from "@/modules/auth/strategies/api-auth/api-auth.strategy";
import { EventTypeAccessService } from "@/modules/event-types/services/event-type-access.service";

@Injectable()
export class EventTypeOwnershipGuard implements CanActivate {
  constructor(private readonly eventTypeAccessService: EventTypeAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as ApiAuthGuardUser | undefined;
    const eventTypeIdParam = request.params?.eventTypeId;

    if (!user) {
      throw new ForbiddenException("EventTypeOwnershipGuard - No user associated with the request.");
    }

    if (!eventTypeIdParam) {
      throw new BadRequestException("Missing eventTypeId param.");
    }

    const eventTypeId = Number(eventTypeIdParam);
    if (!Number.isInteger(eventTypeId) || eventTypeId <= 0) {
      throw new BadRequestException("Invalid eventTypeId param.");
    }
    const permission = ["GET", "HEAD"].includes(request.method) ? "eventType.read" : "eventType.update";
    if (!(await this.eventTypeAccessService.userOwnsEventType(user, eventTypeId, permission))) {
      throw new NotFoundException(`Event type with id ${eventTypeId} not found`);
    }

    return true;
  }
}
