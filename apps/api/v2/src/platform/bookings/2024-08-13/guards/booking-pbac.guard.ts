import { BookingAccessService } from "@calcom/platform-libraries";
import {
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { ApiAuthGuardUser } from "@/modules/auth/strategies/api-auth/api-auth.strategy";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";

@Injectable()
export class BookingPbacGuard implements CanActivate {
  private bookingAccessService: BookingAccessService;

  constructor(private readonly prismaWriteService: PrismaWriteService) {
    this.bookingAccessService = new BookingAccessService(this.prismaWriteService.prisma);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: ApiAuthGuardUser; pbacAuthorizedRequest?: boolean }>();
    const user = request.user;
    const bookingUid = request.params.bookingUid;

    if (!user) {
      throw new UnauthorizedException();
    }

    if (!bookingUid) {
      throw new BadRequestException("BookingPbacGuard - bookingUid is required");
    }

    const hasAccess = await this.bookingAccessService.doesUserIdHaveAccessToBooking({
      userId: user.id,
      bookingUid,
      apiKeyTeamId: user.apiKeyTeamId,
    });

    if (!hasAccess) {
      throw new ForbiddenException(
        `BookingPbacGuard - user with id=${user.id} does not have access to booking with uid=${bookingUid}`
      );
    }

    request.pbacAuthorizedRequest = true;
    return true;
  }
}
