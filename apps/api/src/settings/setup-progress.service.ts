import { Injectable, Inject } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import type { SetupProgress, SetupProgressStep } from '@moneypulse/shared';

/**
 * Computes the user's setup-completeness on the fly from existing tables — no
 * new persistence (#225, sub-issue 1/4 of the setup-tracker epic #224).
 *
 * `kind: 'user-data'` steps count toward `percent`'s denominator; `kind:
 * 'server-config'` steps (API-key/env integrations, e.g. the advisor provider)
 * are returned for the UI but excluded from the math so the bar can reach 100%.
 *
 * Conditional domains (`loan_balances`, `holdings`, `cc_fees`) only join the
 * denominator once the user has at least one row in the relevant domain
 * (a loan, an investment account, a credit-card account respectively) — a user
 * who doesn't use a domain isn't stranded below 100%.
 */
@Injectable()
export class SetupProgressService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  async getSetupProgress(userId: string): Promise<SetupProgress> {
    const [
      activeAccounts,
      fileUploadRows,
      paycheckRows,
      userSettingsRows,
      advisorSettingsRows,
      suitabilityRows,
      loanRows,
      loanBalanceRows,
      investmentAccountRows,
      investmentHoldingRows,
      investmentSnapshotRows,
      manualAssetRows,
      notificationPrefRows,
      pushSubRows,
    ] = await Promise.all([
      this.db
        .select()
        .from(schema.accounts)
        .where(
          and(
            eq(schema.accounts.userId, userId),
            sql`${schema.accounts.deletedAt} IS NULL`,
          ),
        ),
      this.db
        .select({ id: schema.fileUploads.id })
        .from(schema.fileUploads)
        .where(eq(schema.fileUploads.userId, userId)),
      this.db
        .select({ id: schema.paycheckProfiles.id })
        .from(schema.paycheckProfiles)
        .where(eq(schema.paycheckProfiles.userId, userId)),
      this.db
        .select()
        .from(schema.userSettings)
        .where(eq(schema.userSettings.userId, userId)),
      this.db.select().from(schema.advisorSettings),
      this.db
        .select({ id: schema.suitabilitySettings.id })
        .from(schema.suitabilitySettings)
        .where(eq(schema.suitabilitySettings.userId, userId)),
      this.db
        .select({ id: schema.loans.id })
        .from(schema.loans)
        .where(eq(schema.loans.userId, userId)),
      this.db
        .select({ id: schema.loanBalanceSnapshots.id })
        .from(schema.loanBalanceSnapshots)
        .innerJoin(schema.loans, eq(schema.loanBalanceSnapshots.loanId, schema.loans.id))
        .where(eq(schema.loans.userId, userId)),
      this.db
        .select({ id: schema.investmentAccounts.id })
        .from(schema.investmentAccounts)
        .where(
          and(
            eq(schema.investmentAccounts.userId, userId),
            sql`${schema.investmentAccounts.deletedAt} IS NULL`,
          ),
        ),
      this.db
        .select({ id: schema.investmentHoldings.id })
        .from(schema.investmentHoldings)
        .innerJoin(
          schema.investmentAccounts,
          eq(schema.investmentHoldings.investmentAccountId, schema.investmentAccounts.id),
        )
        .where(eq(schema.investmentAccounts.userId, userId)),
      this.db
        .select({ id: schema.investmentSnapshots.id })
        .from(schema.investmentSnapshots)
        .innerJoin(
          schema.investmentAccounts,
          eq(schema.investmentSnapshots.investmentAccountId, schema.investmentAccounts.id),
        )
        .where(eq(schema.investmentAccounts.userId, userId)),
      this.db
        .select({ id: schema.manualAssets.id })
        .from(schema.manualAssets)
        .where(
          and(
            eq(schema.manualAssets.userId, userId),
            sql`${schema.manualAssets.deletedAt} IS NULL`,
          ),
        ),
      this.db
        .select({ id: schema.notificationPreferences.id })
        .from(schema.notificationPreferences)
        .where(eq(schema.notificationPreferences.userId, userId)),
      this.db
        .select({ id: schema.pushSubscriptions.id })
        .from(schema.pushSubscriptions)
        .where(eq(schema.pushSubscriptions.userId, userId)),
    ]);

    const hasAny = (rows: unknown[]) => Array.isArray(rows) && rows.length > 0;

    const userSettings = userSettingsRows?.[0];
    const advisorSettings = advisorSettingsRows?.[0];

