import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { BillsService } from './bills.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { updateBillSchema } from '@moneypulse/shared';
import type { AuthTokenPayload, UpdateBillInput } from '@moneypulse/shared';

@ApiTags('Bills')
@Controller('bills')
@UseGuards(JwtAuthGuard)
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  @Get()
  @ApiOperation({ summary: 'List all recurring bills for the current user' })
  async findAll(@CurrentUser() user: AuthTokenPayload) {
    const data = await this.billsService.findAll(user.sub);
    return { data };
  }

  @Get('upcoming')
  @ApiOperation({ summary: 'Bills due within the next 7 days (for dashboard)' })
  async upcoming(@CurrentUser() user: AuthTokenPayload) {
    const data = await this.billsService.findUpcoming(user.sub, 7);
    return { data };
  }

  @Post('detect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run recurring bill detection from transaction history' })
  async detect(@CurrentUser() user: AuthTokenPayload) {
    const data = await this.billsService.detectRecurring(user.sub);
    return { data };
  }

  @Post('check-missed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check for missed/overdue bills and send notifications' })
  async checkMissed(@CurrentUser() user: AuthTokenPayload) {
    const data = await this.billsService.checkMissedBills(user.sub);
    return { data };
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm a detected recurring bill to enable alerts' })
  async confirm(
    @Param('id') id: string,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const data = await this.billsService.confirm(id, user.sub);
    return { data };
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a recurring bill (soft disable)' })
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const data = await this.billsService.deactivate(id, user.sub);
    return { data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update recurring bill details' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBillSchema)) body: UpdateBillInput,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const data = await this.billsService.update(id, user.sub, body);
    return { data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a recurring bill' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    await this.billsService.delete(id, user.sub);
    return { data: { deleted: true } };
  }
}
