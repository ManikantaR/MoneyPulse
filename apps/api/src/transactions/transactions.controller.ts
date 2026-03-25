import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  createTransactionSchema,
  updateTransactionSchema,
  splitTransactionSchema,
  bulkCategorizeSchema,
  transactionQuerySchema,
} from '@moneypulse/shared';
import type {
  AuthTokenPayload,
  CreateTransactionInput,
  UpdateTransactionInput,
  SplitTransactionInput,
  BulkCategorizeInput,
  TransactionQuery,
} from '@moneypulse/shared';

@ApiTags('Transactions')
@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(
    private readonly txnService: TransactionsService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * POST /transactions — Create a manual transaction entry.
   * Validates that the target account belongs to the authenticated user.
   *
   * @param body - Validated transaction creation payload
   * @param user - JWT token payload
   * @returns `{ data: Transaction }` — the created transaction
   */
  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create manual transaction' })
  async create(
    @Body(new ZodValidationPipe(createTransactionSchema))
    body: CreateTransactionInput,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const txn = await this.txnService.create(user.sub, body);
    return { data: txn };
  }

  /**
   * GET /transactions — List transactions with pagination, filtering, and sorting.
   * Scoped to the authenticated user; expands to household members when applicable.
   *
   * @param query - Validated query parameters (page, pageSize, sortBy, accountId, etc.)
   * @param user - JWT token payload
   * @returns Paginated result `{ data, total, page, pageSize, hasMore }`
   */
  @Get()
  @ApiOperation({ summary: 'List transactions (paginated, filterable)' })
  async list(
    @Query(new ZodValidationPipe(transactionQuerySchema))
    query: TransactionQuery,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    return this.txnService.findAll(user.sub, query, user.householdId);
  }

  /**
   * GET /transactions/:id — Retrieve a single transaction by ID.
   * Enforces ownership / household membership; returns 404 when not accessible.
   *
   * @param id - Transaction UUID path parameter
   * @param user - JWT token payload
   * @returns `{ data: Transaction }`
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get transaction by ID' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const txn = await this.txnService.findByIdForUser(
      id,
      user.sub,
      user.householdId,
    );
    if (!txn) throw new NotFoundException('Transaction not found');
    return { data: txn };
  }

  /**
   * PATCH /transactions/:id — Update description, category, tags, or other mutable fields.
   * Emits a `transaction_edited` audit log entry on success.
   *
   * @param id - Transaction UUID path parameter
   * @param body - Validated partial update payload
   * @param user - JWT token payload
   * @returns `{ data: Transaction }` — the updated transaction
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update transaction (description, category, tags)' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTransactionSchema))
    body: UpdateTransactionInput,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const txn = await this.txnService.update(id, user.sub, body);

    await this.auditService.log({
      userId: user.sub,
      action: 'transaction_edited',
      entityType: 'transaction',
      entityId: id,
      newValue: body as any,
    });

    return { data: txn };
  }

  /**
   * DELETE /transactions/:id — Soft-delete a transaction.
   * Sets `deletedAt`; does not physically remove the row.
   *
   * @param id - Transaction UUID path parameter
   * @param user - JWT token payload
   * @returns `{ data: { deleted: true } }`
   */
  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft delete transaction' })
  async remove(@Param('id') id: string, @CurrentUser() user: AuthTokenPayload) {
    await this.txnService.softDelete(id, user.sub);
    return { data: { deleted: true } };
  }

  /**
   * POST /transactions/:id/split — Split a transaction into two or more child transactions.
   * The sum of children must equal the parent amount.
   * Emits a `transaction_split` audit log entry on success.
   *
   * @param id - Parent transaction UUID
   * @param body - Validated split payload `{ splits: [{ amountCents, description?, categoryId? }] }`
   * @param user - JWT token payload
   * @returns `{ data: { parent, children } }`
   */
  @Post(':id/split')
  @HttpCode(201)
  @ApiOperation({ summary: 'Split transaction into children' })
  async split(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(splitTransactionSchema))
    body: SplitTransactionInput,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const result = await this.txnService.splitTransaction(id, user.sub, body);

    await this.auditService.log({
      userId: user.sub,
      action: 'transaction_split',
      entityType: 'transaction',
      entityId: id,
      newValue: { childCount: result.children.length },
    });

    return { data: result };
  }

  /**
   * POST /transactions/bulk-categorize — Assign a category to multiple transactions at once.
   * Only updates transactions owned by the authenticated user.
   * Emits a `bulk_categorized` audit log entry on success.
   *
   * @param body - Validated payload `{ transactionIds: string[], categoryId: string }`
   * @param user - JWT token payload
   * @returns `{ data: { updatedCount: number } }`
   */
  @Post('bulk-categorize')
  @HttpCode(200)
  @ApiOperation({ summary: 'Bulk categorize transactions' })
  async bulkCategorize(
    @Body(new ZodValidationPipe(bulkCategorizeSchema))
    body: BulkCategorizeInput,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const result = await this.txnService.bulkCategorize(user.sub, body);

    await this.auditService.log({
      userId: user.sub,
      action: 'bulk_categorized',
      entityType: 'transaction',
      newValue: { count: result.updatedCount, categoryId: body.categoryId },
    });

    return { data: result };
  }
}
