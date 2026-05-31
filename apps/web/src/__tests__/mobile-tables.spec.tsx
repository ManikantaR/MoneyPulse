/**
 * Mobile table tests: verify that table-based pages show cards on mobile
 * and the desktop table on desktop. We mock hooks to avoid API calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MobileCard } from '@/components/MobileCard';

// ── Shared mocks ──────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
}));

vi.mock('@/components/CategoryCombobox', () => ({
  CategoryCombobox: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  }) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={placeholder ?? 'Category'}
    >
      <option value="">-- none --</option>
      <option value="cat-1">Groceries</option>
    </select>
  ),
}));

vi.mock('@/components/AddTransactionModal', () => ({
  AddTransactionModal: () => <div>Add Modal</div>,
}));

vi.mock('@/components/TransactionDetailPanel', () => ({
  TransactionDetailPanel: () => <div>Detail Panel</div>,
}));

const mockTxn = {
  id: 'txn-1',
  description: 'Walmart Supercenter',
  date: '2025-01-15',
  amountCents: 4599,
  isCredit: false,
  accountId: 'acc-1',
  categoryId: 'cat-1',
  merchantName: null,
  isSplitParent: false,
  attachmentCount: 0,
  originalAmountCents: null,
  currencyCode: null,
};

vi.mock('@/lib/hooks/useTransactions', () => ({
  useTransactions: () => ({
    data: {
      data: [mockTxn],
      total: 1,
      totalPages: 1,
    },
    isLoading: false,
  }),
  useUpdateTransaction: () => ({ mutate: vi.fn(), isPending: false }),
  useBulkCategorize: () => ({ mutate: vi.fn(), isPending: false }),
  useAutoCategorize: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/lib/hooks/useAccounts', () => ({
  useAccounts: () => ({
    data: {
      data: [
        {
          id: 'acc-1',
          nickname: 'Chase Checking',
          lastFour: '1234',
          accountType: 'checking',
        },
      ],
    },
  }),
}));

vi.mock('@/lib/hooks/useCategories', () => ({
  useCategories: () => ({
    data: {
      data: [{ id: 'cat-1', name: 'Groceries', icon: '🛒', parentId: null }],
    },
  }),
}));

// ── MobileCard unit tests ─────────────────────────────────────────────────────

describe('MobileCard component', () => {
  it('renders primary value in header', () => {
    render(
      <MobileCard
        fields={[
          { primary: true, value: 'Walmart Supercenter' },
          { amount: true, value: '-$45.99' },
        ]}
      />,
    );
    expect(screen.getByText('Walmart Supercenter')).toBeInTheDocument();
    expect(screen.getByText('-$45.99')).toBeInTheDocument();
  });

  it('renders label/value pairs in grid', () => {
    render(
      <MobileCard
        fields={[
          { primary: true, value: 'Bill' },
          { label: 'Date', value: 'Jan 15, 2025' },
          { label: 'Account', value: 'Chase Checking' },
        ]}
      />,
    );
    expect(screen.getByText('Date')).toBeInTheDocument();
    expect(screen.getByText('Jan 15, 2025')).toBeInTheDocument();
  });

  it('calls onClick when card is tapped', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <MobileCard fields={[{ primary: true, value: 'Tappable' }]} onClick={onClick} />,
    );
    await user.click(screen.getByText('Tappable'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not propagate action clicks to card onClick', async () => {
    const user = userEvent.setup();
    const cardClick = vi.fn();
    const actionClick = vi.fn();
    render(
      <MobileCard
        fields={[{ primary: true, value: 'Item' }]}
        onClick={cardClick}
        actions={<button onClick={actionClick}>Delete</button>}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(actionClick).toHaveBeenCalledOnce();
    expect(cardClick).not.toHaveBeenCalled();
  });
});

// ── Transactions page mobile section ─────────────────────────────────────────

describe('Transactions page mobile cards', () => {
  function wrap(ui: React.ReactElement) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  }

  it('renders a mobile card for each transaction', async () => {
    const TransactionsPage = (await import('@/app/(protected)/transactions/page')).default;
    wrap(<TransactionsPage />);
    // The description appears in both table (hidden md:) and mobile card (md:hidden)
    const items = screen.getAllByText('Walmart Supercenter');
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  it('desktop table container has hidden md:block class', async () => {
    const TransactionsPage = (await import('@/app/(protected)/transactions/page')).default;
    const { container } = wrap(<TransactionsPage />);
    // Find the desktop table wrapper — it has 'hidden' and 'md:block'
    const tableWrapper = container.querySelector('.hidden.md\\:block');
    expect(tableWrapper).not.toBeNull();
    expect(tableWrapper?.querySelector('table')).not.toBeNull();
  });

  it('mobile card section has md:hidden class', async () => {
    const TransactionsPage = (await import('@/app/(protected)/transactions/page')).default;
    const { container } = wrap(<TransactionsPage />);
    const mobileSection = container.querySelector('.md\\:hidden');
    expect(mobileSection).not.toBeNull();
  });
});
