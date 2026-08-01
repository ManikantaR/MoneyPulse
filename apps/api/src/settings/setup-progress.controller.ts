import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthTokenPayload } from '@moneypulse/shared';
import { SetupProgressService } from './setup-progress.service';

@ApiTags('Settings')
@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SetupProgressController {
  constructor(private readonly setupProgress: SetupProgressService) {}

  @Get('setup-progress')
  @ApiOperation({ summary: "The authenticated user's setup completeness, computed on the fly" })
  async getSetupProgress(@CurrentUser() user: AuthTokenPayload) {
    return { data: await this.setupProgress.getSetupProgress(user.sub) };
  }
}
