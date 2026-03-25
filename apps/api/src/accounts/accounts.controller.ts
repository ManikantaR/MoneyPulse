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
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AccountsService } from './accounts.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  createAccountSchema,
  updateAccountSchema,
  csvFormatConfigSchema,
} from '@moneypulse/shared';
import type {
  AuthTokenPayload,
  CreateAccountInput,
  UpdateAccountInput,
  CsvFormatConfigInput,
} from '@moneypulse/shared';

@ApiTags('Accounts')
@Controller('accounts')
@UseGuards(JwtAuthGuard)
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  /**
   * POST /accounts — Create a new bank account for the authenticated user.
   *
   * @param body - Validated account creation payload
   * @param user - JWT token payload identifying the requesting user
   * @returns `{ data: Account }` — the created account
   */
  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a bank account' })
  async create(
    @Body(new ZodValidationPipe(createAccountSchema)) body: CreateAccountInput,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const account = await this.accountsService.create(user.sub, body);
    return { data: account };
  }

  /**
   * GET /accounts — List bank accounts.
   * Returns household accounts when the authenticated user belongs to a household;
   * otherwise returns only accounts owned by that user.
   *
   * @param user - JWT token payload; `householdId` determines scope
   * @returns `{ data: Account[] | HouseholdAccountView[] }`
   */
  @Get()
  @ApiOperation({
    summary:
      'List bank accounts. Returns household accounts when user is a household member.',
  })
  async list(@CurrentUser() user: AuthTokenPayload) {
    if (user.householdId) {
      const accounts = await this.accountsService.findByHousehold(
        user.householdId,
      );
      return { data: accounts };
    }
    const accounts = await this.accountsService.findByUser(user.sub);
    return { data: accounts };
  }

  /**
   * GET /accounts/:id — Retrieve a single account by ID.
   * Returns 404 when the account does not exist or is not owned by the caller.
   *
   * @param id - Account UUID path parameter
   * @param user - JWT token payload
   * @returns `{ data: Account }`
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get account by ID' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const account = await this.accountsService.findById(id);
    if (!account || account.userId !== user.sub) {
      throw new NotFoundException('Account not found');
    }
    return { data: account };
  }

  /**
   * PATCH /accounts/:id — Update mutable fields on an account.
   * Ownership is enforced inside the service.
   *
   * @param id - Account UUID path parameter
   * @param body - Validated partial update payload
   * @param user - JWT token payload
   * @returns `{ data: Account }` — the updated account
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update account' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAccountSchema)) body: UpdateAccountInput,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const account = await this.accountsService.update(id, user.sub, body);
    return { data: account };
  }

  /**
   * DELETE /accounts/:id — Soft-delete an account.
   * Sets `deletedAt`; does not physically remove the row.
   *
   * @param id - Account UUID path parameter
   * @param user - JWT token payload
   * @returns `{ data: { deleted: true } }`
   */
  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft delete account' })
  async remove(@Param('id') id: string, @CurrentUser() user: AuthTokenPayload) {
    await this.accountsService.softDelete(id, user.sub);
    return { data: { deleted: true } };
  }

  /**
   * PATCH /accounts/:id/csv-format — Store a validated `CsvFormatConfig` on an account.
   * The body is validated against `csvFormatConfigSchema` before persisting.
   * Ownership is verified before updating.
   *
   * @param id - Account UUID path parameter
   * @param body - Zod-validated CSV format configuration
   * @param user - JWT token payload
   * @returns `{ data: { updated: true } }`
   */
  @Patch(':id/csv-format')
  @ApiOperation({ summary: 'Set custom CSV format config for generic account' })
  async setCsvFormat(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(csvFormatConfigSchema))
    body: CsvFormatConfigInput,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const account = await this.accountsService.findById(id);
    if (!account || account.userId !== user.sub) {
      throw new NotFoundException('Account not found');
    }
    await this.accountsService.updateCsvFormatConfig(id, body);
    return { data: { updated: true } };
  }
}
