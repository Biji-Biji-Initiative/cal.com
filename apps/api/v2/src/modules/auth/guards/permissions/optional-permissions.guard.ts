import { type ExecutionContext, Injectable } from "@nestjs/common";
import { PermissionsGuard } from "@/modules/auth/guards/permissions/permissions.guard";

@Injectable()
export class OptionalPermissionsGuard extends PermissionsGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest<{ user?: unknown }>().user;
    if (user === undefined || user === null) return true;
    return super.canActivate(context);
  }
}
