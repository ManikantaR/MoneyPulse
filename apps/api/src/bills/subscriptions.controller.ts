import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { BillsService } from './bills.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthTokenPayload } from '@moneypulse/shared';

@ApiTags('Subscriptions')
@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private readonly billsService: BillsService) {}

  @Get()
  @ApiOperation({ summary: 'List active recurring bills with annualized cost and price-increase flag' })
  async findAll(@CurrentUser() user: AuthTokenPayload) {
    const data = await this.billsService.getSubscriptions(user.sub);
    return { data };
  }
}
