import { Inject, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import type {
  CreatePaycheckProfileInput,
  UpdatePaycheckProfileInput,
} from '@moneypulse/shared';

/**
 * CRUD for effective-dated paycheck profiles (11.11 — take-home pay modeling).
 *
 * A paycheck profile models one version of a user's paystub figures (gross pay,
 * withholdings, pre/post-tax deductions, ESPP, employer-paid amounts). Real-world pay
 * changes (raise, new deduction, benefits election) should be represented as a NEW row
 * with a later `effectiveDate`, not a mutation of an existing row — `update` exists only
 * to correct entry mistakes on a given version.
 *
 * Analytics (50/30/20 dashboard, take-home projections) are explicitly out of scope here
 * — this is schema + CRUD only.
 */
@Injectable()
export class PaycheckProfilesService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  async findAll(userId: string) {
    return this.db
      .select()
      .from(schema.paycheckProfiles)
      .where(
        and(
          eq(schema.paycheckProfiles.userId, userId),
          isNull(schema.paycheckProfiles.deletedAt),
        ),
      )
      .orderBy(desc(schema.paycheckProfiles.effectiveDate));
  }

  async findById(id: string, userId: string) {
    const rows = await this.db
      .select()
      .from(schema.paycheckProfiles)
      .where(
        and(
          eq(schema.paycheckProfiles.id, id),
          eq(schema.paycheckProfiles.userId, userId),
          isNull(schema.paycheckProfiles.deletedAt),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Paycheck profile not found');
    return rows[0];
  }

  async create(userId: string, input: CreatePaycheckProfileInput) {
    const existing = await this.db
      .select({ id: schema.paycheckProfiles.id })
      .from(schema.paycheckProfiles)
      .where(
        and(
          eq(schema.paycheckProfiles.userId, userId),
          eq(schema.paycheckProfiles.effectiveDate, input.effectiveDate),
          isNull(schema.paycheckProfiles.deletedAt),
        ),
      )
      .limit(1);
    if (existing[0]) {
      throw new ConflictException(
        'A paycheck profile already exists for this effective date',
      );
    }

    const rows = await this.insertProfile(userId, input);
    return rows[0];
  }

  /** Isolated so a concurrent-insert unique-violation (race past the pre-check above) is
   *  translated into the same ConflictException the pre-check throws, instead of a raw
   *  DB error leaking to the caller. */
  private async insertProfile(
    userId: string,
    input: CreatePaycheckProfileInput,
  ) {
    try {
      return await this.db
      .insert(schema.paycheckProfiles)
      .values({
        userId,
        effectiveDate: input.effectiveDate,
        payFrequency: input.payFrequency,
        grossPayCents: input.grossPayCents,
        federalTaxCents: input.federalTaxCents ?? 0,
        stateTaxCents: input.stateTaxCents ?? 0,
        socialSecurityCents: input.socialSecurityCents ?? 0,
        medicareCents: input.medicareCents ?? 0,
        pretax401kCents: input.pretax401kCents ?? 0,
        hsaCents: input.hsaCents ?? 0,
        medicalPremiumCents: input.medicalPremiumCents ?? 0,
        dentalPremiumCents: input.dentalPremiumCents ?? 0,
        visionPremiumCents: input.visionPremiumCents ?? 0,
        commuterCents: input.commuterCents ?? 0,
        parkingCents: input.parkingCents ?? 0,
        otherPretaxCents: input.otherPretaxCents ?? 0,
        supplementalLifeCents: input.supplementalLifeCents ?? 0,
        legalCents: input.legalCents ?? 0,
        accidentInsuranceCents: input.accidentInsuranceCents ?? 0,
        otherPosttaxCents: input.otherPosttaxCents ?? 0,
        esppContributionCents: input.esppContributionCents ?? 0,
        esppDiscountPercent: input.esppDiscountPercent ?? null,
        employer401kMatchCents: input.employer401kMatchCents ?? 0,
        employerHealthContributionCents:
          input.employerHealthContributionCents ?? 0,
        notes: input.notes ?? null,
      })
      .returning();
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === '23505') {
        throw new ConflictException(
          'A paycheck profile already exists for this effective date',
        );
      }
      throw err;
    }
  }

  async update(id: string, userId: string, input: UpdatePaycheckProfileInput) {
    await this.findById(id, userId); // throws NotFoundException if missing/not owned

    if (input.effectiveDate) {
      const clash = await this.db
        .select({ id: schema.paycheckProfiles.id })
        .from(schema.paycheckProfiles)
        .where(
          and(
            eq(schema.paycheckProfiles.userId, userId),
            eq(schema.paycheckProfiles.effectiveDate, input.effectiveDate),
            isNull(schema.paycheckProfiles.deletedAt),
          ),
        )
        .limit(1);
      if (clash[0] && clash[0].id !== id) {
        throw new ConflictException(
          'A paycheck profile already exists for this effective date',
        );
      }
    }

    const rows = await this.db
      .update(schema.paycheckProfiles)
      .set({ ...input, updatedAt: new Date() })
      .where(
        and(
          eq(schema.paycheckProfiles.id, id),
          eq(schema.paycheckProfiles.userId, userId),
        ),
      )
      .returning();
    return rows[0];
  }

  async remove(id: string, userId: string) {
    await this.findById(id, userId); // throws NotFoundException if missing/not owned
    await this.db
      .update(schema.paycheckProfiles)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(schema.paycheckProfiles.id, id),
          eq(schema.paycheckProfiles.userId, userId),
        ),
      );
    return { deleted: true };
  }
}
