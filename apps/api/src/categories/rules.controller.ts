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
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, isNull, asc } from 'drizzle-orm';
import type { AuthTokenPayload } from '@moneypulse/shared';

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

  /** List all active (non-deleted) categorization rules, ordered by priority. */
  @Get()
  @ApiOperation({ summary: 'List all categorization rules' })
  async findAll(@CurrentUser() user: AuthTokenPayload) {
    const rules = await this.db
      .select()
      .from(schema.categorizationRules)
      .where(isNull(schema.categorizationRules.deletedAt))
      .orderBy(asc(schema.categorizationRules.priority));
    return { data: rules };
  }

  /** Create a new user-scoped categorization rule. */
  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create categorization rule' })
  async create(
    @Body()
    body: {
      pattern: string;
      matchType: string;
      field: string;
      categoryId: string;
      priority?: number;
    },
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

  /** Update a categorization rule (partial update). */
  @Patch(':id')
  @ApiOperation({ summary: 'Update rule' })
  async update(@Param('id') id: string, @Body() body: any) {
    const rows = await this.db
      .update(schema.categorizationRules)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(schema.categorizationRules.id, id))
      .returning();
    return { data: rows[0] };
  }

  /** Soft-delete a rule by setting `deletedAt` to current timestamp. */
  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft delete rule' })
  async remove(@Param('id') id: string) {
    await this.db
      .update(schema.categorizationRules)
      .set({ deletedAt: new Date() })
      .where(eq(schema.categorizationRules.id, id));
    return { data: { deleted: true } };
  }
}
