import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import type { AuthTokenPayload } from '@moneypulse/shared';

@Injectable()
export class HouseholdGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthTokenPayload;

    if (!user.householdId) {
      throw new ForbiddenException(
        'You must belong to a household to access this resource',
      );
    }

    return true;
  }
}
