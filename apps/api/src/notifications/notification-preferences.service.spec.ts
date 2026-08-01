import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import {
  NotificationPreferencesService,
  NOTIFICATION_TYPES,
} from './notification-preferences.service';

describe('NOTIFICATION_TYPES regression guard (#223)', () => {
  it('the notification_type enum, DEFAULT_PREFERENCES, and NOTIFICATION_TYPES are all in sync', () => {
    const enumValues = [...schema.notificationTypeEnum.enumValues].sort();
    const defaultPrefKeys = [...NOTIFICATION_TYPES].sort();

    expect(defaultPrefKeys).toEqual(enumValues);
  });

  // #223's nine digest/advisor/coach notification types (see PR description), keyed by
  // the source file that dispatches them. This is a static guard scoped to those call
  // sites specifically: it fails if any of them regresses (type string edited, or the
  // enum/DEFAULT_PREFERENCES entry removed) without checking *every* notification type
  // in the codebase — many pre-existing types (e.g. 'spending_anomaly', 'budget_alert')
  // were never routed through the preference/channel system and are out of scope here
  // (see issue's "Out of scope" section).
  const DIGEST_ADVISOR_COACH_CALL_SITES: Array<{ file: string; type: string }> = [
    { file: 'analytics/digest.service.ts', type: 'digest' },
    { file: 'advisor/digest/advisor-digest.service.ts', type: 'advisor_digest' },
    { file: 'advisor/review/advisor-review.service.ts', type: 'advisor_review' },
    { file: 'bills/bills.service.ts', type: 'bill_overdue' },
    { file: 'recommendations/cash-manager.service.ts', type: 'benchmark_rate_move' },
    { file: 'recommendations/cash-manager.service.ts', type: 'idle_cash' },
    { file: 'recommendations/investment-coach.service.ts', type: 'investment_coach_contribution' },
    { file: 'recommendations/savings-coach.service.ts', type: 'savings_coach' },
    { file: 'monthly-close/monthly-close.service.ts', type: 'monthly_close_freshness_nudge' },
  ];

  it('every #223 digest/advisor/coach type is registered in the enum, in DEFAULT_PREFERENCES, and still referenced by its dispatching source file', () => {
    const srcRoot = path.join(__dirname, '..');
    const registered = new Set(schema.notificationTypeEnum.enumValues as readonly string[]);
    const defaultPrefTypes = new Set(NOTIFICATION_TYPES as readonly string[]);

    for (const { file, type } of DIGEST_ADVISOR_COACH_CALL_SITES) {
      expect(registered.has(type), `${type} missing from notification_type enum`).toBe(true);
      expect(defaultPrefTypes.has(type), `${type} missing from DEFAULT_PREFERENCES`).toBe(true);

      const content = fs.readFileSync(path.join(srcRoot, file), 'utf-8');
      expect(
        content.includes(`'${type}'`),
        `expected ${file} to still reference '${type}'`,
      ).toBe(true);
    }
  });
});

describe('NotificationPreferencesService.getPreference — unregistered type fallback (#223)', () => {
  let mockDb: any;
  let service: NotificationPreferencesService;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockDb = {
      select: vi.fn(),
    };
    service = new NotificationPreferencesService(mockDb);
    warnSpy = vi.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
  });

  it('falls back to a safe in-app-only default and logs a warning for an unregistered type, without querying the DB', async () => {
    const pref = await service.getPreference('user-1', 'not_a_real_type' as any);

    expect(pref.mode).toBe('instant');
    expect(pref.enabledChannels).toEqual(['inApp']);
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not_a_real_type'));
  });

  it('a registered type (e.g. digest) resolves via DEFAULT_PREFERENCES with telegram + haWebhook enabled', async () => {
    const limitMock = vi.fn().mockResolvedValue([]);
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    mockDb.select.mockReturnValue({ from: fromMock });

    const pref = await service.getPreference('user-1', 'digest' as any);

    expect(pref.mode).toBe('instant');
    expect(pref.enabledChannels).toEqual(['inApp', 'telegram', 'haWebhook']);
    expect(mockDb.select).toHaveBeenCalled();
  });

  it('falls back gracefully (never throws) if the DB query itself errors on a registered type', async () => {
    mockDb.select.mockImplementation(() => {
      throw new Error('invalid input value for enum notification_type');
    });

    const pref = await service.getPreference('user-1', 'digest' as any);

    expect(pref.mode).toBe('instant');
    expect(pref.enabledChannels).toEqual(['inApp']);
    expect(warnSpy).toHaveBeenCalled();
  });
});
