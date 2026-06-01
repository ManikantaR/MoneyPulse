import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { sendDigestSchema } from '@moneypulse/shared';
import type { AuthTokenPayload } from '@moneypulse/shared';
import { DigestService } from './digest.service';

@Controller('digest')
@UseGuards(JwtAuthGuard)
export class DigestController {
  constructor(private readonly digestService: DigestService) {}

  @Post('send')
  async sendNow(
    @Body(new ZodValidationPipe(sendDigestSchema)) body: { period: 'daily' | 'weekly' | 'monthly' },
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const delivered = await this.digestService.deliver(user.sub, body.period);
    return { data: { delivered } };
  }
}
