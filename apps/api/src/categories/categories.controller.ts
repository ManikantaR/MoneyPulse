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
} from '@moneypulse/shared';
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
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

  /** Get all categories as a flat list (excludes soft-deleted). */
  @Get()
  @ApiOperation({ summary: 'Get all categories (flat list)' })
  async findAll() {
    const data = await this.categoriesService.findAll();
    return { data };
  }

  /** Get category tree with depth via recursive CTE. */
  @Get('tree')
  @ApiOperation({ summary: 'Get categories as tree (recursive CTE)' })
  async findTree() {
    const data = await this.categoriesService.findTree();
    return { data };
  }

  /** Create a new category with Zod-validated input. */
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

  /** Update a category (partial update, Zod-validated). */
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

  /** Soft-delete a category and all its descendants (recursive). */
  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft delete category (+ descendants)' })
  async remove(@Param('id') id: string) {
    await this.categoriesService.softDelete(id);
    return { data: { deleted: true } };
  }

  /** Reorder categories within the same parent by updating sort order. */
  @Post('reorder')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reorder categories' })
  async reorder(@Body() body: { items: { id: string; sortOrder: number }[] }) {
    await this.categoriesService.reorder(body.items);
    return { data: { reordered: true } };
  }

  /** Get all descendant category IDs (recursive CTE). */
  @Get(':id/descendants')
  @ApiOperation({ summary: 'Get all descendant category IDs (recursive)' })
  async descendants(@Param('id') id: string) {
    const ids = await this.categoriesService.getDescendantIds(id);
    return { data: ids };
  }

  /** Get a single category by ID. */
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
