import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InvestmentsPage from '@/app/(protected)/investments/page';

// ── Synthetic fixtures (no real financial data) ──────────────

const account = {
  id: 'acct-synthetic-1',
  userId: 'user-synthetic-1',
  institution: 'Synthetic Brokerage',
  accountType: 'brokerage',
  nickname: 'Test Brokerage',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  deletedAt: null,
  latestBalanceCents: 500000,
  latestSnapshotDate: '2026-07-01',
};

const holdingFresh = {
  id: 'hold-1',
  investmentAccountId: account.id,
  ticker: 'ZZZ',
  shareCount: '10',
  asOf: '2026-07-15',
  notes: 'synthetic test holding',
  createdAt: '2026-07-15T00:00:00Z',
  updatedAt: '2026-07-15T00:00:00Z',
};

const holdingOlder = {
  id: 'hold-0',
  investmentAccountId: account.id,
  ticker: 'ZZZ',
  shareCount: '5',
  asOf: '2026-06-01',
  notes: null,
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
};

const mockAddHoldingMutate = vi.fn();

vi.mock('@/lib/hooks/useInvestments', () => ({
  useInvestments: () => ({ data: [account], isLoading: false }),
  useCreateInvestment: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteInvestment: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSnapshot: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/hooks/useHoldings', () => ({
  useHoldings: () => ({ data: [holdingFresh, holdingOlder], isLoading: false }),
  useAddHolding: () => ({ mutate: mockAddHoldingMutate, isPending: false }),
  usePortfolioValue: () => ({
    data: {
      totalCents: 123400,
      holdings: [
        {
          investmentAccountId: account.id,
          ticker: 'ZZZ',
          shareCount: '10',
          asOf: '2026-07-15',
          isStale: false,
          priceDate: '2026-07-20',
          closeCents: 12340,
          marketValueCents: 123400,
        },
      ],
      staleFound: true,
      missingPriceFound: false,
      staleDays: 90,
    },
    isLoading: false,
  }),
  useAllocation: () => ({
    data: {
      totalCents: 123400,
      allocations: [{ ticker: 'ZZZ', valueCents: 123400, pct: 100 }],
      staleFound: true,
      missingPriceFound: false,
      staleDays: 90,
    },
    isLoading: false,
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  mockAddHoldingMutate.mockClear();
});

describe('Investments page — holdings UI', () => {
  it('shows portfolio value and allocation with a staleness caveat', () => {
    renderWithQuery(<InvestmentsPage />);
    expect(screen.getByText('Portfolio value (declared holdings)')).toBeInTheDocument();
    expect(screen.getByText('$1,234.00')).toBeInTheDocument();
    expect(screen.getByText('ZZZ')).toBeInTheDocument();
    expect(screen.getByText('100.0%')).toBeInTheDocument();
    expect(screen.getByText(/older than 90 days/)).toBeInTheDocument();
  });

  it('expands to show holdings history newest-first for an account', () => {
    renderWithQuery(<InvestmentsPage />);
    fireEvent.click(screen.getByText('Show holdings'));
    // Both history rows render (append-only history, not just current value)
    expect(screen.getByText('10 shares')).toBeInTheDocument();
    expect(screen.getByText('5 shares')).toBeInTheDocument();
    expect(screen.getByText('synthetic test holding')).toBeInTheDocument();
  });

  it('opens the declare-holding form and submits ticker/shares/as-of date', async () => {
    renderWithQuery(<InvestmentsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Holding' }));

    const tickerInput = screen.getByPlaceholderText('e.g. VTI');
    fireEvent.change(tickerInput, { target: { value: 'abc' } });
    const sharesInput = screen.getByPlaceholderText('0');
    fireEvent.change(sharesInput, { target: { value: '42' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save Holding' }));

    await waitFor(() => expect(mockAddHoldingMutate).toHaveBeenCalledTimes(1));
    const [payload] = mockAddHoldingMutate.mock.calls[0];
    expect(payload.ticker).toBe('abc');
    expect(payload.shareCount).toBe(42);
    expect(payload.asOf).toBeTruthy();
  });

  it('rejects a non-positive share count without calling the mutation', async () => {
    renderWithQuery(<InvestmentsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Holding' }));

    fireEvent.change(screen.getByPlaceholderText('e.g. VTI'), { target: { value: 'abc' } });
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Holding' }));

    expect(await screen.findByText('Enter a positive share count')).toBeInTheDocument();
    expect(mockAddHoldingMutate).not.toHaveBeenCalled();
  });
});
