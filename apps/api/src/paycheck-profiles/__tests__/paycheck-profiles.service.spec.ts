import { ConflictException, NotFoundException } from '@nestjs/common';
import { PaycheckProfilesService } from '../paycheck-profiles.service';

describe('PaycheckProfilesService', () => {
  let service: PaycheckProfilesService;
  let mockDb: any;

  const userId = 'user-1';

  // Synthetic placeholder figures only — no real paystub data.
  const existingProfile = {
    id: 'profile-1',
    userId,
    effectiveDate: '2026-01-01',
    payFrequency: 'biweekly',
    grossPayCents: 400000,
    federalTaxCents: 60000,
    stateTaxCents: 20000,
    socialSecurityCents: 24800,
    medicareCents: 5800,
    pretax401kCents: 40000,
    hsaCents: 10000,
    medicalPremiumCents: 15000,
    dentalPremiumCents: 2000,
    visionPremiumCents: 1000,
    commuterCents: 0,
    parkingCents: 0,
    otherPretaxCents: 0,
    supplementalLifeCents: 500,
    legalCents: 0,
    accidentInsuranceCents: 0,
    otherPosttaxCents: 0,
    esppContributionCents: 20000,
    esppDiscountPercent: 15,
    employer401kMatchCents: 20000,
    employerHealthContributionCents: 30000,
    notes: null,
    deletedAt: null,
  };

  function makeDb(overrides: Partial<Record<string, any>> = {}) {
    return {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([existingProfile]),
      limit: vi.fn().mockResolvedValue([existingProfile]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([existingProfile]),
      ...overrides,
    };
  }

  beforeEach(() => {
    mockDb = makeDb();
    service = new PaycheckProfilesService(mockDb);
  });

  it('lists paycheck profiles for a user ordered by effective date desc', async () => {
    const result = await service.findAll(userId);
    expect(result).toEqual([existingProfile]);
    expect(mockDb.orderBy).toHaveBeenCalled();
  });

  it('finds a profile by id scoped to the owning user', async () => {
    const result = await service.findById('profile-1', userId);
    expect(result).toEqual(existingProfile);
  });

  it('throws NotFoundException when the profile does not exist or is not owned by the user', async () => {
    mockDb.limit = vi.fn().mockResolvedValue([]);
    await expect(service.findById('missing', userId)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('creates a new effective-dated profile', async () => {
    mockDb.limit = vi.fn().mockResolvedValue([]); // no existing row for this effective date
    const result = await service.create(userId, {
      effectiveDate: '2026-06-01',
      payFrequency: 'biweekly',
      grossPayCents: 420000,
    } as any);
    expect(mockDb.insert).toHaveBeenCalled();
    expect(result).toEqual(existingProfile);
  });

  it('rejects creating a duplicate profile for the same user + effective date', async () => {
    mockDb.limit = vi.fn().mockResolvedValue([{ id: 'profile-1' }]); // clash
    await expect(
      service.create(userId, {
        effectiveDate: '2026-01-01',
        payFrequency: 'biweekly',
        grossPayCents: 420000,
      } as any),
    ).rejects.toThrow(ConflictException);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('updates a profile owned by the user', async () => {
    // First call (findById in update) resolves the existing row; subsequent
    // effective-date clash check resolves no clash.
    let call = 0;
    mockDb.limit = vi.fn().mockImplementation(() => {
      call += 1;
      return Promise.resolve(call === 1 ? [existingProfile] : []);
    });
    const result = await service.update('profile-1', userId, {
      grossPayCents: 450000,
    });
    expect(mockDb.update).toHaveBeenCalled();
    expect(result).toEqual(existingProfile);
  });

  it('throws NotFoundException updating a profile not owned by the user', async () => {
    mockDb.limit = vi.fn().mockResolvedValue([]);
    await expect(
      service.update('profile-1', 'someone-else', { grossPayCents: 1 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('soft-deletes a profile owned by the user', async () => {
    const result = await service.remove('profile-1', userId);
    expect(result).toEqual({ deleted: true });
    expect(mockDb.update).toHaveBeenCalled();
  });
});
