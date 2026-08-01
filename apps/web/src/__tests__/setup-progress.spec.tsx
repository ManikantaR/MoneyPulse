import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SetupProgress } from '@moneypulse/shared';
import { SetupProgressCard } from '@/components/SetupProgressCard';

// ── Synthetic fixtures (no real financial data) ──────────────

const mockUseSetupProgress = vi.fn();

vi.mock('@/lib/hooks/useSettings', () => ({
  useSetupProgress: () => mockUseSetupProgress(),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function makeProgress(overrides: Partial<SetupProgress> = {}): SetupProgress {
  return {
    percent: 40,
    completed: 2,
    total: 5,
    steps: [
      {
        id: 'accounts',
        label: 'Add your first account',
        done: true,
        unlocks: 'Overview + analytics',
        href: '/accounts',
        kind: 'user-data',
      },
      {
        id: 'import',
        label: 'Import a statement',
        done: true,
        unlocks: 'Transactions',
        href: '/imports',
        kind: 'user-data',
      },
      {
        id: 'paycheck',
        label: 'Set your take-home pay',
        done: false,
        unlocks: '50/30/20 dashboard',
        href: '/settings/paycheck-profiles',
        kind: 'user-data',
      },
      {
        id: 'advisor',
        label: 'Configure the AI advisor',
        done: false,
        unlocks: 'AI recap + reviews',
        href: '/settings',
        kind: 'server-config',
      },
    ],
    ...overrides,
  };
}

describe('SetupProgressCard', () => {
  it('renders percent and completed/total summary', () => {
    mockUseSetupProgress.mockReturnValue({
      data: { data: makeProgress() },
      isLoading: false,
      isError: false,
    });
    renderWithQuery(<SetupProgressCard />);
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('2 of 5 steps done')).toBeInTheDocument();
  });

  it('renders done steps as struck-through and pending user-data steps as deep-links', () => {
    mockUseSetupProgress.mockReturnValue({
      data: { data: makeProgress() },
      isLoading: false,
      isError: false,
    });
    renderWithQuery(<SetupProgressCard />);

    const doneLabel = screen.getByText('Add your first account');
    expect(doneLabel.closest('span')).toHaveClass('line-through');

    const pendingLink = screen.getByRole('link', { name: 'Set your take-home pay' });
    expect(pendingLink).toHaveAttribute('href', '/settings/paycheck-profiles');
    expect(screen.getByText(/unlocks: 50\/30\/20 dashboard/)).toBeInTheDocument();
  });

  it('shows server-config steps informationally, visually separated from countable steps', () => {
    mockUseSetupProgress.mockReturnValue({
      data: { data: makeProgress() },
      isLoading: false,
      isError: false,
    });
    renderWithQuery(<SetupProgressCard />);

    expect(screen.getByText('server setup')).toBeInTheDocument();
    expect(screen.getByText('Configure the AI advisor')).toBeInTheDocument();
    // Server-config steps must not be a deep-link (user can't complete from web UI).
    expect(
      screen.queryByRole('link', { name: 'Configure the AI advisor' }),
    ).not.toBeInTheDocument();
  });

  it('collapses the checklist and shows a complete state at 100%', () => {
    mockUseSetupProgress.mockReturnValue({
      data: {
        data: makeProgress({
          percent: 100,
          completed: 5,
          total: 5,
          steps: makeProgress().steps.map((s) => ({ ...s, done: true })),
        }),
      },
      isLoading: false,
      isError: false,
    });
    renderWithQuery(<SetupProgressCard />);

    expect(screen.getByTestId('setup-progress-complete')).toHaveTextContent(
      'Setup complete ✓',
    );
    expect(screen.queryByText('Add your first account')).not.toBeInTheDocument();
    expect(screen.queryByText('server setup')).not.toBeInTheDocument();
  });

  it('renders nothing while loading or on error', () => {
    mockUseSetupProgress.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container: loadingContainer } = renderWithQuery(<SetupProgressCard />);
    expect(loadingContainer).toBeEmptyDOMElement();

    mockUseSetupProgress.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    const { container: errorContainer } = renderWithQuery(<SetupProgressCard />);
    expect(errorContainer).toBeEmptyDOMElement();
  });
});
