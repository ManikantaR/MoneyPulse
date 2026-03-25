import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, isNull, asc, sql } from 'drizzle-orm';
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from '@moneypulse/shared';

/**
 * Service for managing the category tree.
 * Supports CRUD, recursive CTE tree queries, soft-delete with descendants,
 * circular reference prevention, and drag-and-drop reordering.
 */
@Injectable()
export class CategoriesService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /**
   * Get all categories as a flat list, excluding soft-deleted entries.
   * Ordered by `sortOrder` then `name`.
   *
   * @returns Array of category rows
   */
  async findAll() {
    return this.db
      .select()
      .from(schema.categories)
      .where(isNull(schema.categories.deletedAt))
      .orderBy(asc(schema.categories.sortOrder), asc(schema.categories.name));
  }

  /**
   * Get the category tree as a flat list with depth info using a recursive CTE.
   * Excludes soft-deleted categories. Ordered by depth, sortOrder, name.
   *
   * @returns Array of category rows with `depth` field
   */
  async findTree() {
    const rows = await this.db.execute(sql`
      WITH RECURSIVE cat_tree AS (
        SELECT id, name, icon, color, parent_id, sort_order, 0 AS depth
        FROM ${schema.categories}
        WHERE parent_id IS NULL AND deleted_at IS NULL
        UNION ALL
        SELECT c.id, c.name, c.icon, c.color, c.parent_id, c.sort_order, ct.depth + 1
        FROM ${schema.categories} c
        JOIN cat_tree ct ON c.parent_id = ct.id
        WHERE c.deleted_at IS NULL
      )
      SELECT * FROM cat_tree
      ORDER BY depth, sort_order, name
    `);
    return rows.rows ?? rows;
  }

  /**
   * Find a single category by its UUID.
   *
   * @param id - Category UUID
   * @returns The category row or `null` if not found
   */
  async findById(id: string) {
    const rows = await this.db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Create a new category. Validates parent exists if `parentId` is provided.
   *
   * @param input - Category creation data (name, icon, color, optional parentId/sortOrder)
   * @returns The newly created category row
   * @throws {NotFoundException} If the specified parent category does not exist
   */
  async create(input: CreateCategoryInput) {
    if (input.parentId) {
      const parent = await this.findById(input.parentId);
      if (!parent) throw new NotFoundException('Parent category not found');
    }

    const rows = await this.db
      .insert(schema.categories)
      .values({
        name: input.name,
        icon: input.icon,
        color: input.color,
        parentId: input.parentId ?? null,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning();
    return rows[0];
  }

  /**
   * Update a category. Prevents self-referencing and circular parent references.
   *
   * @param id - Category UUID to update
   * @param input - Partial category fields to update
   * @returns The updated category row
   * @throws {NotFoundException} If the category does not exist
   * @throws {ConflictException} If attempting to set a category as its own parent
   * @throws {BadRequestException} If the new parent would create a circular reference
   */
  async update(id: string, input: UpdateCategoryInput) {
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundException('Category not found');

    if (input.parentId === id) {
      throw new ConflictException('Category cannot be its own parent');
    }

    if (input.parentId) {
      const descendants = await this.getDescendantIds(id);
      if (descendants.includes(input.parentId)) {
        throw new BadRequestException('Cannot set parent to a descendant');
      }
    }

    const rows = await this.db
      .update(schema.categories)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(schema.categories.id, id))
      .returning();
    return rows[0];
  }

  /**
   * Soft-delete a category and all its descendants via recursive CTE.
   * Sets `deleted_at` to the current timestamp.
   *
   * @param id - Category UUID to soft-delete
   * @throws {NotFoundException} If the category does not exist
   */
  async softDelete(id: string): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundException('Category not found');

    await this.db.execute(sql`
      WITH RECURSIVE descendants AS (
        SELECT id FROM ${schema.categories} WHERE id = ${id}
        UNION ALL
        SELECT c.id FROM ${schema.categories} c
        JOIN descendants d ON c.parent_id = d.id
      )
      UPDATE ${schema.categories}
      SET deleted_at = NOW()
      WHERE id IN (SELECT id FROM descendants)
    `);
  }

  /**
   * Reorder categories within the same parent by updating their `sortOrder`.
   *
   * @param items - Array of `{ id, sortOrder }` pairs to apply
   */
  async reorder(items: { id: string; sortOrder: number }[]) {
    for (const item of items) {
      await this.db
        .update(schema.categories)
        .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
        .where(eq(schema.categories.id, item.id));
    }
  }

  /**
   * Get all descendant IDs of a category using a recursive CTE.
   * Used for circular reference detection and cascade operations.
   *
   * @param categoryId - The parent category UUID
   * @returns Array of descendant category UUIDs
   */
  async getDescendantIds(categoryId: string): Promise<string[]> {
    const result = await this.db.execute(sql`
      WITH RECURSIVE descendants AS (
        SELECT id FROM categories WHERE parent_id = ${categoryId}
        UNION ALL
        SELECT c.id FROM categories c
        INNER JOIN descendants d ON c.parent_id = d.id
      )
      SELECT id FROM descendants
    `);
    return result.rows.map((r: any) => r.id);
  }
}
