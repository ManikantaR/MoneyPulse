'use client';

import { useState } from 'react';
import { BudgetCard } from '@/components/BudgetCard';
import { SavingsGoalCard } from '@/components/SavingsGoalCard';
import {
  useBudgets,
  useCreateBudget,
  useDeleteBudget,
  useSavingsGoals,
  useCreateSavingsGoal,
  useContributeSavingsGoal,
} from '@/lib/hooks/useBudgets';
import { useCategories } from '@/lib/hooks/useCategories';

export default function BudgetsPage() {
  const { data: budgets } = useBudgets();
  const { data: goals } = useSavingsGoals();
  const { data: categoriesData } = useCategories();
  const createBudget = useCreateBudget();
  const deleteBudget = useDeleteBudget();
  const createGoal = useCreateSavingsGoal();
  const contribute = useContributeSavingsGoal();

  const [tab, setTab] = useState<'personal' | 'household'>('personal');
  const [showBudgetForm, setShowBudgetForm] = useState(false);
  const [showGoalForm, setShowGoalForm] = useState(false);

  // Budget form state
  const [budgetCategoryId, setBudgetCategoryId] = useState('');
  const [budgetAmount, setBudgetAmount] = useState('');
  const [budgetPeriod, setBudgetPeriod] = useState<'monthly' | 'weekly'>(
    'monthly',
  );

  // Savings goal form state
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalDate, setGoalDate] = useState('');

  const filteredBudgets = (budgets || []).filter((b: any) =>
    tab === 'household' ? b.household_id : !b.household_id,
  );

  const categories = categoriesData?.data ?? [];

  const handleCreateBudget = () => {
    if (!budgetCategoryId || !budgetAmount) return;
    createBudget.mutate(
      {
        categoryId: budgetCategoryId,
        amountCents: Math.round(parseFloat(budgetAmount) * 100),
        period: budgetPeriod,
      },
      {
        onSuccess: () => {
          setShowBudgetForm(false);
          setBudgetCategoryId('');
          setBudgetAmount('');
        },
      },
    );
  };

  const handleCreateGoal = () => {
    if (!goalName || !goalTarget) return;
    createGoal.mutate(
      {
        name: goalName,
        targetAmountCents: Math.round(parseFloat(goalTarget) * 100),
        targetDate: goalDate || null,
      },
      {
        onSuccess: () => {
          setShowGoalForm(false);
          setGoalName('');
          setGoalTarget('');
          setGoalDate('');
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Budgets</h1>
        <button
          onClick={() => setShowBudgetForm(!showBudgetForm)}
          className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90"
        >
          + New Budget
        </button>
      </div>

      {/* Create budget form */}
      {showBudgetForm && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <select
            value={budgetCategoryId}
            onChange={(e) => setBudgetCategoryId(e.target.value)}
            className="w-full p-2 rounded border border-border bg-background text-sm"
          >
            <option value="">Select category...</option>
            {categories.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Amount ($)"
              value={budgetAmount}
              onChange={(e) => setBudgetAmount(e.target.value)}
              className="flex-1 p-2 rounded border border-border bg-background text-sm"
              min="0"
              step="0.01"
            />
            <select
              value={budgetPeriod}
              onChange={(e) =>
                setBudgetPeriod(e.target.value as 'monthly' | 'weekly')
              }
              className="p-2 rounded border border-border bg-background text-sm"
            >
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreateBudget}
              disabled={createBudget.isPending}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50"
            >
              {createBudget.isPending ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => setShowBudgetForm(false)}
              className="px-4 py-2 text-sm bg-muted rounded-md"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setTab('personal')}
          className={`px-4 py-2 text-sm rounded-md ${tab === 'personal' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
        >
          Personal
        </button>
        <button
          onClick={() => setTab('household')}
          className={`px-4 py-2 text-sm rounded-md ${tab === 'household' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
        >
          Household
        </button>
      </div>

      {/* Budget grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredBudgets.map((b: any) => (
          <BudgetCard
            key={b.id}
            categoryName={b.category_name}
            categoryIcon={b.category_icon || '📁'}
            amountCents={Number(b.amount_cents)}
            spentCents={Number(b.spent_cents)}
            period={b.period}
            isHousehold={!!b.household_id}
            onDelete={() => deleteBudget.mutate(b.id)}
          />
        ))}
        {filteredBudgets.length === 0 && (
          <p className="text-sm text-muted-foreground col-span-full">
            No {tab} budgets yet. Create one to start tracking spending.
          </p>
        )}
      </div>

      {/* Savings Goals */}
      <div className="flex items-center justify-between mt-8">
        <h2 className="text-xl font-bold">Savings Goals</h2>
        <button
          onClick={() => setShowGoalForm(!showGoalForm)}
          className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90"
        >
          + New Goal
        </button>
      </div>

      {/* Create goal form */}
      {showGoalForm && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <input
            type="text"
            placeholder="Goal name"
            value={goalName}
            onChange={(e) => setGoalName(e.target.value)}
            className="w-full p-2 rounded border border-border bg-background text-sm"
          />
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Target amount ($)"
              value={goalTarget}
              onChange={(e) => setGoalTarget(e.target.value)}
              className="flex-1 p-2 rounded border border-border bg-background text-sm"
              min="0"
              step="0.01"
            />
            <input
              type="date"
              value={goalDate}
              onChange={(e) => setGoalDate(e.target.value)}
              className="p-2 rounded border border-border bg-background text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreateGoal}
              disabled={createGoal.isPending}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50"
            >
              {createGoal.isPending ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => setShowGoalForm(false)}
              className="px-4 py-2 text-sm bg-muted rounded-md"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(goals || []).map((g: any) => (
          <SavingsGoalCard
            key={g.id}
            name={g.name}
            targetAmountCents={Number(g.targetAmountCents)}
            currentAmountCents={Number(g.currentAmountCents)}
            targetDate={g.targetDate}
            onContribute={() => {
              const amount = prompt('Amount in dollars:');
              if (amount) {
                contribute.mutate({
                  id: g.id,
                  amountCents: Math.round(parseFloat(amount) * 100),
                });
              }
            }}
          />
        ))}
        {(!goals || goals.length === 0) && (
          <p className="text-sm text-muted-foreground col-span-full">
            No savings goals yet. Create one to start saving.
          </p>
        )}
      </div>
    </div>
  );
}
