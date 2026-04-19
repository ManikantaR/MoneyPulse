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
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { ExportService } from './export.service';
import { AuditService } from '../audit/audit.service';
import { CategorizationService } from '../categorization/categorization.service';
import { LearningService } from '../categorization/learning.service';
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
    private readonly exportService: ExportService,
    private readonly auditService: AuditService,
    private readonly categorizationService: CategorizationService,
    private readonly learningService: LearningService,
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
   * GET /transactions/export — Download all transactions for the authenticated user as a CSV file.
   * Optionally filtered by date range via `from` and `to` query parameters.
   *
   * @param from - Optional start date (inclusive) in ISO-8601 format.
   * @param to - Optional end date (inclusive) in ISO-8601 format.
   * @param user - JWT token payload.
   * @param res - Express response object used to stream the CSV file.
   * @returns CSV file as a downloadable attachment.
   * @throws {UnauthorizedException} If the request is not authenticated.
   */
  @Get('export')
  @ApiOperation({ summary: 'Export transactions as CSV' })
  async exportCsv(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @CurrentUser() user: AuthTokenPayload,
    @Res() res: Response,
  ) {
    const csv = await this.exportService.exportCsv(user.sub, from, to);
    const filename = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;

    await this.auditService.log({
      userId: user.sub,
      action: 'csv_exported',
      entityType: 'transaction',
      newValue: { from, to, filename },
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
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

    // Learn from manual category overrides to create auto-categorization rules
    if (body.categoryId) {
      this.learningService
        .learnFromOverride(user.sub, id, body.categoryId)
        .catch(() => {});
    }

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

    // Learn from bulk categorization to create prefix-based rules
    this.learningService
      .learnFromBulk(user.sub, body.transactionIds, body.categoryId)
      .catch(() => {});

    await this.auditService.log({
      userId: user.sub,
      action: 'bulk_categorized',
      entityType: 'transaction',
      newValue: { count: result.updatedCount, categoryId: body.categoryId },
    });

    return { data: result };
  }

  /**
   * POST /transactions/auto-categorize — Run AI categorization on all uncategorized transactions.
   * Finds transactions with no category assigned and runs them through
   * the rule engine + Ollama AI pipeline. Requires Ollama to be available
   * for AI categorization; rule engine always runs.
   *
   * @param user - JWT token payload
   * @returns `{ data: CategorizationStats }`
   */
  @Post('auto-categorize')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Auto-categorize uncategorized transactions via AI',
  })
  async autoCategorize(@CurrentUser() user: AuthTokenPayload) {
    const uncategorizedIds = await this.txnService.findUncategorizedIds(
      user.sub,
    );

    if (uncategorizedIds.length === 0) {
      return {
        data: {
          total: 0,
          categorizedByRule: 0,
          categorizedByAi: 0,
          suggested: 0,
          uncategorized: 0,
        },
      };
    }

    const stats = await this.categorizationService.categorizeBatch(
      uncategorizedIds,
      user.sub,
    );

    await this.auditService.log({
      userId: user.sub,
      action: 'auto_categorize',
      entityType: 'transaction',
      newValue: stats as any,
    });

    return { data: stats };
  }
}
