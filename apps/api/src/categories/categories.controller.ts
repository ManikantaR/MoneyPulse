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
import { CategoriesService } from './categories.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  createCategorySchema,
  updateCategorySchema,
  reorderCategoriesSchema,
} from '@moneypulse/shared';
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
  ReorderCategoriesInput,
} from '@moneypulse/shared';

/**
 * REST controller for category management.
 * Provides CRUD, tree view, reordering, and descendant queries.
 * All endpoints require JWT authentication.
 */
@ApiTags('Categories')
@Controller('categories')
@UseGuards(JwtAuthGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  /**
   * GET /categories — Get all categories as a flat list (excludes soft-deleted).
   *
   * @returns `{ data: Category[] }` — flat list ordered by sortOrder, name
   */
  @Get()
  @ApiOperation({ summary: 'Get all categories (flat list)' })
  async findAll() {
    const data = await this.categoriesService.findAll();
    return { data };
  }

  /**
   * GET /categories/tree — Get the full category tree with depth via recursive CTE.
   *
   * @returns `{ data: CategoryTreeNode[] }` — flat list with `depth` field
   */
  @Get('tree')
  @ApiOperation({ summary: 'Get categories as tree (recursive CTE)' })
  async findTree() {
    const data = await this.categoriesService.findTree();
    return { data };
  }

  /**
   * POST /categories — Create a new category with Zod-validated input.
   *
   * @param body - Validated category creation payload
   * @returns `{ data: Category }` — the created category
   * @throws {NotFoundException} If the specified parent category does not exist
   */
  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create category' })
  async create(
    @Body(new ZodValidationPipe(createCategorySchema))
    body: CreateCategoryInput,
  ) {
    const category = await this.categoriesService.create(body);
    return { data: category };
  }

  /**
   * PATCH /categories/:id — Update a category (partial update, Zod-validated).
   *
   * @param id - Category UUID
   * @param body - Validated partial category update payload
   * @returns `{ data: Category }` — the updated category
   * @throws {NotFoundException} If the category does not exist
   * @throws {ConflictException} If attempting to set a category as its own parent
   * @throws {BadRequestException} If the new parent would create a circular reference
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update category' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCategorySchema))
    body: UpdateCategoryInput,
  ) {
    const category = await this.categoriesService.update(id, body);
    return { data: category };
  }

  /**
   * DELETE /categories/:id — Soft-delete a category and all its descendants (recursive).
   *
   * @param id - Category UUID to soft-delete
   * @returns `{ data: { deleted: true } }`
   * @throws {NotFoundException} If the category does not exist
   */
  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft delete category (+ descendants)' })
  async remove(@Param('id') id: string) {
    await this.categoriesService.softDelete(id);
    return { data: { deleted: true } };
  }

  /**
   * POST /categories/reorder — Reorder categories within the same parent.
   *
   * @param body - Array of `{ id, sortOrder }` pairs to apply
   * @returns `{ data: { reordered: true } }`
   */
  @Post('reorder')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reorder categories' })
  async reorder(
    @Body(new ZodValidationPipe(reorderCategoriesSchema))
    body: ReorderCategoriesInput,
  ) {
    await this.categoriesService.reorder(body.items);
    return { data: { reordered: true } };
  }

  /**
   * GET /categories/:id/descendants — Get all descendant category IDs (recursive CTE).
   *
   * @param id - Parent category UUID
   * @returns `{ data: string[] }` — array of descendant category UUIDs
   */
  @Get(':id/descendants')
  @ApiOperation({ summary: 'Get all descendant category IDs (recursive)' })
  async descendants(@Param('id') id: string) {
    const ids = await this.categoriesService.getDescendantIds(id);
    return { data: ids };
  }

  /**
   * GET /categories/:id — Get a single category by ID.
   *
   * @param id - Category UUID
   * @returns `{ data: Category }` — the category
   * @throws {NotFoundException} If the category does not exist
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get category by ID' })
  async findById(@Param('id') id: string) {
    const category = await this.categoriesService.findById(id);
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return { data: category };
  }
}
