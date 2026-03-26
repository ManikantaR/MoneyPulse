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
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, isNull, asc, or } from 'drizzle-orm';
import {
  createRuleSchema,
  updateRuleSchema,
} from '@moneypulse/shared';
import type {
  AuthTokenPayload,
  CreateRuleInput,
  UpdateRuleInput,
} from '@moneypulse/shared';

/**
 * REST controller for managing categorization rules.
 * Supports CRUD operations with soft-delete.
 * All endpoints require JWT authentication.
 */
@ApiTags('Categorization Rules')
@Controller('categorization-rules')
@UseGuards(JwtAuthGuard)
export class RulesController {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /**
   * GET /categorization-rules — List all active rules (user-scoped + global), ordered by priority.
   *
   * @param user - JWT token payload identifying the requesting user
   * @returns `{ data: CategorizationRule[] }` — flat list of rules
   */
  @Get()
  @ApiOperation({ summary: 'List all categorization rules' })
  async findAll(@CurrentUser() user: AuthTokenPayload) {
    const rules = await this.db
      .select()
      .from(schema.categorizationRules)
      .where(
        and(
          isNull(schema.categorizationRules.deletedAt),
          or(
            isNull(schema.categorizationRules.userId),
            eq(schema.categorizationRules.userId, user.sub),
          ),
        ),
      )
      .orderBy(asc(schema.categorizationRules.priority));
    return { data: rules };
  }

  /**
   * POST /categorization-rules — Create a new user-scoped categorization rule.
   *
   * @param body - Validated rule creation payload (pattern, matchType, field, categoryId, priority)
   * @param user - JWT token payload identifying the requesting user
   * @returns `{ data: CategorizationRule }` — the created rule
   */
  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create categorization rule' })
  async create(
    @Body(new ZodValidationPipe(createRuleSchema))
    body: CreateRuleInput,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const rows = await this.db
      .insert(schema.categorizationRules)
      .values({
        userId: user.sub,
        pattern: body.pattern,
        matchType: body.matchType,
        field: body.field,
        categoryId: body.categoryId,
        priority: body.priority ?? 30,
        isAiGenerated: false,
        confidence: 1.0,
      })
      .returning();
    return { data: rows[0] };
  }

  /**
   * PATCH /categorization-rules/:id — Update a rule (partial, allowlisted fields only).
   *
   * @param id - Rule UUID
   * @param body - Validated partial rule update payload
   * @param user - JWT token payload identifying the requesting user
   * @returns `{ data: CategorizationRule }` — the updated rule
   * @throws {NotFoundException} If the rule does not exist or is not owned by the user
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update rule' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRuleSchema))
    body: UpdateRuleInput,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const existing = await this.db
      .select()
      .from(schema.categorizationRules)
      .where(
        and(
          eq(schema.categorizationRules.id, id),
          eq(schema.categorizationRules.userId, user.sub),
          isNull(schema.categorizationRules.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      throw new NotFoundException('Rule not found');
    }

    const rows = await this.db
      .update(schema.categorizationRules)
      .set({
        ...(body.pattern !== undefined && { pattern: body.pattern }),
        ...(body.matchType !== undefined && { matchType: body.matchType }),
        ...(body.field !== undefined && { field: body.field }),
        ...(body.categoryId !== undefined && { categoryId: body.categoryId }),
        ...(body.priority !== undefined && { priority: body.priority }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.categorizationRules.id, id),
          eq(schema.categorizationRules.userId, user.sub),
        ),
      )
      .returning();
    return { data: rows[0] };
  }

  /**
   * DELETE /categorization-rules/:id — Soft-delete a rule.
   *
   * @param id - Rule UUID
   * @param user - JWT token payload identifying the requesting user
   * @returns `{ data: { deleted: true } }`
   * @throws {NotFoundException} If the rule does not exist or is not owned by the user
   */
  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft delete rule' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const existing = await this.db
      .select()
      .from(schema.categorizationRules)
      .where(
        and(
          eq(schema.categorizationRules.id, id),
          eq(schema.categorizationRules.userId, user.sub),
          isNull(schema.categorizationRules.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      throw new NotFoundException('Rule not found');
    }

    await this.db
      .update(schema.categorizationRules)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(schema.categorizationRules.id, id),
          eq(schema.categorizationRules.userId, user.sub),
        ),
      );
    return { data: { deleted: true } };
  }
}