    const creditCardAccounts = (activeAccounts ?? []).filter(
      (a: { accountType: string }) => a.accountType === 'credit_card',
    );
    const hasCreditCard = creditCardAccounts.length > 0;
    const hasLoans = hasAny(loanRows);
    const hasInvestmentAccounts = hasAny(investmentAccountRows);

    const digestDone =
      !!userSettings?.weeklyDigestEnabled ||
      !!userSettings?.dailyDigestEnabled ||
      !!userSettings?.monthlyDigestEnabled;

    const advisorDone = !!(
      advisorSettings?.apiKeyCiphertext ||
      advisorSettings?.anthropicKeyCiphertext ||
      advisorSettings?.openaiKeyCiphertext ||
      advisorSettings?.googleKeyCiphertext
    );

    const notificationsDone =
      hasAny(notificationPrefRows) ||
      hasAny(pushSubRows) ||
      !!userSettings?.telegramNotificationsEnabled ||
      !!userSettings?.haWebhookUrl;

    const ccFeesDone =
      hasCreditCard &&
      creditCardAccounts.some(
        (a: { annualFeeCents: number | null }) => a.annualFeeCents != null,
      );

    const steps: (SetupProgressStep & { applicable: boolean })[] = [
      {
        id: 'accounts',
        label: 'Add your first account',
        done: hasAny(activeAccounts),
        unlocks: 'Overview + analytics',
        href: '/accounts',
        kind: 'user-data',
        applicable: true,
      },
      {
        id: 'import',
        label: 'Import a statement',
        done: hasAny(fileUploadRows),
        unlocks: 'Transactions',
        href: '/imports',
        kind: 'user-data',
        applicable: true,
      },
      {
        id: 'paycheck',
        label: 'Set your take-home pay',
        done: hasAny(paycheckRows),
        unlocks: '50/30/20 dashboard',
        href: '/settings/paycheck-profiles',
        kind: 'user-data',
        applicable: true,
      },
      {
        id: 'digest',
        label: 'Enable a spending digest',
        done: digestDone,
        unlocks: 'Digests',
        href: '/settings',
        kind: 'user-data',
        applicable: true,
      },
      {
        id: 'advisor',
        label: 'Configure the AI advisor',
        done: advisorDone,
        unlocks: 'AI recap + reviews',
        href: '/settings',
        kind: 'server-config',
        applicable: false,
      },
      {
        id: 'suitability',
        label: 'Set your investment policy',
        done: hasAny(suitabilityRows),
        unlocks: 'Advisory recs',
        href: '/settings',
        kind: 'user-data',
        applicable: true,
      },
      {
        id: 'loans',
        label: 'Track your loans',
        done: hasLoans,
        unlocks: 'Debt payoff + alerts',
        href: '/loans',
        kind: 'user-data',
        applicable: true,
      },
      {
        id: 'loan_balances',
        label: 'Record a loan statement balance',
        done: hasAny(loanBalanceRows),
        unlocks: 'Net-worth accuracy',
        href: '/loans',
        kind: 'user-data',
        applicable: hasLoans,
      },
      {
        id: 'investments',
        label: 'Add an investment account',
        done: hasInvestmentAccounts,
        unlocks: 'Portfolio value',
        href: '/investments',
        kind: 'user-data',
        applicable: true,
      },
      {
        id: 'holdings',
        label: 'Declare holdings or a snapshot',
        done: hasAny(investmentHoldingRows) || hasAny(investmentSnapshotRows),
        unlocks: 'Portfolio breakdown',
        href: '/investments',
        kind: 'user-data',
        applicable: hasInvestmentAccounts,
      },
      {
        id: 'manual_assets',
        label: 'Add manual assets (home/car)',
        done: hasAny(manualAssetRows),
        unlocks: 'Net worth',
        href: '/health',
        kind: 'user-data',
        applicable: true,
      },
      {
        id: 'cc_fees',
        label: 'Set credit-card annual fees',
        done: ccFeesDone,
        unlocks: 'Is this card worth it',
        href: '/accounts',
        kind: 'user-data',
        applicable: hasCreditCard,
      },
      {
        id: 'notifications',
        label: 'Set up a notification channel',
        done: notificationsDone,
        unlocks: 'Alerts',
        href: '/settings',
        kind: 'user-data',
        applicable: true,
      },
    ];

    const countable = steps.filter((s) => s.kind === 'user-data' && s.applicable);
    const total = countable.length;
    const completed = countable.filter((s) => s.done).length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    return {
      percent,
      completed,
      total,
      steps: steps.map(({ applicable: _applicable, ...step }) => step),
    };
  }
}
