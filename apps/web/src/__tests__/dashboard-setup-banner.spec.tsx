import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SetupProgress } from '@moneypulse/shared';
import { DashboardSetupBanner } from '@/components/DashboardSetupBanner';

// ── Synthetic fixtures (no real financial data) ──────────────

const mockUseSetupProgress = vi.fn();
const mockMutate = vi.fn();

vi.mock('@/lib/hooks/useSettings', () => ({
  useSetupProgress: () => mockUseSetupProgress(),
  useDismissSetupTracker: () => ({ mutate: mockMutate, isPending: false }),
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
    dismissedAt: null,
    steps: [],
    ...overrides,
  };
}

describe('DashboardSetupBanner', () => {
  beforeEach(() => {
    mockMutate.mockClear();
  });

  it('shows the banner with progress summary when incomplete and not dismissed', () => {
    mockUseSetupProgress.mockReturnValue({
      data: { data: makeProgress() },
      isLoading: false,
      isError: false,
    });
    renderWithQuery(<DashboardSetupBanner />);

    expect(screen.getByTestId('dashboard-setup-banner')).toBeInTheDocument();
    expect(
      screen.getByText('Finish setting up MoneyPulse — 2 of 5 steps done (40%)'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Finish setup' })).toHaveAttribute(
      'href',
      '/settings',
    );
  });

  it('renders nothing when setup is 100% complete', () => {
    mockUseSetupProgress.mockReturnValue({
      data: { data: makeProgress({ percent: 100, completed: 5, total: 5 }) },
      isLoading: false,
      isError: false,
    });
    const { container } = renderWithQuery(<DashboardSetupBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the tracker has been dismissed', () => {
    mockUseSetupProgress.mockReturnValue({
      data: { data: makeProgress({ dismissedAt: '2026-01-01T00:00:00.000Z' }) },
      isLoading: false,
      isError: false,
    });
    const { container } = renderWithQuery(<DashboardSetupBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while loading or on error', () => {
    mockUseSetupProgress.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container: loadingContainer } = renderWithQuery(<DashboardSetupBanner />);
    expect(loadingContainer).toBeEmptyDOMElement();

    mockUseSetupProgress.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    const { container: errorContainer } = renderWithQuery(<DashboardSetupBanner />);
    expect(errorContainer).toBeEmptyDOMElement();
  });

  it('calls the dismiss mutation when the × is clicked', () => {
    mockUseSetupProgress.mockReturnValue({
      data: { data: makeProgress() },
      isLoading: false,
      isError: false,
    });
    renderWithQuery(<DashboardSetupBanner />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss setup reminder' }));
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });
});
