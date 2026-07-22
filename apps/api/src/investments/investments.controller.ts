import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InvestmentsService } from './investments.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  createInvestmentAccountSchema,
  updateInvestmentAccountSchema,
  addSnapshotSchema,
  addHoldingSchema,
} from '@moneypulse/shared';
import type {
  CreateInvestmentAccountInput,
  UpdateInvestmentAccountInput,
  AddSnapshotInput,
  AddHoldingInput,
  AuthTokenPayload,
} from '@moneypulse/shared';

@ApiTags('Investments')
@Controller('investments')
@UseGuards(JwtAuthGuard)
export class InvestmentsController {
  constructor(private readonly investmentsService: InvestmentsService) {}

  /** GET /investments — list user's investment accounts with latest snapshot. */
  @Get()
  @ApiOperation({ summary: 'List investment accounts with latest value' })
  async findAll(@CurrentUser() user: AuthTokenPayload) {
    const data = await this.investmentsService.findAll(user.sub);
    return { data };
  }

  /**
   * GET /investments/portfolio/value — total portfolio market value (shares x
   * latest EOD close) across all of the user's declared holdings.
   * Registered before the `:id` routes so "portfolio" is never matched as an id.
   */
  @Get('portfolio/value')
  @ApiOperation({ summary: 'Get total portfolio market value across all holdings' })
  async getPortfolioValue(@CurrentUser() user: AuthTokenPayload) {
    const data = await this.investmentsService.getPortfolioValue(user.sub);
    return { data };
  }

  /** GET /investments/portfolio/allocation — percent of portfolio value by ticker. */
  @Get('portfolio/allocation')
  @ApiOperation({ summary: 'Get portfolio allocation (percent of value by ticker)' })
  async getAllocation(@CurrentUser() user: AuthTokenPayload) {
    const data = await this.investmentsService.getAllocation(user.sub);
    return { data };
  }

  /** POST /investments — create an investment account. */
  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create investment account' })
  async create(
    @CurrentUser() user: AuthTokenPayload,
    @Body(new ZodValidationPipe(createInvestmentAccountSchema))
    body: CreateInvestmentAccountInput,
  ) {
    const data = await this.investmentsService.create(user.sub, body);
    return { data };
  }

  /** PATCH /investments/:id — update nickname/institution/type. */
  @Patch(':id')
  @ApiOperation({ summary: 'Update investment account' })
  async update(
    @CurrentUser() user: AuthTokenPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateInvestmentAccountSchema))
    body: UpdateInvestmentAccountInput,
  ) {
    const data = await this.investmentsService.update(user.sub, id, body);
    return { data };
  }

  /** DELETE /investments/:id — soft-delete an account. */
  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft-delete investment account' })
  async remove(
    @CurrentUser() user: AuthTokenPayload,
    @Param('id') id: string,
  ) {
    await this.investmentsService.remove(user.sub, id);
    return { data: { deleted: true } };
  }

  /** POST /investments/:id/snapshots — record a value snapshot. */
  @Post(':id/snapshots')
  @HttpCode(201)
  @ApiOperation({ summary: 'Record investment value snapshot' })
  async addSnapshot(
    @CurrentUser() user: AuthTokenPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addSnapshotSchema)) body: AddSnapshotInput,
  ) {
    const data = await this.investmentsService.addSnapshot(user.sub, id, body);
    return { data };
  }

  /** GET /investments/:id/snapshots — value history for a trend line. */
  @Get(':id/snapshots')
  @ApiOperation({ summary: 'Get snapshot history for investment account' })
  async getSnapshots(
    @CurrentUser() user: AuthTokenPayload,
    @Param('id') id: string,
  ) {
    const data = await this.investmentsService.getSnapshots(user.sub, id);
    return { data };
  }

  /** POST /investments/:id/holdings — declare/edit a ticker holding (append-only). */
  @Post(':id/holdings')
  @HttpCode(201)
  @ApiOperation({ summary: 'Declare investment holding (ticker + share count as-of a date)' })
  async addHolding(
    @CurrentUser() user: AuthTokenPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addHoldingSchema)) body: AddHoldingInput,
  ) {
    const data = await this.investmentsService.addHolding(user.sub, id, body);
    return { data };
  }

  /** GET /investments/:id/holdings — holding history, newest first. */
  @Get(':id/holdings')
  @ApiOperation({ summary: 'Get holding history for investment account' })
  async getHoldings(@CurrentUser() user: AuthTokenPayload, @Param('id') id: string) {
    const data = await this.investmentsService.getHoldings(user.sub, id);
    return { data };
  }
}
