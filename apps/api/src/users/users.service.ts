import {
  Injectable,
  Inject,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, count } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { BCRYPT_COST_FACTOR } from '@moneypulse/shared';
import type {
  InviteUserInput,
  UpdateUserSettingsInput,
} from '@moneypulse/shared';

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  async getTotalUserCount(): Promise<number> {
    const result = await this.db.select({ value: count() }).from(schema.users);
    return result[0].value;
  }

  async findById(id: string) {
    const rows = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByEmail(email: string) {
    const rows = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email.toLowerCase()))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(data: {
    email: string;
    password: string;
    displayName: string;
    role: 'admin' | 'member';
    mustChangePassword?: boolean;
  }) {
    const existing = await this.findByEmail(data.email);
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(data.password, BCRYPT_COST_FACTOR);

    const rows = await this.db
      .insert(schema.users)
      .values({
        email: data.email.toLowerCase(),
        passwordHash,
        displayName: data.displayName,
        role: data.role,
        mustChangePassword: data.mustChangePassword ?? false,
      })
      .returning();

    const user = rows[0];

    // Create default user_settings
    await this.db.insert(schema.userSettings).values({
      userId: user.id,
    });

    return user;
  }

  async invite(input: InviteUserInput, adminHouseholdId: string | null) {
    const tempPassword = this.generateTempPassword();

    const user = await this.create({
      email: input.email,
      password: tempPassword,
      displayName: input.displayName,
      role: input.role,
      mustChangePassword: true,
    });

    if (adminHouseholdId) {
      await this.db
        .update(schema.users)
        .set({ householdId: adminHouseholdId })
        .where(eq(schema.users.id, user.id));
    }

    return { user, temporaryPassword: tempPassword };
  }

  async changePassword(userId: string, newPasswordHash: string): Promise<void> {
    await this.db
      .update(schema.users)
      .set({
        passwordHash: newPasswordHash,
        mustChangePassword: false,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, userId));
  }

  async getSettings(userId: string) {
    const rows = await this.db
      .select()
      .from(schema.userSettings)
      .where(eq(schema.userSettings.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  async updateSettings(userId: string, data: UpdateUserSettingsInput) {
    const rows = await this.db
      .update(schema.userSettings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.userSettings.userId, userId))
      .returning();
    return rows[0];
  }

  async getHousehold(householdId: string) {
    const rows = await this.db
      .select()
      .from(schema.households)
      .where(eq(schema.households.id, householdId))
      .limit(1);
    return rows[0] ?? null;
  }

  async listUsers() {
    return this.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        role: schema.users.role,
        householdId: schema.users.householdId,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .orderBy(schema.users.createdAt);
  }

  async createHousehold(name: string) {
    const rows = await this.db
      .insert(schema.households)
      .values({ name })
      .returning();
    return rows[0];
  }

  async assignUserToHousehold(userId: string, householdId: string): Promise<void> {
    await this.db
      .update(schema.users)
      .set({ householdId, updatedAt: new Date() })
      .where(eq(schema.users.id, userId));
  }

  async removeUserFromHousehold(userId: string): Promise<void> {
    await this.db
      .update(schema.users)
      .set({ householdId: null, updatedAt: new Date() })
      .where(eq(schema.users.id, userId));
  }

  async listHouseholdMembers(householdId: string) {
    return this.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        role: schema.users.role,
      })
      .from(schema.users)
      .where(eq(schema.users.householdId, householdId));
  }

  private generateTempPassword(): string {
    return randomBytes(18).toString('base64url');
  }
}
