import { Injectable, Inject, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, or, isNull } from 'drizzle-orm';

@Injectable()
export class MerchantAliasService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  async findAllForUser(userId: string) {
    return this.db
      .select()
      .from(schema.merchantAliases)
      .where(or(eq(schema.merchantAliases.userId, userId), isNull(schema.merchantAliases.userId)))
      .orderBy(schema.merchantAliases.createdAt);
  }

  async create(userId: string, data: { pattern: string; matchType: string; displayName: string }) {
    const [created] = await this.db
      .insert(schema.merchantAliases)
      .values({ userId, ...data })
      .returning();
    return created;
  }

  async update(id: string, userId: string, data: Partial<{ pattern: string; matchType: string; displayName: string }>) {
    const [existing] = await this.db
      .select()
      .from(schema.merchantAliases)
      .where(eq(schema.merchantAliases.id, id))
      .limit(1);
    if (!existing) throw new NotFoundException('Alias not found');
    if (existing.userId !== userId) throw new ForbiddenException('Cannot modify global or other-user aliases');
    const [updated] = await this.db
      .update(schema.merchantAliases)
      .set(data)
      .where(eq(schema.merchantAliases.id, id))
      .returning();
    return updated;
  }

  async remove(id: string, userId: string) {
    const [existing] = await this.db
      .select()
      .from(schema.merchantAliases)
      .where(eq(schema.merchantAliases.id, id))
      .limit(1);
    if (!existing) throw new NotFoundException('Alias not found');
    if (!existing.userId || existing.userId !== userId) throw new ForbiddenException('Cannot delete global aliases');
    await this.db
      .delete(schema.merchantAliases)
      .where(eq(schema.merchantAliases.id, id));
  }
}
