import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from './jwt-auth.guard';
import { constantTimeEqual } from '../crypto';

/**
 * Import Pipeline Radar Phase 5a: lets the headless laptop watcher
 * (bank-statement-watcher repo, no user login/JWT) authenticate to
 * POST /ingestion/watcher-events with a shared secret instead of a JWT.
 *
 * Passes when EITHER:
 *   (a) the request carries header `X-Ingest-Key` matching `INGEST_API_KEY`
 *       (constant-time compare), or
 *   (b) the normal JwtAuthGuard would pass (browser/UI callers).
 *
 * If `INGEST_API_KEY` is unset/empty, path (a) is disabled entirely and this
 * guard behaves exactly like `JwtAuthGuard`. Scoped to this one route only —
 * do not reuse for routes that should stay JWT-only.
 */
@Injectable()
export class IngestKeyOrJwtGuard implements CanActivate {
  private readonly jwtGuard = new JwtAuthGuard();

  constructor(private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const configuredKey = this.config.get<string>('INGEST_API_KEY');

    if (configuredKey) {
      const request = context.switchToHttp().getRequest();
      const provided = request.headers?.['x-ingest-key'];
      if (typeof provided === 'string' && constantTimeEqual(provided, configuredKey)) {
        return true;
      }
    }

    return (await this.jwtGuard.canActivate(context)) as boolean;
  }
}
